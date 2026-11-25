import test from 'node:test'
import assert from 'node:assert/strict'
import { cardMove } from '../renderer/lib/board-moves.ts'

test('cardMove — a Backlog card starts in In Progress and cannot skip to Done', () => {
  assert.equal(cardMove('backlog', 'in_progress'), 'start')
  assert.equal(cardMove('backlog', 'done'), null)
})

test('cardMove — an In Progress card completes forward or returns to Backlog', () => {
  assert.equal(cardMove('in_progress', 'done'), 'complete')
  assert.equal(cardMove('in_progress', 'backlog'), 'return')
})

test('cardMove — a Done card can be pulled back to either column', () => {
  assert.equal(cardMove('done', 'backlog'), 'reopen')
  assert.equal(cardMove('done', 'in_progress'), 'rerun')
})

test('cardMove — a Backlog card goes into inventory; an inventory card goes back or on to In Progress', () => {
  assert.equal(cardMove('backlog', 'inventory'), 'inventory')
  assert.equal(cardMove('inventory', 'backlog'), 'uninventory')
  assert.equal(cardMove('inventory', 'in_progress'), 'release')
  assert.equal(cardMove('inventory', 'done'), null)
  assert.equal(cardMove('in_progress', 'inventory'), null)
  assert.equal(cardMove('done', 'inventory'), null)
})

test('cardMove — dropping on its own column does nothing', () => {
  for (const column of ['backlog', 'inventory', 'in_progress', 'done']) {
    assert.equal(cardMove(column, column), null)
  }
})
