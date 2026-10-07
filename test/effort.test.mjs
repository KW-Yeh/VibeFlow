import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AGENT_EFFORTS,
  UNKNOWN_MODEL_EFFORTS,
  allowedEfforts,
  clampEffort,
  isAgentEffort,
  selectableEfforts,
} from '../packages/core/src/effort.ts'

const opus46 = { id: 'claude-opus-4-6', label: 'Opus 4.6', efforts: ['low', 'medium', 'high', 'max'] }
const opus = { id: 'opus', label: 'Opus 5.5', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] }
const haiku = { id: 'haiku', label: 'Haiku 4.5', efforts: [] }
const builtin = { id: 'sonnet', label: 'Sonnet' }

test('levels are ordered shallow → deep and validated', () => {
  assert.deepEqual(AGENT_EFFORTS, ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'])
  assert.ok(isAgentEffort('ultra'))
  assert.ok(!isAgentEffort('minimal'))
  assert.ok(!isAgentEffort(undefined))
})

test('allowedEfforts distinguishes unknown, none and declared', () => {
  assert.equal(allowedEfforts(undefined), null)
  assert.equal(allowedEfforts(builtin), null)
  assert.deepEqual(allowedEfforts(haiku), [])
  assert.deepEqual(allowedEfforts(opus46), ['low', 'medium', 'high', 'max'])
})

test('selectableEfforts offers the pre-catalog four levels when the model is unknown', () => {
  assert.deepEqual(selectableEfforts(builtin), UNKNOWN_MODEL_EFFORTS)
  assert.deepEqual(selectableEfforts(undefined), ['low', 'medium', 'high', 'xhigh'])
  assert.deepEqual(selectableEfforts(haiku), [])
})

test('clampEffort keeps allowed levels and lowers unsupported ones without exceeding them', () => {
  assert.equal(clampEffort('high', opus46.efforts), 'high')
  assert.equal(clampEffort('xhigh', opus46.efforts), 'high')
  assert.equal(clampEffort('ultra', opus.efforts), 'max')
  assert.equal(clampEffort('max', UNKNOWN_MODEL_EFFORTS), 'xhigh')
})

test('clampEffort drops effort for a model that takes none', () => {
  assert.equal(clampEffort('high', []), undefined)
})

test('clampEffort falls back to the shallowest allowed level when every allowed level is deeper', () => {
  assert.equal(clampEffort('low', ['high', 'max']), 'high')
})

test('clampEffort leaves an unset effort unset', () => {
  assert.equal(clampEffort(undefined, opus.efforts), undefined)
})
