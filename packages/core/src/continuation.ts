import fs from 'fs'
import { buildPrompt } from './launch'
import { claudeLastReply, type TodoItem } from './progress'

/**
 * The first message of a card's new agent session: what the next session needs
 * to carry on, instead of the whole conversation of the last one. Built from
 * facts core already has (git, PR, the transcript's todos and last reply);
 * nothing is asked of the previous agent.
 */

export const MAX_BRIEF_CHARS = 8_000
export const MAX_REPLY_CHARS = 2_000
/** The card text is the task itself, so it keeps most of the budget; only an extreme description is cut. */
const MAX_DESCRIPTION_CHARS = 4_000
/** How much of a transcript's end is read to find the last reply. */
const TAIL_BYTES = 256 * 1024
const CUT = '…（已截斷）'

export interface BriefCommit {
  shortSha: string
  subject: string
}

export interface BriefFile {
  path: string
  /** Single-letter git status. */
  status: string
}

export interface BriefGit {
  branch: string
  baseBranch?: string
  /** `base..HEAD`, newest first. */
  commits: BriefCommit[]
  uncommitted: BriefFile[]
  /** Commits not on the upstream branch; null = there is no upstream (never pushed). */
  unpushed: number | null
}

export interface BriefPr {
  number: number
  state: string
  url: string
}

/** One card under a master. */
export interface BriefCard {
  id: string
  title: string
  column: string
  running: boolean
  todos?: { done: number; total: number }
  pr?: { number: number; state: string }
}

/** Every part is optional: a part that could not be read is left out, never an error. */
export interface ContinuationFacts {
  title: string
  description?: string
  git?: BriefGit
  /** Undefined = not looked up (no section). Null = no PR found, or `gh` could not say. */
  pr?: BriefPr | null
  todos?: TodoItem[] | null
  lastReply?: string
  /** A master's cards, in place of git and PR. */
  cards?: BriefCard[]
}

interface Limits {
  reply: number
  commits: number
  files: number
  todos: number
  cards: number
}

/** Tried in order until the brief fits: the reply goes first, then the long lists. */
const LIMITS: Limits[] = [
  { reply: MAX_REPLY_CHARS, commits: 20, files: 30, todos: 40, cards: 30 },
  { reply: 800, commits: 10, files: 15, todos: 25, cards: 20 },
  { reply: 0, commits: 5, files: 8, todos: 15, cards: 10 },
  { reply: 0, commits: 0, files: 0, todos: 8, cards: 5 },
]

function clipText(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - CUT.length)).trimEnd()}${CUT}`
}

function more(total: number, shown: number): string[] {
  return total > shown ? [`  - …（還有 ${total - shown} 項未列出）`] : []
}

function gitSection(git: BriefGit, limits: Limits): string[] {
  const lines = ['', '## 分支與程式碼', `- 分支：\`${git.branch}\`${git.baseBranch ? `，base：\`${git.baseBranch}\`` : ''}`]
  lines.push(
    git.unpushed === null
      ? '- push 狀態：這個分支還沒有 upstream（從未 push）'
      : git.unpushed > 0
        ? `- push 狀態：領先 upstream ${git.unpushed} 個 commit，尚未 push`
        : '- push 狀態：與 upstream 同步'
  )
  if (git.commits.length === 0) {
    lines.push('- 這個分支還沒有 commit')
  } else if (limits.commits > 0) {
    lines.push(`- \`base..HEAD\` 的 commit（新到舊，共 ${git.commits.length} 筆）：`)
    for (const c of git.commits.slice(0, limits.commits)) lines.push(`  - \`${c.shortSha}\` ${c.subject}`)
    lines.push(...more(git.commits.length, limits.commits))
  } else {
    lines.push(`- \`base..HEAD\` 共 ${git.commits.length} 筆 commit（用 git log 查看）`)
  }
  if (git.uncommitted.length === 0) {
    lines.push('- 沒有未 commit 的變更')
  } else if (limits.files > 0) {
    lines.push(`- 未 commit 的變更（${git.uncommitted.length} 個檔案）：`)
    for (const f of git.uncommitted.slice(0, limits.files)) lines.push(`  - \`${f.status}\` ${f.path}`)
    lines.push(...more(git.uncommitted.length, limits.files))
  } else {
    lines.push(`- 有 ${git.uncommitted.length} 個檔案未 commit（用 git status 查看）`)
  }
  return lines
}

