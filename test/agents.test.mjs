import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  AGENT_CLIS,
  AGENT_EFFORTS,
  DEFAULT_TASK_EFFORT,
  defaultModelFor,
} from '../main/helpers/agents.ts'

test('AGENT_CLIS — keeps the supported agent registry lightweight and static', () => {
  assert.deepEqual(AGENT_CLIS.map((agent) => agent.id), ['claude', 'codex'])

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
})

test('DEFAULT_TASK_EFFORT — the renderer slider mirrors the value main creates tasks with', () => {
  assert.ok(AGENT_EFFORTS.includes(DEFAULT_TASK_EFFORT))

  // The renderer cannot import main at runtime, so the slider duplicates the
  // literal. Grep it back out to keep the two definitions from drifting.
  const slider = readFileSync(
    new URL('../renderer/components/task-effort-slider.tsx', import.meta.url),
    'utf8'
  )
  const match = slider.match(/DEFAULT_TASK_EFFORT:\s*AgentEffort\s*=\s*'([a-z]+)'/)
  assert.ok(match, 'renderer must declare DEFAULT_TASK_EFFORT')
  assert.equal(match[1], DEFAULT_TASK_EFFORT)
})
