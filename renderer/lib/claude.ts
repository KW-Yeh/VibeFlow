import type { Task } from '@/lib/types'

/**
 * Default system prompt appended when auto-launching Claude for a card. It
 * drives a plan-then-execute, hands-off workflow inside the task's isolated
 * git worktree. Kept concise so it fits comfortably on the command line.
 */
export const DEFAULT_SYSTEM_PROMPT = [
  '你是在一個隔離的 git worktree 中自動執行任務的工程師助理。請依以下流程進行，全程使用繁體中文回報：',
  '1. 先閱讀並理解任務需求，產出一份簡短的執行計劃（條列即可）。',
  '2. 直接依計劃逐步實作，不要停下來等待額外確認。',
  '3. 完成後執行專案既有的檢查（typecheck / lint / test / build，若存在），並修正所有錯誤。',
  '4. 最後用條列式回報：做了什麼、驗證了哪些指令、有什麼風險或待辦。',
].join('\n')

/** The permission mode passed to the Claude CLI ("auto mode"). */
export const DEFAULT_PERMISSION_MODE = 'auto'

/** Quote an arbitrary string for safe use as a single shell argument (POSIX). */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/** Build the initial prompt fed to Claude from a card's title + description. */
export function buildPrompt(task: Pick<Task, 'title' | 'description'>): string {
  const description = task.description?.trim()
  if (description) {
    return `任務標題：${task.title}\n\n任務描述：\n${description}`
  }
  return `任務標題：${task.title}`
}

/**
 * Build the full shell command (terminated with a carriage return) that
 * launches Claude in auto mode with the card's prompt and the default system
 * prompt. Written verbatim into the card's PTY.
 */
export function buildClaudeCommand(
  task: Pick<Task, 'title' | 'description'>
): string {
  const prompt = buildPrompt(task)
  return (
    `claude --permission-mode ${DEFAULT_PERMISSION_MODE}` +
    ` --append-system-prompt ${shellQuote(DEFAULT_SYSTEM_PROMPT)}` +
    ` ${shellQuote(prompt)}\r`
  )
}
