import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildReviewCommand,
  buildReviseCommand,
  buildRolePrompt,
  DEFAULT_SYSTEM_PROMPT,
  PROGRESS_PROTOCOL_PROMPT,
} from '../renderer/lib/claude.ts'

// A reviewer persona configured purely via the role definition (角色設定) —
// this is what the auto-review must rely on instead of a system prompt.
const REVIEWER_ROLE = {
  name: '超夢',
  positioning: '數位世界的法醫與神探，根因導向。',
  responsibilities: '審查 git worktree 中相對 base branch 的所有改動。',
  boundaries: '嚴禁編寫防禦性過強、缺乏根因推導的補丁。',
}

const EXECUTOR_ROLE = {
  name: '資深前端工程師',
  positioning: '熟悉 React 與 TypeScript。',
}

const TASK = { title: '修復登入流程', description: '使用者無法登入。' }

// The keystrokes are meant to be typed into an already-running agent REPL where
// a bare CR submits and ESC+CR inserts a newline. Decode that back to the plain
// multi-line text the agent ultimately sees as one submitted turn.
function decodeReplSubmission(seq) {
  assert.ok(seq.endsWith('\r'), 'must end with a CR so the turn auto-submits')
  const body = seq.slice(0, -1)
  assert.ok(
    !body.includes('\n'),
    'no raw LF: every internal newline must be ESC+CR, else the REPL stalls waiting for Enter'
  )
  return body.replaceAll('\x1b\r', '\n')
}

test('buildReviewCommand — auto-submits as one REPL turn (no manual Enter)', () => {
  const seq = buildReviewCommand(TASK, REVIEWER_ROLE)
  // Exactly one trailing submit CR; all interior breaks are ESC+CR.
  assert.equal(seq.endsWith('\r'), true)
  assert.equal(seq.slice(0, -1).includes('\r'), seq.slice(0, -1).includes('\x1b\r'))
  decodeReplSubmission(seq) // throws if a raw LF or missing submit CR sneaks in
})

test('buildReviewCommand — carries no system prompt; reviewer persona comes from the role body', () => {
  const body = decodeReplSubmission(buildReviewCommand(TASK, REVIEWER_ROLE))
  // It must NOT be a fresh CLI launch nor inject the executor system prompt.
  assert.ok(!body.includes('--append-system-prompt'), 'must not pass a system-prompt flag')
  assert.ok(!body.includes('--permission-mode'), 'must not be a fresh claude launch')
  assert.ok(!body.includes(DEFAULT_SYSTEM_PROMPT), 'must not carry the executor system prompt')
  assert.ok(!body.includes(PROGRESS_PROTOCOL_PROMPT), 'must not re-inject the progress protocol')
  // The reviewer persona is folded into the prompt body instead.
  assert.ok(body.includes(buildRolePrompt(REVIEWER_ROLE)), 'reviewer role must lead the prompt')
  assert.ok(body.startsWith('你被指派的角色是「超夢」'))
})

test('buildReviewCommand — keeps the verdict-writing instruction the orchestrator depends on', () => {
  const body = decodeReplSubmission(buildReviewCommand(TASK, REVIEWER_ROLE))
  assert.ok(body.includes('任務標題：修復登入流程'))
  assert.ok(body.includes('"verdict"'), 'must still tell the reviewer to emit a verdict')
  assert.ok(body.includes('.vibeflow-progress.json'))
})

test('buildReviewCommand — works without a reviewer role (still auto-submits, no system prompt)', () => {
  const body = decodeReplSubmission(buildReviewCommand(TASK))
  assert.ok(!body.includes('--append-system-prompt'))
  assert.ok(body.startsWith('任務標題：'), 'no role preamble when none is configured')
  assert.ok(body.includes('"verdict"'))
})

test('buildReviseCommand — auto-submits, folds executor role in, lists the comments, no system prompt', () => {
  const comments = ['修正 off-by-one', '處理 null 輸入']
  const body = decodeReplSubmission(buildReviseCommand(TASK, EXECUTOR_ROLE, comments))
  assert.ok(!body.includes('--append-system-prompt'))
  assert.ok(!body.includes(DEFAULT_SYSTEM_PROMPT))
  assert.ok(body.includes(buildRolePrompt(EXECUTOR_ROLE)), 'executor role must lead the revise prompt')
  for (const c of comments) assert.ok(body.includes(`- ${c}`), `comment "${c}" must be listed`)
})
