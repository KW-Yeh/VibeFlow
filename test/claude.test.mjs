import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildAgentCommand,
  buildReviewCommand,
  buildReviseCommand,
  buildReviewPrompt,
  buildRolePrompt,
  buildReviewerSystemPrompt,
  executorSessionId,
  DEFAULT_SYSTEM_PROMPT,
  PROGRESS_PROTOCOL_PROMPT,
  DEFAULT_PERMISSION_MODE,
} from '../renderer/lib/claude.ts'

// A reviewer persona configured purely via the role definition (角色設定).
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

// Full task with all fields required by the new fresh-launch signatures.
// `id` is a valid 8-char hex string that exercising executorSessionId derivation.
const TASK = {
  id: 'abcd1234',
  title: '修復登入流程',
  description: '使用者無法登入。',
  agentCli: /** @type {'claude'} */ ('claude'),
  worktreePath: '/tmp/vibeflow/vf-abc123',
  progress: undefined,
}

const CODEX_TASK = {
  ...TASK,
  agentCli: /** @type {'codex'} */ ('codex'),
  model: 'gpt-5-codex',
  executionAgentCli: /** @type {'codex'} */ ('codex'),
  executionModel: 'gpt-5-codex',
}

// ─── buildAgentCommand (planning vs execution) ──────────────────────────────

test('buildAgentCommand — planning uses planning agent and does not inject executor role', () => {
  const cmd = buildAgentCommand(CODEX_TASK, '', EXECUTOR_ROLE)
  assert.ok(cmd.startsWith('codex --model gpt-5-codex '), 'must use planning agent command')
  assert.ok(!cmd.includes('--full-auto'), 'codex command must not use unsupported --full-auto')
  assert.ok(!cmd.includes('資深前端工程師'), 'planning must not inject executor role prompt')
  assert.ok(cmd.includes(DEFAULT_SYSTEM_PROMPT), 'planning must include PM system prompt')
  assert.ok(cmd.includes('若需求足夠明確'), 'planning must include planning instructions')
})

test('buildAgentCommand — execution uses execution role after PLAN is done', () => {
  const task = {
    ...CODEX_TASK,
    progress: {
      summary: 'PLAN.md 完成',
      planDone: true,
      needsUserInput: false,
      steps: [{ text: '實作修正', done: false }],
      updatedAt: Date.now(),
    },
  }
  const cmd = buildAgentCommand(task, '', EXECUTOR_ROLE)
  assert.ok(cmd.startsWith('codex --model gpt-5-codex '), 'must use execution agent command')
  assert.ok(!cmd.includes('--full-auto'), 'codex command must not use unsupported --full-auto')
  assert.ok(cmd.includes('資深前端工程師'), 'execution must inject executor role prompt')
  assert.ok(cmd.includes('Planning 已完成'), 'execution must include execution instructions')
})

// ─── buildReviewCommand (fresh-launch) ──────────────────────────────────────

test('buildReviewCommand — is a fresh claude launch, not a REPL keystroke sequence', () => {
  const cmd = buildReviewCommand(TASK, REVIEWER_ROLE)
  // Must end with \r (CR-terminated command line)
  assert.equal(cmd.endsWith('\r'), true, 'must end with CR so the shell runs it')
  // Must start a fresh claude process with auto permission mode
  assert.ok(cmd.startsWith('claude '), 'must be a fresh claude launch')
  assert.ok(cmd.includes(`--permission-mode ${DEFAULT_PERMISSION_MODE}`), 'must pass permission mode')
  // Must NOT use ESC+CR keystroke encoding (that was the old REPL path)
  assert.ok(!cmd.includes('\x1b\r'), 'must not use ESC+CR keystroke encoding')
})

test('buildReviewCommand — reviewer role goes into --append-system-prompt', () => {
  const cmd = buildReviewCommand(TASK, REVIEWER_ROLE)
  assert.ok(cmd.includes('--append-system-prompt'), 'reviewer role must be passed via --append-system-prompt')
  // The role preamble should appear in the system prompt arg, not inline in the body
  assert.ok(cmd.includes('超夢'), 'reviewer role name must appear in the command')
})

test('buildReviewCommand — no sub-agent hooks (--settings must be absent)', () => {
  const cmd = buildReviewCommand(TASK, REVIEWER_ROLE)
  assert.ok(!cmd.includes('--settings'), 'reviewer launch must not install sub-agent hooks')
  assert.ok(!cmd.includes('.vibeflow-subagents'), 'must not reference subagents dir')
})

test('buildReviewCommand — carries the verdict-writing instruction the orchestrator depends on', () => {
  const cmd = buildReviewCommand(TASK, REVIEWER_ROLE)
  // Prompt body must include task title and verdict instruction
  assert.ok(cmd.includes('修復登入流程'), 'must include task title in prompt')
  assert.ok(cmd.includes('"verdict"'), 'must tell reviewer to emit a verdict')
  assert.ok(cmd.includes('.vibeflow-progress.json'), 'must reference the progress file')
})

