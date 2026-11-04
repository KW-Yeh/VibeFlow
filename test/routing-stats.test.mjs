import test from 'node:test'
import assert from 'node:assert/strict'

import { median, routingStats } from '../packages/core/src/routing-stats.ts'

// A run whose tokens are `output` + `cacheRead`; the request context is cacheRead / calls.
const run = ({ output = 100, cacheRead, calls, endedBy = 'completed', ...rest }) => ({
  startedAt: 1,
  endedAt: 2,
  endedBy,
  agent: 'claude',
  sessionIds: [],
  modelSource: 'jev',
  usage: { input: 0, output, cacheRead, cacheWrite: 0, reasoning: 0 },
  calls,
  ...rest,
})
const card = (id, runs, extra = {}) => ({ id, title: id, branch: `vf-${id}`, ...(runs === undefined ? {} : { runs }), ...extra })

test('median — middle value, mean of the middle two, rounded; nothing is zero', () => {
  assert.equal(median([]), 0)
  assert.equal(median([3]), 3)
  assert.equal(median([5, 1, 3]), 3)
  assert.equal(median([1, 2]), 2)
  assert.equal(median([1, 4, 100, 7]), 6)
})

test('routingStats — groups by complexity × model × effort with medians and restart rate', () => {
  const haiku = { complexity: 'simple', model: 'haiku', effort: 'low' }
  const board = {
    backlog: [card('legacy', undefined, { usage: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1, reasoning: 0 } })],
    in_progress: [
      card('b', [run({ ...haiku, cacheRead: 2900, calls: 20, endedBy: 'restart' })]),
      card('broken', 'not records'),
      card('m', [run({ cacheRead: 400, output: 100, calls: 5, modelSource: 'cli' })], { role: 'master' }),
    ],
    done: [
      card('a', [run({ ...haiku, cacheRead: 900, calls: 10 })]),
      card('c', [run({ ...haiku, cacheRead: 1900, calls: 10 })]),
      card('d', [
        run({ complexity: 'moderate', model: 'sonnet', effort: 'medium', cacheRead: 4900, calls: 40, endedBy: 'restart' }),
        run({ complexity: 'moderate', model: 'sonnet', effort: 'medium', cacheRead: 6900, calls: 60 }),
      ]),
    ],
  }
  const stats = routingStats(board)

  assert.deepEqual([stats.runs, stats.cards, stats.cardsWithoutRuns], [6, 5, 2])
  assert.deepEqual(stats.groups.map((g) => [g.complexity, g.model, g.effort]), [
    ['simple', 'haiku', 'low'],
    ['moderate', 'sonnet', 'medium'],
    ['none', 'cli-default', 'default'],
  ])

  const [simple, moderate, none] = stats.groups
  assert.deepEqual(simple, {
    complexity: 'simple', model: 'haiku', effort: 'low',
    runs: 3, cards: 3,
    medianTokens: 2000, // 1000, 2000, 3000
    medianCalls: 10, // 10, 10, 20
    medianContextPerCall: 145, // 90, 145, 190
    restartRate: 1 / 3,
  })
  assert.deepEqual(moderate, {
    complexity: 'moderate', model: 'sonnet', effort: 'medium',
    runs: 2, cards: 1, // one card, two runs
    medianTokens: 6000, // 5000, 7000
    medianCalls: 50, // 40, 60
    medianContextPerCall: 119, // (122.5 + 115) / 2 = 118.75
    restartRate: 0.5,
  })
  assert.deepEqual(none, {
    complexity: 'none', model: 'cli-default', effort: 'default',
    runs: 1, cards: 1,
    medianTokens: 500, medianCalls: 5, medianContextPerCall: 80,
    restartRate: 0,
  })
})

test('routingStats — no records anywhere is an empty report that still counts the cards left out', () => {
  const board = { backlog: [card('x', undefined)], in_progress: [], done: [card('y', [])] }
  assert.deepEqual(routingStats(board), { groups: [], runs: 0, cards: 0, cardsWithoutRuns: 2 })
})

test('routingStats — a record with no calls adds to tokens but not to the per-request context', () => {
  const board = {
    backlog: [],
    in_progress: [],
    done: [card('z', [run({ cacheRead: 900, calls: 0 })])],
  }
  const [group] = routingStats(board).groups
  assert.equal(group.medianTokens, 1000)
  assert.equal(group.medianContextPerCall, 0)
})