function prSection(pr: BriefPr | null): string[] {
  return [
    '',
    '## PR',
    pr ? `- #${pr.number} ${pr.state} ${pr.url}` : '- PR 狀態未知（尚未開 PR，或 `gh` 無法使用、逾時）',
  ]
}

const TODO_MARK: Record<TodoItem['status'], string> = { completed: '[x]', in_progress: '[~]', pending: '[ ]' }

function todoSection(todos: TodoItem[], limit: number): string[] {
  const lines = ['', '## 前一個 session 的 todo']
  for (const t of todos.slice(0, limit)) lines.push(`- ${TODO_MARK[t.status]} ${t.content}`)
  if (todos.length > limit) lines.push(`- …（還有 ${todos.length - limit} 項未列出）`)
  return lines
}

function replySection(reply: string, limit: number): string[] {
  return ['', '## 前一個 session 的最後一則回覆', ...clipText(reply, limit).split('\n').map((l) => `> ${l}`)]
}

const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\s+/g, ' ')

function cardSection(cards: BriefCard[], limit: number): string[] {
  const lines = ['', '## 底下的卡片', '| id | 標題 | 欄位 | 執行中 | todo | PR |', '| --- | --- | --- | --- | --- | --- |']
  for (const c of cards.slice(0, limit)) {
    const todos = c.todos ? `${c.todos.done}/${c.todos.total}` : '-'
    const pr = c.pr ? `#${c.pr.number} ${c.pr.state}` : '-'
    lines.push(`| ${c.id} | ${cell(c.title)} | ${c.column} | ${c.running ? '是' : '否'} | ${todos} | ${pr} |`)
  }
  if (cards.length > limit) lines.push(`（還有 ${cards.length - limit} 張未列出，用 task list 查看）`)
  return lines
}

function render(head: string, facts: ContinuationFacts, limits: Limits): string {
  const lines = [
    head,
    '',
    '這是同一張卡的新 session：前一個 session 已結束，它的對話你看不到。以下是接續所需的事實；原本的檔案、分支與變更都還在原處，沒有任何東西被丟棄。',
  ]
  if (facts.git) lines.push(...gitSection(facts.git, limits))
  if (facts.pr !== undefined) lines.push(...prSection(facts.pr))
  if (facts.todos?.length) lines.push(...todoSection(facts.todos, limits.todos))
  if (facts.lastReply && limits.reply > 0) lines.push(...replySection(facts.lastReply, limits.reply))
  if (facts.cards) lines.push(...cardSection(facts.cards, limits.cards))
  lines.push(
    '',
    '## 接續指示',
    facts.cards
      ? '先確認底下卡片的目前狀態；有需要你處理的就接著處理，沒有就簡短回報整體狀態，然後等待指示。'
      : '先確認 git status 與 PR 狀態；有未完成的 todo 就接著做，沒有就簡短回報目前狀態，然後等待指示。'
  )
  return lines.join('\n')
}

/** The brief, within MAX_BRIEF_CHARS: the lists and the last reply shrink first, the card text last. */
export function buildContinuationPrompt(facts: ContinuationFacts): string {
  const description = facts.description?.trim()
  const head = buildPrompt({
    title: facts.title,
    description: description ? clipText(description, MAX_DESCRIPTION_CHARS) : undefined,
  })
  for (const limits of LIMITS) {
    const text = render(head, facts, limits)
    if (text.length <= MAX_BRIEF_CHARS) return text
  }
  return clipText(render(head, facts, LIMITS[LIMITS.length - 1]), MAX_BRIEF_CHARS)
}

/**
 * The executor's last reply from the end of its transcript, or undefined when
 * the file is missing, unreadable or holds no reply in its last 256 KB.
 */
export function readLastClaudeReply(file: string, maxChars: number): string | undefined {
  let fd: number | undefined
  try {
    fd = fs.openSync(file, 'r')
    const size = fs.fstatSync(fd).size
    const start = Math.max(0, size - TAIL_BYTES)
    const buf = Buffer.alloc(size - start)
    fs.readSync(fd, buf, 0, buf.length, start)
    let text = buf.toString('utf8')
    if (start > 0) {
      // The read began mid-line.
      const newline = text.indexOf('\n')
      text = newline === -1 ? '' : text.slice(newline + 1)
    }
    const reply = claudeLastReply(text.split('\n').filter((l) => l.trim()))
    return reply ? clipText(reply, maxChars) : undefined
  } catch {
    return undefined
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}
