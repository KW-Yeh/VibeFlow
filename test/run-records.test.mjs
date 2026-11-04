import test from 'node:test'
import assert from 'node:assert/strict'

import { AGENT_CLIS } from '../packages/core/src/agents.ts'
import { normalizeUsage } from '../packages/core/src/progress.ts'
import { normalizeRuns, runKey, upsertRun } from '../packages/core/src/run-records.ts'

const usage = { input: 10, output: 20, cacheRead: 300, cacheWrite: 40, reasoning: 5 }

const run = (overrides = {}) => ({
  startedAt: 1000,
  endedAt: 2000,
  endedBy: 'restart',
  agent: 'claude',
  sessionIds: ['s1'],
  modelSource: 'jev',
  usage,
  calls: 7,
  ...overrides,
})

test('normalizeRuns — anything that is not an array of records is no records', () => {
  for (const value of [undefined, null, 'x', 5, {}, { 0: run() }]) assert.deepEqual(normalizeRuns(value), [])
  assert.deepEqual(normalizeRuns([run()]), [run()])
})

test('normalizeRuns — drops records missing a required field, keeps the rest in order', () => {
  const kept = [run({ startedAt: 1 }), run({ startedAt: 3, endedBy: 'completed' })]
  const bad = [
    null,
    'x',
    run({ startedAt: 'now' }),
    run({ endedAt: Number.NaN }),
    run({ endedBy: 'crashed' }),
    run({ agent: 'gemini' }),
    run({ modelSource: 'guess' }),
  ]
  assert.deepEqual(normalizeRuns([kept[0], ...bad, kept[1]]), kept)
})

test('normalizeRuns — optional fields are kept only when valid; numbers and lists are repaired', () => {
  const [full] = normalizeRuns([run({ runId: 'r1', model: 'opus', effort: 'high', complexity: 'complex', scoutModel: 'opus' })])
  assert.equal(full.runId, 'r1')
  assert.equal(full.model, 'opus')
  assert.equal(full.effort, 'high')
  assert.equal(full.complexity, 'complex')
  assert.equal(full.scoutModel, 'opus')

  const [repaired] = normalizeRuns([
    run({ runId: '', model: 7, effort: null, complexity: 'huge', scoutModel: '', sessionIds: ['a', 3, '', 'b'], usage: { input: 'x', output: -4, cacheRead: 9 }, calls: -2 }),
  ])
  for (const key of ['runId', 'model', 'effort', 'complexity', 'scoutModel']) assert.ok(!(key in repaired), key)
  assert.deepEqual(repaired.sessionIds, ['a', 'b'])
  assert.deepEqual(repaired.usage, { input: 0, output: 0, cacheRead: 9, cacheWrite: 0, reasoning: 0 })
  assert.equal(repaired.calls, 0)

  const [noLists] = normalizeRuns([run({ sessionIds: undefined, usage: undefined, calls: undefined })])
  assert.deepEqual(noLists.sessionIds, [])
  assert.deepEqual(noLists.usage, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 })
})

test('normalizeRuns — usage is read the same way progress.normalizeUsage reads it', () => {
  for (const value of [usage, { input: 5, output: 'x' }, {}, null, 'x', { input: Number.NaN, cacheRead: 2 }]) {
    assert.deepEqual(normalizeRuns([run({ usage: value })])[0].usage, normalizeUsage(value) ?? normalizeUsage({}))
  }
})

test('normalizeRuns — every agent the board can launch is accepted', () => {
  for (const { id } of AGENT_CLIS) assert.equal(normalizeRuns([run({ agent: id })]).length, 1, id)
})

test('runKey — a restart id and the launch time make a run; a first run has no id', () => {
  assert.equal(runKey({ startedAt: 5 }), ':5')
  assert.equal(runKey({ runId: 'r', startedAt: 5 }), 'r:5')
  assert.notEqual(runKey({ runId: 'r', startedAt: 5 }), runKey({ runId: 'r', startedAt: 6 }))
})

test('upsertRun — a new run is appended; the same run is replaced in place', () => {
  const first = run({ startedAt: 1, endedBy: 'restart' })
  const second = run({ runId: 'r2', startedAt: 5, endedBy: 'completed' })
  let runs = upsertRun(undefined, first)
  assert.deepEqual(runs, [first])
  runs = upsertRun(runs, second)
  assert.deepEqual(runs, [first, second])

  const reopened = { ...first, endedAt: 9000, endedBy: 'completed', calls: 99 }
  const again = upsertRun(runs, reopened)
  assert.deepEqual(again, [reopened, second])
  assert.equal(again.length, 2)
})

test('upsertRun — records that cannot be read are dropped, not carried along', () => {
  const next = run({ startedAt: 4 })
  assert.deepEqual(upsertRun('garbage', next), [next])
  assert.deepEqual(upsertRun([{ nope: true }, run({ startedAt: 2 })], next), [run({ startedAt: 2 }), next])
})
