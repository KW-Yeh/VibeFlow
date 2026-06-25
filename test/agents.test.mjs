import test from 'node:test'
import assert from 'node:assert/strict'
import { parseClaudeModelChoices, parseCodexModelChoices } from '../main/helpers/agents.ts'

test('parseClaudeModelChoices — extracts Claude /model choices from terminal output', () => {
  const output = [
    '\x1b[2J\x1b[HChoose model',
    '› Sonnet',
    '  Opus',
    '  Haiku',
    '  Claude Sonnet 4.5',
    '  Claude Code',
  ].join('\n')

  assert.deepEqual(parseClaudeModelChoices(output).map((model) => model.id), [
    'sonnet',
    'opus',
    'haiku',
    'claude-sonnet-4.5',
  ])
})

test('parseClaudeModelChoices — de-duplicates repeated Claude model labels', () => {
  const output = 'Current: Sonnet\nsonnet\nClaude Opus 4.1'

  assert.deepEqual(parseClaudeModelChoices(output).map((model) => model.id), [
    'sonnet',
    'claude-opus-4.1',
  ])
})

test('parseCodexModelChoices — extracts Codex /model choices from terminal output', () => {
  const output = [
    '\x1b[2J\x1b[HChoose model',
    '› GPT-5.4 Mini',
    '  GPT-5.5',
    '  GPT-5.4',
    '  text-embedding-3-large',
    '  gpt-5-codex',
  ].join('\n')

  assert.deepEqual(parseCodexModelChoices(output).map((model) => model.id), [
    'gpt-5.5',
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5-codex',
  ])
})

test('parseCodexModelChoices — de-duplicates repeated model labels', () => {
  const output = 'GPT-5.5\nCurrent: gpt-5.5\nGPT-5.4-mini'

  assert.deepEqual(parseCodexModelChoices(output).map((model) => model.id), [
    'gpt-5.5',
    'gpt-5.4-mini',
  ])
})