test('buildReviewCommand — works without a reviewer role (falls back to default framing)', () => {
  const cmd = buildReviewCommand(TASK)
  assert.ok(cmd.startsWith('claude '), 'must still be a fresh claude launch')
  assert.ok(cmd.includes('--append-system-prompt'), 'fallback framing must still use --append-system-prompt')
  assert.ok(cmd.includes('"verdict"'), 'must still include verdict instruction')
})

test('buildReviewCommand — does NOT carry the executor system prompt or progress protocol', () => {
  const cmd = buildReviewCommand(TASK, REVIEWER_ROLE)
  assert.ok(!cmd.includes(DEFAULT_SYSTEM_PROMPT), 'must not carry executor system prompt')
  assert.ok(!cmd.includes(PROGRESS_PROTOCOL_PROMPT), 'must not re-inject progress protocol')
})

// ─── buildReviewPrompt ───────────────────────────────────────────────────────

test('buildReviewPrompt — prompt body contains task title, verdict JSON structure, and notes', () => {
  const body = buildReviewPrompt(TASK)
  assert.ok(body.includes('任務標題：修復登入流程'))
  assert.ok(body.includes('"verdict"'))
  assert.ok(body.includes('.vibeflow-progress.json'))
  assert.ok(body.includes('注意：你只負責審查'))
})

// ─── buildReviewerSystemPrompt ───────────────────────────────────────────────

test('buildReviewerSystemPrompt — returns role prompt when role is provided', () => {
  const sys = buildReviewerSystemPrompt(REVIEWER_ROLE)
  assert.equal(sys, buildRolePrompt(REVIEWER_ROLE))
  assert.ok(sys.startsWith('你現在是一位資深的超夢。'))
})

test('buildReviewerSystemPrompt — returns non-empty fallback when no role', () => {
  const sys = buildReviewerSystemPrompt()
  assert.ok(sys.length > 0, 'must return non-empty string even without a role')
  assert.ok(!sys.includes('超夢'), 'must not reference the specific role name')
})

// ─── executorSessionId ───────────────────────────────────────────────────────

test('executorSessionId — produces a valid v4-variant UUID from an 8-char hex task id', () => {
  const uuid = executorSessionId('abcd1234')
  assert.match(
    uuid,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,
    'must be a valid RFC-4122 v4 UUID'
  )
})

test('executorSessionId — is deterministic (same input → same output)', () => {
  assert.equal(executorSessionId('abcd1234'), executorSessionId('abcd1234'))
})

test('executorSessionId — different task ids produce different UUIDs', () => {
  assert.notEqual(executorSessionId('abcd1234'), executorSessionId('ef567890'))
})

// ─── buildReviseCommand (fresh-launch + --resume <uuid>) ─────────────────────

test('buildReviseCommand — is a fresh claude launch with --resume <uuid> (not --continue)', () => {
  const comments = ['修正 off-by-one', '處理 null 輸入']
  const cmd = buildReviseCommand(TASK, EXECUTOR_ROLE, comments)
  const expectedUuid = executorSessionId(TASK.id)
  assert.ok(cmd.startsWith('claude '), 'must be a fresh claude launch')
  assert.ok(!cmd.includes('--continue'), 'must NOT use --continue (would pick up reviewer session)')
  assert.ok(cmd.includes(`--resume ${expectedUuid}`), 'must use --resume with the pinned executor UUID')
  assert.ok(cmd.includes(`--permission-mode ${DEFAULT_PERMISSION_MODE}`), 'must pass permission mode')
  assert.equal(cmd.endsWith('\r'), true, 'must end with CR')
})

test('buildReviseCommand — installs sub-agent hooks for the executor', () => {
  const cmd = buildReviseCommand(TASK, EXECUTOR_ROLE, [])
  assert.ok(cmd.includes('--settings'), 'revise launch must install sub-agent hooks')
  assert.ok(cmd.includes('.vibeflow-subagents'), 'must reference subagents dir')
})

test('buildReviseCommand — carries executor system prompt and role', () => {
  const comments = ['修正 off-by-one', '處理 null 輸入']
  const cmd = buildReviseCommand(TASK, EXECUTOR_ROLE, comments)
  assert.ok(cmd.includes('--append-system-prompt'), 'must pass system prompt via flag')
  assert.ok(cmd.includes('資深前端工程師'), 'executor role name must appear in command')
})

test('buildReviseCommand — lists the reviewer comments in the prompt', () => {
  const comments = ['修正 off-by-one', '處理 null 輸入']
  const cmd = buildReviseCommand(TASK, EXECUTOR_ROLE, comments)
  for (const c of comments) {
    assert.ok(cmd.includes(c), `comment "${c}" must be present`)
  }
})

test('buildReviseCommand — does NOT use REPL keystroke encoding', () => {
  const cmd = buildReviseCommand(TASK, EXECUTOR_ROLE, ['fix something'])
  assert.ok(!cmd.includes('\x1b\r'), 'must not use ESC+CR keystroke encoding')
})
