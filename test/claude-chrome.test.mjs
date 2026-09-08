import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAgentCommand } from '../renderer/lib/claude.ts'

const CLAUDE_TASK = {
  id: 'abcd1234',
  title: '驗證瀏覽器流程',
  description: '使用 Chrome 執行 E2E 驗證。',
  agentCli: /** @type {'claude'} */ ('claude'),
  worktreePath: '/tmp/vibeflow/vf-abc123',
}

test('Claude launches enable Chrome for fresh and resumed sessions', () => {
  const fresh = buildAgentCommand(CLAUDE_TASK)
  assert.equal(fresh.match(/--chrome/g)?.length, 1)

  const resumed = buildAgentCommand(CLAUDE_TASK, undefined, { resume: true })
  assert.equal(resumed.match(/--chrome/g)?.length, 2)
})

test('non-Claude launches do not receive the Chrome flag', () => {
  const command = buildAgentCommand({
    ...CLAUDE_TASK,
    agentCli: /** @type {'codex'} */ ('codex'),
    model: 'gpt-5.5',
  })
  assert.ok(!command.includes('--chrome'))
})
