import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildAgentCommand,
  buildArtifactPrompt,
  executorSessionId,
  resolveSystemPrompt,
} from '../renderer/lib/claude.ts'

const TASK = {
  id: 'abcd1234',
  title: '修復登入流程',
  description: '使用者無法登入。',
  agentCli: /** @type {'claude'} */ ('claude'),
  branch: 'fix/login-flow',
  worktreePath: '/tmp/vibeflow/vf-abc123',
}

const CODEX_TASK = {
  ...TASK,
  agentCli: /** @type {'codex'} */ ('codex'),
  model: 'gpt-5.5',
}

test('resolveSystemPrompt — blank custom prompt stays blank', () => {
  assert.equal(resolveSystemPrompt(''), '')
  assert.equal(resolveSystemPrompt('   '), '')
  assert.equal(resolveSystemPrompt(undefined), '')
  assert.equal(resolveSystemPrompt(null), '')
})

test('buildArtifactPrompt — names the task artifact and scratch paths', () => {
  const prompt = buildArtifactPrompt('/workspace/project/vf-abc123.artifacts')
  assert.match(prompt, /本次 session 全程適用/)
  assert.match(prompt, /\/workspace\/project\/vf-abc123\.artifacts\//)
  assert.match(prompt, /vf-abc123\.artifacts\/scratch\//)
  assert.ok(!prompt.includes('progress'))
  assert.ok(!prompt.includes('PLAN.md'))
  assert.ok(!prompt.includes('Agent Memory'))
})

test('buildAgentCommand — Claude receives Artifact context as a system prompt', () => {
  const cmd = buildAgentCommand(TASK, '', undefined, '/workspace/project')
  assert.ok(cmd.startsWith('claude '))
  assert.ok(cmd.includes('--append-system-prompt'))
  assert.ok(cmd.includes('/workspace/project/vf-abc123.artifacts/'))
  assert.ok(cmd.includes('任務標題：修復登入流程'))
  assert.ok(!cmd.includes('進度追蹤'))
  assert.ok(!cmd.includes('PLAN.md'))
})

test('buildAgentCommand — Claude system prompt orders built-in, library, then custom', () => {
  const cmd = buildAgentCommand(TASK, 'CUSTOM_MARKER', {
    library: {
      promptText: 'LIBRARY_MARKER',
      pluginDir: '/tmp/plugin',
      libraryDir: '/tmp/library',
      codexHome: '/tmp/codex-home',
      scripts: [],
    },
  }, '/workspace/project')
  assert.ok(cmd.indexOf('Artifact 設定') < cmd.indexOf('LIBRARY_MARKER'))
  assert.ok(cmd.indexOf('LIBRARY_MARKER') < cmd.indexOf('CUSTOM_MARKER'))
})

test('buildAgentCommand — Codex folds Artifact context into its initial prompt', () => {
  const cmd = buildAgentCommand(CODEX_TASK, '', undefined, '/workspace/project')
  assert.ok(cmd.startsWith('codex --model gpt-5.5 '))
  assert.ok(!cmd.includes('--append-system-prompt'))
  assert.ok(cmd.includes('Artifact 設定'))
  assert.ok(cmd.includes('/workspace/project/vf-abc123.artifacts/'))
  assert.ok(cmd.includes('任務標題：修復登入流程'))
})

test('buildAgentCommand — agent-only Claude launch omits card content and pinned session', () => {
  const cmd = buildAgentCommand(
    TASK,
    'CUSTOM_MARKER',
    { includeTaskPrompt: false },
    '/workspace/project'
  )
  assert.ok(cmd.startsWith('claude '))
  assert.ok(cmd.includes('--append-system-prompt'))
  assert.ok(cmd.includes('CUSTOM_MARKER'))
  assert.ok(cmd.includes('/workspace/project/vf-abc123.artifacts/'))
  assert.ok(!cmd.includes('--session-id'))
  assert.ok(!cmd.includes('任務標題'))
  assert.ok(!cmd.includes('修復登入流程'))
  assert.ok(!cmd.includes('使用者無法登入'))
})

test('buildAgentCommand — agent-only Codex launch includes settings and Artifact but no card content', () => {
  const cmd = buildAgentCommand(
    CODEX_TASK,
    'CUSTOM_MARKER',
    { includeTaskPrompt: false },
    '/workspace/project'
  )
  assert.ok(cmd.startsWith('codex --model gpt-5.5 '))
  assert.ok(cmd.includes('CUSTOM_MARKER'))
  assert.ok(cmd.includes('/workspace/project/vf-abc123.artifacts/'))
  assert.ok(!cmd.includes('任務標題'))
  assert.ok(!cmd.includes('修復登入流程'))
  assert.ok(!cmd.includes('使用者無法登入'))
})

test('buildAgentCommand — passes effort to both CLIs', () => {
  assert.ok(buildAgentCommand({ ...TASK, effort: 'high' }).includes('--effort high'))
  assert.ok(
    buildAgentCommand({ ...CODEX_TASK, effort: 'xhigh' }).startsWith(
      `codex -c 'model_reasoning_effort="xhigh"' --model gpt-5.5 `
    )
  )
})

test('buildAgentCommand — unknown agent falls back to Claude', () => {
  const cmd = buildAgentCommand({ ...TASK, agentCli: /** @type {'claude'} */ ('gemini') })
  assert.ok(cmd.startsWith('claude '))
  assert.ok(!cmd.includes('--model gemini'))
})

test('buildAgentCommand — restart uses a fresh pinned session and retains Artifact context', () => {
  const runId = '11111111-1111-4111-8111-111111111111'
  const cmd = buildAgentCommand(
    { ...TASK, runId },
    '',
    undefined,
    '/workspace/project'
  )
  assert.ok(cmd.includes(`--session-id ${executorSessionId(TASK.id, runId)}`))
  assert.ok(cmd.includes('/workspace/project/vf-abc123.artifacts/'))
})

test('buildAgentCommand — Claude resume re-injects Artifact context without a new message', () => {
  const cmd = buildAgentCommand(TASK, '', { resume: true }, '/workspace/project')
  assert.ok(cmd.includes('--append-system-prompt'))
  assert.ok(cmd.includes('/workspace/project/vf-abc123.artifacts/'))
  assert.ok(!cmd.includes('請接續這個任務'))
  assert.ok(!cmd.includes('任務標題'))
  assert.ok(!cmd.includes('修復登入流程'))
  assert.ok(!cmd.includes('使用者無法登入'))
})

test('executorSessionId — is valid, stable, and unique per run', () => {
  const first = executorSessionId('abcd1234', '11111111-1111-4111-8111-111111111111')
  const second = executorSessionId('abcd1234', '22222222-2222-4222-8222-222222222222')
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.equal(first, executorSessionId('abcd1234', '11111111-1111-4111-8111-111111111111'))
  assert.notEqual(first, second)
})

const BOARD_TASK = {
  ...TASK,
  projectPath: '/Users/dev/project',
  baseBranch: 'main',
}

const BOARD_CLI = {
  storeDir: '/Users/dev/Library/Application Support/VibeFlow (development)',
  cliPath: '/Users/dev/Desktop/VibeFlow/scripts/vibeflow.mjs',
  loaderPath: '/Users/dev/Desktop/VibeFlow/test/support/register.mjs',
}

test('buildAgentCommand — board access is exported into the launch shell', () => {
  const cmd = buildAgentCommand(
    BOARD_TASK,
    '',
    { boardCli: BOARD_CLI, autoMode: true },
    '/workspace/project'
  )

  assert.ok(cmd.startsWith('export VIBEFLOW_TASK_ID='))
  assert.ok(cmd.includes(`VIBEFLOW_TASK_ID='abcd1234'`))
  assert.ok(cmd.includes(`VIBEFLOW_PROJECT_PATH='/Users/dev/project'`))
  assert.ok(cmd.includes(`VIBEFLOW_BRANCH='fix/login-flow'`))
  assert.ok(cmd.includes(`VIBEFLOW_BASE_BRANCH='main'`))
  assert.ok(cmd.includes(`VIBEFLOW_CLI='${BOARD_CLI.cliPath}'`))
  assert.ok(cmd.includes(`VIBEFLOW_CLI_LOADER='${BOARD_CLI.loaderPath}'`))
  assert.ok(cmd.includes(`VIBEFLOW_AUTO_MODE='1'`))
  assert.ok(cmd.includes(`; claude `), 'the agent command still follows the exports')
})

test('buildAgentCommand — a store dir with spaces stays one quoted value', () => {
  const cmd = buildAgentCommand(BOARD_TASK, '', { boardCli: BOARD_CLI })

  assert.ok(cmd.includes(`VIBEFLOW_STORE_DIR='${BOARD_CLI.storeDir}'`))
  assert.ok(cmd.includes(`VIBEFLOW_AUTO_MODE='0'`), 'Auto Mode off is reported, not omitted')
})

test('buildAgentCommand — no board info exports nothing', () => {
  const cmd = buildAgentCommand(BOARD_TASK, '', undefined, '/workspace/project')

  assert.ok(cmd.startsWith('claude '))
  assert.ok(!cmd.includes('VIBEFLOW_'))
})

test('buildAgentCommand — a board with no CLI exports identity but no CLI path', () => {
  const cmd = buildAgentCommand(BOARD_TASK, '', {
    boardCli: { storeDir: BOARD_CLI.storeDir },
  })

  assert.ok(cmd.includes(`VIBEFLOW_TASK_ID='abcd1234'`))
  assert.ok(!cmd.includes('VIBEFLOW_CLI='))
  assert.ok(!cmd.includes('VIBEFLOW_CLI_LOADER='))
})

test('buildAgentCommand — exports precede the resume `if`, not just one branch', () => {
  const cmd = buildAgentCommand(BOARD_TASK, '', {
    resume: true,
    boardCli: BOARD_CLI,
  })

  assert.ok(cmd.startsWith('export VIBEFLOW_TASK_ID='))
  assert.ok(cmd.includes('; if [ -f '), 'the resume test must run inside the exported env')
})

test('buildAgentCommand — Codex gets the same board exports', () => {
  const cmd = buildAgentCommand(
    { ...CODEX_TASK, projectPath: '/Users/dev/project', baseBranch: 'main' },
    '',
    { boardCli: BOARD_CLI }
  )

  assert.ok(cmd.startsWith('export VIBEFLOW_TASK_ID='))
  assert.ok(cmd.includes('; codex '))
})
