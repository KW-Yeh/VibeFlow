import test from 'node:test'
import assert from 'node:assert/strict'
import { clampSelection, moveCard } from '../packages/tui/src/index.ts'

const card = (id) => ({ id, title: id, branch: `b-${id}` })
const board = () => ({ backlog: [card('a'), card('b')], in_progress: [card('c')], done: [] })

test('starting a Backlog card stamps it and asks for a launch', () => {
  const move = moveCard(board(), { column: 0, index: 1 }, 1, 42)
  assert.equal(move.effect, 'launch')
  assert.equal(move.to, 'in_progress')
  assert.deepEqual(move.board.in_progress.map((t) => t.id), ['b', 'c'])
  assert.equal(move.board.in_progress[0].launchedAt, 42)
  assert.deepEqual(move.board.backlog.map((t) => t.id), ['a'])
})

test('finishing asks for cleanup; sending a running card back asks for a reset', () => {
  assert.equal(moveCard(board(), { column: 1, index: 0 }, 1).effect, 'cleanup')
  assert.equal(moveCard(board(), { column: 1, index: 0 }, -1).effect, 'reset')
})

test('there is nothing left of Backlog or right of Done', () => {
  assert.equal(moveCard(board(), { column: 0, index: 0 }, -1), null)
  assert.equal(moveCard(board(), { column: 2, index: 0 }, 1), null)
})

test('the selection stays inside the board as it changes', () => {
  assert.deepEqual(clampSelection(board(), { column: 5, index: 9 }), { column: 2, index: 0 })
  assert.deepEqual(clampSelection(board(), { column: 0, index: 9 }), { column: 0, index: 1 })
  assert.deepEqual(clampSelection(board(), { column: -1, index: -1 }), { column: 0, index: 0 })
})

test('Ctrl+] is found as a plain byte and in win32-input-mode', async () => {
  const { findDetachKey } = await import('../packages/tui/src/index.ts')
  assert.equal(findDetachKey('ab\x1dcd'), 2)
  // What Windows Terminal sends for Ctrl+] once a ConPTY asked for ?9001h.
  assert.equal(findDetachKey('x\x1b[17;29;0;1;8;1_\x1b[221;27;29;1;8;1_'), 17)
  // Key up of the same key does not count, nor does another key.
  assert.equal(findDetachKey('\x1b[221;27;29;0;8;1_\x1b[88;45;120;1;0;1_'), -1)
})
