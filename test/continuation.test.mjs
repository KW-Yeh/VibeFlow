import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { claudeLastReply } from '../packages/core/src/progress.ts'
import {
  MAX_BRIEF_CHARS,
  buildContinuationPrompt,
  readLastClaudeReply,
} from '../packages/core/src/continuation.ts'

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'progress', 'claude-last-reply.jsonl')
const fixtureLines = () => fs.readFileSync(FIXTURE, 'utf8').split('\n').filter(Boolean)

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-continuation-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

const FACTS = {
  title: '修正 A',
  description: '讓 A 在 B 時不再失敗',
  git: {
    branch: 'vf-abc12345',
    baseBranch: 'main',
    commits: [
      { shortSha: 'bbb2222', subject: 'fix: handle B' },
      { shortSha: 'aaa1111', subject: 'test: cover B' },
    ],
    uncommitted: [{ path: 'src/a.ts', status: 'M' }],
    unpushed: 1,
  },
  pr: { number: 12, state: 'OPEN', url: 'https://github.com/acme/demo/pull/12' },
  todos: [
    { content: '寫測試', status: 'completed' },
    { content: '修 bug', status: 'in_progress' },
    { content: '開 PR', status: 'pending' },
  ],
  lastReply: '已修正 A。\n\n下一步：等 review。',
}

test('claudeLastReply — the executor\'s newest text; sub-agent text and non-text lines are skipped', () => {
  assert.equal(claudeLastReply(fixtureLines()), '已修正 A，測試通過。\n\n下一步：等 review。')
  // Cut right after the first tool call: the earlier text is the newest one.
  assert.equal(claudeLastReply(fixtureLines().slice(0, 3)), '我先讀檔案。')
})

test('claudeLastReply — nothing to find, or only broken lines', () => {
  assert.equal(claudeLastReply([]), undefined)
  assert.equal(claudeLastReply(['not json', '{"type":"user"}', '{"type":"assistant","message":{"content":[{"type":"thinking"}]}}']), undefined)
  const sideOnly = fixtureLines().filter((l) => l.includes('"isSidechain":true'))
  assert.equal(claudeLastReply(sideOnly), undefined)
})

test('readLastClaudeReply — reads the end of a large file and ignores the partial first line', (t) => {
  const file = path.join(tmpDir(t), 'session.jsonl')
  const filler = JSON.stringify({ type: 'user', message: { role: 'user', content: 'x'.repeat(1000) } })
  const junk = Array.from({ length: 400 }, () => filler).join('\n')
  fs.writeFileSync(file, `${junk}\n${fixtureLines().join('\n')}\n`)
  assert.ok(fs.statSync(file).size > 256 * 1024, 'bigger than the tail that is read')
  assert.equal(readLastClaudeReply(file, 2000), '已修正 A，測試通過。\n\n下一步：等 review。')
})

test('readLastClaudeReply — clips long replies; a missing or empty file is undefined', (t) => {
  const dir = tmpDir(t)
  const file = path.join(dir, 'session.jsonl')
  const long = 'y'.repeat(5000)
  fs.writeFileSync(file, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: long }] } }) + '\n')
  const clipped = readLastClaudeReply(file, 2000)
  assert.ok(clipped.length <= 2000)
  assert.ok(clipped.endsWith('（已截斷）'))
  assert.equal(readLastClaudeReply(path.join(dir, 'missing.jsonl'), 2000), undefined)
  fs.writeFileSync(file, '')
  assert.equal(readLastClaudeReply(file, 2000), undefined)
})

