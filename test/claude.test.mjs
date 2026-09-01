import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildAgentCommand,
  resolveSystemPrompt,
  executorSessionId,
  planningSessionId,
  PROGRESS_PROTOCOL_PROMPT,
} from '../renderer/lib/claude.ts'

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

test('buildAgentCommand — planning uses the planning agent', () => {
  const cmd = buildAgentCommand(CODEX_TASK, '')
  assert.ok(cmd.startsWith('codex --model gpt-5.5 '), 'must use planning agent command')
  assert.ok(!cmd.includes('--full-auto'), 'codex command must not use unsupported --full-auto')
  assert.ok(cmd.includes('若需求足夠明確'), 'planning must include planning instructions')
})

test('buildAgentCommand — passes task effort to Claude Code', () => {
  const cmd = buildAgentCommand({ ...TASK, effort: 'high' })
  assert.ok(cmd.includes('--effort high'), 'Claude must receive the task effort as a session flag')
})

test('buildAgentCommand — pins Claude to a dark theme that matches xterm', () => {
  const cmd = buildAgentCommand(TASK)
  assert.ok(cmd.includes('"theme":"dark"'), 'Claude must render for VibeFlow’s dark terminal')
  assert.ok(!cmd.includes('"theme":"light"'), 'light theme makes question text unreadable')
})

test('buildAgentCommand — maps task effort to a session-scoped Codex config override', () => {
  const cmd = buildAgentCommand({ ...CODEX_TASK, effort: 'xhigh' })
  assert.ok(
    cmd.startsWith(`codex -c 'model_reasoning_effort="xhigh"' --model gpt-5.5 `),
    'Codex must receive a TOML config override without changing the user config file'
  )
})

test('buildAgentCommand — leaves Gemini unchanged when a task has effort metadata', () => {
  const cmd = buildAgentCommand({
    ...TASK,
    agentCli: /** @type {'gemini'} */ ('gemini'),
    model: 'gemini-2.5-flash',
    executionAgentCli: /** @type {'gemini'} */ ('gemini'),
    executionModel: 'gemini-2.5-flash',
    effort: 'high',
  })
  assert.ok(cmd.startsWith('gemini --yolo -i --model gemini-2.5-flash '))
  assert.ok(!cmd.includes('--effort'))
  assert.ok(!cmd.includes('model_reasoning_effort'))
})

test('buildAgentCommand — execution uses the execution agent after PLAN is done', () => {
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
  const cmd = buildAgentCommand(task, '')
  assert.ok(cmd.startsWith('codex --model gpt-5.5 '), 'must use execution agent command')
  assert.ok(!cmd.includes('--full-auto'), 'codex command must not use unsupported --full-auto')
  assert.ok(cmd.includes('Planning 已完成'), 'execution must include execution instructions')
})

test('resolveSystemPrompt — blank custom prompt means no system prompt at all', () => {
  assert.equal(resolveSystemPrompt(''), '')
  assert.equal(resolveSystemPrompt('   '), '')
  assert.equal(resolveSystemPrompt(undefined), '')
  assert.equal(resolveSystemPrompt(null), '')
})

test('resolveSystemPrompt — does not inject progress protocol into system prompt', () => {
  const sys = resolveSystemPrompt('自訂 prompt')
  assert.equal(sys, '自訂 prompt')
  assert.ok(!sys.includes(PROGRESS_PROTOCOL_PROMPT), 'progress protocol belongs to the prompt body')
})

test('buildAgentCommand — omits --append-system-prompt when no prompt is configured', () => {
  const cmd = buildAgentCommand(TASK, '')
  assert.ok(!cmd.includes('--append-system-prompt'), 'an empty system prompt must not reach the CLI')
  assert.ok(cmd.includes('若需求足夠明確'), 'the task prompt body must still be passed')
})

test('buildAgentCommand — passes a configured system prompt to Claude', () => {
  const cmd = buildAgentCommand(TASK, '只用繁體中文回報')
  assert.ok(cmd.includes('--append-system-prompt'), 'a configured system prompt must reach the CLI')
  assert.ok(cmd.includes('只用繁體中文回報'), 'the configured text must be present')
})

test('buildAgentCommand — Codex body carries no leading blank lines without a system prompt', () => {
  const cmd = buildAgentCommand(CODEX_TASK, '')
  assert.ok(!cmd.includes("'\n\n"), 'an empty system prompt must not be folded into the Codex body')
})

