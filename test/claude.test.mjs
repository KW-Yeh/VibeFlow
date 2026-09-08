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

test('buildAgentCommand — Claude resume re-injects Artifact context', () => {
  const cmd = buildAgentCommand(TASK, '', { resume: true }, '/workspace/project')
  assert.ok(cmd.includes('--append-system-prompt'))
  assert.ok(cmd.includes('/workspace/project/vf-abc123.artifacts/'))
  assert.ok(cmd.includes('請接續這個任務'))
})

test('executorSessionId — is valid, stable, and unique per run', () => {
  const first = executorSessionId('abcd1234', '11111111-1111-4111-8111-111111111111')
  const second = executorSessionId('abcd1234', '22222222-2222-4222-8222-222222222222')
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.equal(first, executorSessionId('abcd1234', '11111111-1111-4111-8111-111111111111'))
  assert.notEqual(first, second)
})
