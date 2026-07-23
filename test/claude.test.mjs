import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildAgentCommand,
  resolveSystemPrompt,
  executorSessionId,
  planningSessionId,
  DEFAULT_SYSTEM_PROMPT,
  PROGRESS_PROTOCOL_PROMPT,
} from '../renderer/lib/claude.ts'

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
  model: 'gpt-5.5',
  executionAgentCli: /** @type {'codex'} */ ('codex'),
  executionModel: 'gpt-5.5',
}

// ─── buildAgentCommand (planning vs execution) ──────────────────────────────

test('buildAgentCommand — planning uses planning agent and does not inject executor role', () => {
  const cmd = buildAgentCommand(CODEX_TASK, '', EXECUTOR_ROLE)
  assert.ok(cmd.startsWith('codex --model gpt-5.5 '), 'must use planning agent command')
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
  assert.ok(cmd.startsWith('codex --model gpt-5.5 '), 'must use execution agent command')
  assert.ok(!cmd.includes('--full-auto'), 'codex command must not use unsupported --full-auto')
  assert.ok(cmd.includes('資深前端工程師'), 'execution must inject executor role prompt')
  assert.ok(cmd.includes('Planning 已完成'), 'execution must include execution instructions')
})

test('resolveSystemPrompt — does not inject progress protocol into system prompt', () => {
  const sys = resolveSystemPrompt('', EXECUTOR_ROLE)
  assert.ok(sys.includes(DEFAULT_SYSTEM_PROMPT), 'must still include the default system prompt')
  assert.ok(sys.includes('資深前端工程師'), 'must still include the role prompt')
  assert.ok(!sys.includes(PROGRESS_PROTOCOL_PROMPT), 'progress protocol belongs to the prompt body')
})

test('buildAgentCommand — carries progress protocol in prompt body', () => {
  const cmd = buildAgentCommand(CODEX_TASK, '', EXECUTOR_ROLE)
  assert.ok(cmd.includes(PROGRESS_PROTOCOL_PROMPT), 'must still provide progress-writing instructions')
})

test('buildAgentCommand — normalizes legacy Codex models to an available model', () => {
  const task = {
    ...CODEX_TASK,
    model: 'gpt-5-codex',
    executionModel: 'gpt-5',
    progress: {
      summary: 'PLAN.md 完成',
      planDone: true,
      needsUserInput: false,
      steps: [{ text: '實作修正', done: false }],
      updatedAt: Date.now(),
    },
  }
  const cmd = buildAgentCommand(task, '', EXECUTOR_ROLE)
  assert.ok(cmd.startsWith('codex --model gpt-5.5 '), 'must replace unavailable legacy Codex model')
  assert.ok(!cmd.includes('gpt-5-codex'), 'must not launch unavailable gpt-5-codex')
})

test('buildAgentCommand — Claude planning and execution use separate session ids', () => {
  const planningId = planningSessionId(TASK.id)
  const executionId = executorSessionId(TASK.id)
  assert.notEqual(planningId, executionId)

  const planningCmd = buildAgentCommand(TASK, '', EXECUTOR_ROLE)
  assert.ok(planningCmd.includes(`--session-id ${planningId}`), 'planning must use planning session id')
  assert.ok(!planningCmd.includes(executionId), 'planning must not reserve executor session id')

  const executionTask = {
    ...TASK,
    progress: {
      summary: 'PLAN.md 完成',
      planDone: true,
      needsUserInput: false,
      steps: [{ text: '實作修正', done: false }],
      updatedAt: Date.now(),
    },
  }
  const executionCmd = buildAgentCommand(executionTask, '', EXECUTOR_ROLE)
  assert.ok(executionCmd.includes(`--session-id ${executionId}`), 'execution must use executor session id')
  assert.ok(!executionCmd.includes(planningId), 'execution must not reuse planning session id')
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

test('planningSessionId — is deterministic and distinct from executorSessionId', () => {
  assert.equal(planningSessionId('abcd1234'), planningSessionId('abcd1234'))
  assert.notEqual(planningSessionId('abcd1234'), executorSessionId('abcd1234'))
})