test('buildAgentCommand — carries progress protocol in prompt body', () => {
  const cmd = buildAgentCommand(CODEX_TASK, '')
  assert.ok(cmd.includes(PROGRESS_PROTOCOL_PROMPT), 'must still provide progress-writing instructions')
})

test('buildAgentCommand — tells Codex to promote temporary evidence into task artifacts', () => {
  const workspacePath = '/workspace/project'
  const cmd = buildAgentCommand(CODEX_TASK, '', undefined, workspacePath)
  const artifactsDir = `${workspacePath}/vf-abc123.artifacts`

  assert.ok(cmd.includes('/private/tmp'), 'must cover screenshot tools that return system temp paths')
  assert.ok(cmd.includes('~/Downloads'), 'must cover the browser download dir tools export to')
  assert.ok(cmd.includes(`複製到 ${artifactsDir}/ 根目錄`), 'must name the task artifacts destination')
  assert.ok(cmd.includes('並確認目標檔案存在'), 'must require verifying the promoted file')
  assert.ok(cmd.includes('只回報或保留原路徑不算完成'), 'must reject evidence left at its source path')
})

test('buildAgentCommand — requires a real screen recording when the change is interactive', () => {
  const workspacePath = '/workspace/project'
  const cmd = buildAgentCommand(CODEX_TASK, '', undefined, workspacePath)

  assert.ok(
    cmd.includes('能不能用一張靜態圖看出通過或失敗'),
    'must give the judgement test that decides screenshot vs recording'
  )
  assert.ok(
    cmd.includes('純樣式、文案、靜態版面改動不需要錄'),
    'must scope recording to interactive changes only'
  )
  assert.ok(cmd.includes('screencapture -v -k -C -x -D1'), 'must spell out the recording command')
  assert.ok(
    cmd.includes(`${workspacePath}/vf-abc123.artifacts/<描述性檔名>.mov`),
    'must record straight into the task artifacts dir as .mov'
  )
  assert.ok(
    cmd.includes('pkill -INT -x screencapture'),
    'must stop the recording with SIGINT so the file is finalized'
  )
})

test('buildAgentCommand — forbids GIF output, so evidence stays watchable video', () => {
  const cmd = buildAgentCommand(CODEX_TASK, '', undefined, '/workspace/project')

  // gif_creator may only appear as a prohibition. A GIF samples at action
  // boundaries, which is exactly where transitions and hover states live.
  assert.ok(cmd.includes('嚴禁用 `gif_creator`'), 'must ban the GIF tool outright')
  assert.equal(
    cmd.split('gif_creator').length - 1,
    1,
    'must name gif_creator exactly once — as the prohibition, never as an instruction'
  )
  assert.ok(!cmd.includes('start_recording'), 'must drop the old gif_creator recording sequence')
  assert.ok(!cmd.includes('stop_recording'), 'must drop the old gif_creator recording sequence')
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
  const cmd = buildAgentCommand(task, '')
  assert.ok(cmd.startsWith('codex --model gpt-5.5 '), 'must replace unavailable legacy Codex model')
  assert.ok(!cmd.includes('gpt-5-codex'), 'must not launch unavailable gpt-5-codex')
})

test('buildAgentCommand — Claude planning and execution use separate session ids', () => {
  const planningId = planningSessionId(TASK.id)
  const executionId = executorSessionId(TASK.id)
  assert.notEqual(planningId, executionId)

  const planningCmd = buildAgentCommand(TASK, '')
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
  const executionCmd = buildAgentCommand(executionTask, '')
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

test('fresh task runs use distinct, stable planning and execution sessions', () => {
  const firstRun = '11111111-1111-4111-8111-111111111111'
  const secondRun = '22222222-2222-4222-8222-222222222222'

  assert.equal(
    planningSessionId('abcd1234', firstRun),
    planningSessionId('abcd1234', firstRun),
    'a restarted run must remain resumable after an app restart'
  )
  assert.notEqual(
    planningSessionId('abcd1234', firstRun),
    planningSessionId('abcd1234', secondRun),
    'each restart must create a fresh planning conversation'
  )
  assert.notEqual(
    executorSessionId('abcd1234', firstRun),
    executorSessionId('abcd1234', secondRun),
    'each restart must create a fresh execution conversation'
  )
})
