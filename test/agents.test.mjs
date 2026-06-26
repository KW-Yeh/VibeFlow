import test from 'node:test'
import assert from 'node:assert/strict'
import { AGENT_CLIS, defaultModelFor } from '../main/helpers/agents.ts'

test('AGENT_CLIS — keeps the supported agent registry lightweight and static', () => {
  assert.deepEqual(AGENT_CLIS.map((agent) => agent.id), [
    'claude',
    'codex',
    'gemini',
  ])

  const claudeModels = AGENT_CLIS.find((agent) => agent.id === 'claude')
    ?.models.map((model) => model.id)
  assert.deepEqual(claudeModels, ['sonnet', 'haiku', 'opus'])

  const codexModels = AGENT_CLIS.find((agent) => agent.id === 'codex')
    ?.models.map((model) => model.id)
  assert.deepEqual(codexModels, ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini'])
})

test('defaultModelFor — returns the first model for each agent', () => {
  assert.equal(defaultModelFor('claude'), 'sonnet')
  assert.equal(defaultModelFor('codex'), 'gpt-5.5')
  assert.equal(defaultModelFor('gemini'), 'gemini-2.5-flash')
})
