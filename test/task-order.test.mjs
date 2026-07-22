import test from 'node:test'
import assert from 'node:assert/strict'
import { compareTasksByNewestFirst } from '../renderer/lib/task-order.ts'

test('compareTasksByNewestFirst — sorts tasks newest first across statuses', () => {
  const tasks = [
    { id: 'older', status: 'backlog', createdAt: 100 },
    { id: 'newest', status: 'done', createdAt: 300 },
    { id: 'middle', status: 'in_progress', createdAt: 200 },
  ]

  assert.deepEqual(
    [...tasks].sort(compareTasksByNewestFirst).map((task) => task.id),
    ['newest', 'middle', 'older']
  )
})

test('compareTasksByNewestFirst — places missing timestamps after timestamped tasks', () => {
  const tasks = [
    { id: 'missing', status: 'done' },
    { id: 'older', status: 'backlog', createdAt: 100 },
    { id: 'newer', status: 'in_progress', createdAt: 200 },
  ]

  assert.deepEqual(
    [...tasks].sort(compareTasksByNewestFirst).map((task) => task.id),
    ['newer', 'older', 'missing']
  )
})

test('compareTasksByNewestFirst — returns equality for equal and missing timestamps', () => {
  assert.equal(
    compareTasksByNewestFirst({ createdAt: 200 }, { createdAt: 200 }),
    0
  )
  assert.equal(compareTasksByNewestFirst({}, {}), 0)
})