test('brief — every part present, in order, in Traditional Chinese', () => {
  const text = buildContinuationPrompt(FACTS)
  const order = ['任務標題：修正 A', '任務描述：', '## 分支與程式碼', '## PR', '## 前一個 session 的 todo', '## 前一個 session 的最後一則回覆', '## 接續指示']
  let from = 0
  for (const marker of order) {
    const at = text.indexOf(marker, from)
    assert.ok(at >= from, `${marker} comes after the previous part`)
    from = at
  }
  assert.match(text, /`vf-abc12345`，base：`main`/)
  assert.match(text, /領先 upstream 1 個 commit，尚未 push/)
  assert.match(text, /`bbb2222` fix: handle B/)
  assert.match(text, /`M` src\/a\.ts/)
  assert.match(text, /#12 OPEN https:\/\/github\.com\/acme\/demo\/pull\/12/)
  assert.match(text, /\[x\] 寫測試/)
  assert.match(text, /\[~\] 修 bug/)
  assert.match(text, /\[ \] 開 PR/)
  assert.match(text, /> 已修正 A。/)
  assert.match(text, /> 下一步：等 review。/)
  assert.ok(text.length <= MAX_BRIEF_CHARS)
})

test('brief — a part that could not be read is left out', () => {
  const text = buildContinuationPrompt({ title: '只有標題' })
  assert.match(text, /^任務標題：只有標題/)
  for (const heading of ['任務描述：', '## 分支與程式碼', '## PR', '## 前一個 session 的 todo', '## 前一個 session 的最後一則回覆', '## 底下的卡片']) {
    assert.ok(!text.includes(heading), `no ${heading}`)
  }
  assert.match(text, /## 接續指示/)
})

test('brief — no PR found reads as unknown; synced upstream and a clean tree are stated', () => {
  const text = buildContinuationPrompt({
    title: 't',
    git: { branch: 'vf-1', commits: [], uncommitted: [], unpushed: 0 },
    pr: null,
  })
  assert.match(text, /PR 狀態未知/)
  assert.match(text, /與 upstream 同步/)
  assert.match(text, /還沒有 commit/)
  assert.match(text, /沒有未 commit 的變更/)
  assert.match(buildContinuationPrompt({ title: 't', git: { branch: 'vf-1', commits: [], uncommitted: [], unpushed: null } }), /從未 push/)
})

test('brief — long lists and replies are capped', () => {
  const commits = Array.from({ length: 45 }, (_, i) => ({ shortSha: `c${String(i).padStart(6, '0')}`, subject: `commit ${i}` }))
  const text = buildContinuationPrompt({
    ...FACTS,
    git: { ...FACTS.git, commits },
    lastReply: 'z'.repeat(5000),
  })
  assert.match(text, /共 45 筆/)
  assert.match(text, /還有 25 項未列出/)
  assert.ok(!text.includes('c000020'), 'only the first 20 commits are listed')
  const reply = text.split('\n').filter((l) => l.startsWith('> '))
  assert.ok(reply.join('\n').length <= 2000 + reply.length * 2, 'reply capped at 2,000 characters')
  assert.ok(text.length <= MAX_BRIEF_CHARS)
})

test('brief — the worst case still fits MAX_BRIEF_CHARS and keeps the card text', () => {
  const text = buildContinuationPrompt({
    title: '標題',
    description: 'd'.repeat(20_000),
    git: {
      branch: 'vf-1',
      baseBranch: 'main',
      commits: Array.from({ length: 50 }, (_, i) => ({ shortSha: `s${i}`, subject: 'x'.repeat(200) })),
      uncommitted: Array.from({ length: 80 }, (_, i) => ({ path: `src/${'p'.repeat(100)}${i}.ts`, status: 'M' })),
      unpushed: 3,
    },
    pr: FACTS.pr,
    todos: Array.from({ length: 60 }, (_, i) => ({ content: `todo ${i} ${'t'.repeat(100)}`, status: 'pending' })),
    lastReply: 'r'.repeat(10_000),
  })
  assert.ok(text.length <= MAX_BRIEF_CHARS, `${text.length} chars`)
  assert.match(text, /任務描述：\nd{100}/)
  assert.match(text, /## 接續指示/)
})

test('brief — an over-long description is cut with a notice, a normal one is kept whole', () => {
  const whole = 'e'.repeat(3000)
  assert.ok(buildContinuationPrompt({ title: 't', description: whole }).includes(whole))
  const cut = buildContinuationPrompt({ title: 't', description: 'e'.repeat(6000) })
  assert.ok(cut.includes('（已截斷）'))
})

test('brief — a master lists its cards instead of git and PR', () => {
  const text = buildContinuationPrompt({
    title: '主卡',
    todos: [{ content: '派工', status: 'in_progress' }],
    lastReply: '已派出兩張卡。',
    cards: [
      { id: 'a1b2c3d4', title: '後端 | API', column: 'in_progress', running: true, todos: { done: 1, total: 3 }, pr: { number: 7, state: 'OPEN' } },
      { id: 'e5f6a7b8', title: '驗收', column: 'backlog', running: false },
    ],
  })
  assert.match(text, /## 底下的卡片/)
  assert.match(text, /\| a1b2c3d4 \| 後端 \\\| API \| in_progress \| 是 \| 1\/3 \| #7 OPEN \|/)
  assert.match(text, /\| e5f6a7b8 \| 驗收 \| backlog \| 否 \| - \| - \|/)
  assert.ok(!text.includes('## 分支與程式碼'))
  assert.ok(!text.includes('## PR'))
  assert.match(text, /先確認底下卡片的目前狀態/)
})
