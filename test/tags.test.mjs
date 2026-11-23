import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { getStoreAtPath, moveTaskInColumn, writeBoard } from '../packages/core/src/store.ts'
import { createTag, deleteTag, setTaskTags, updateTag } from '../packages/core/src/tags.ts'
import { moveTaskFromInput } from '../packages/core/src/tasks.ts'

const card = (id, extra = {}) => ({ id, title: id, branch: '', ...extra })

async function storeWith(board, tags) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-tags-'))
  const store = getStoreAtPath(dir)
  store.set('board', board)
  if (tags) store.set('tags', tags)
  return { dir, store }
}

const ids = (column) => column.map((t) => t.id)

test('moveTaskInColumn places a card before another, or at the end', () => {
  const board = { backlog: [card('a'), card('b'), card('c')], in_progress: [], done: [] }
  assert.deepEqual(ids(moveTaskInColumn(board, 'c', 'a').backlog), ['c', 'a', 'b'])
  assert.deepEqual(ids(moveTaskInColumn(board, 'a', 'c').backlog), ['b', 'a', 'c'])
  assert.deepEqual(ids(moveTaskInColumn(board, 'a', null).backlog), ['b', 'c', 'a'])
})

test('moveTaskInColumn refuses an anchor in another column, itself or an unknown card', () => {
  const board = { backlog: [card('a'), card('b')], in_progress: [card('x')], done: [] }
  assert.equal(moveTaskInColumn(board, 'a', 'x'), null)
  assert.equal(moveTaskInColumn(board, 'a', 'a'), null)
  assert.equal(moveTaskInColumn(board, 'nope', null), null)
})

test('moveTaskFromInput persists the new order and reports INVALID_MOVE across columns', async () => {
  const { dir, store } = await storeWith({ backlog: [card('a'), card('b')], in_progress: [card('x')], done: [] })
  moveTaskFromInput({ taskId: 'b', beforeId: 'a', storePath: dir })
  assert.deepEqual(ids(store.get('board').backlog), ['b', 'a'])
  assert.throws(() => moveTaskFromInput({ taskId: 'a', beforeId: 'x', storePath: dir }), { code: 'INVALID_MOVE' })
  assert.throws(() => moveTaskFromInput({ taskId: 'zz', beforeId: null, storePath: dir }), { code: 'TASK_NOT_FOUND' })
})

test('a board write strips tags from Done cards only', async () => {
  const { store } = await storeWith({ backlog: [], in_progress: [], done: [] })
  writeBoard(store, {
    backlog: [card('a', { tags: ['t1'] })],
    in_progress: [card('b', { tags: ['t1'] })],
    done: [card('c', { tags: ['t1'] })],
  })
  const board = store.get('board')
  assert.deepEqual(board.backlog[0].tags, ['t1'])
  assert.deepEqual(board.in_progress[0].tags, ['t1'])
  assert.equal('tags' in board.done[0], false)
})

test('a store without tags gets an empty tag list and keeps its order', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-tags-'))
  await fs.writeFile(path.join(dir, 'vibeflow-state.json'), JSON.stringify({
    version: 4,
    projectPath: null,
    board: { backlog: [card('b'), card('a')], in_progress: [], done: [] },
    settings: {},
  }))
  const store = getStoreAtPath(dir)
  assert.deepEqual(store.get('tags'), [])
  assert.deepEqual(ids(store.get('board').backlog), ['b', 'a'])
})

test('tag names are trimmed, required and unique ignoring case', async () => {
  const { store } = await storeWith({ backlog: [], in_progress: [], done: [] })
  const tag = createTag(store, { name: '  等待 PL review PR ', color: 'amber' })
  assert.equal(tag.name, '等待 PL review PR')
  assert.equal(tag.color, 'amber')
  assert.match(tag.id, /^tag_[0-9a-f]{8}$/)
  assert.throws(() => createTag(store, { name: '等待 pl REVIEW pr' }), { code: 'TAG_EXISTS' })
  assert.throws(() => createTag(store, { name: '   ' }), { code: 'INVALID_TAG_NAME' })
  assert.throws(() => createTag(store, { name: 'x', color: '#ff0000' }), { code: 'INVALID_TAG_COLOR' })
})

test('a new tag without a colour takes the least used one', async () => {
  const { store } = await storeWith({ backlog: [], in_progress: [], done: [] })
  assert.equal(createTag(store, { name: 'a' }).color, 'gray')
  assert.equal(createTag(store, { name: 'b' }).color, 'red')
})

test('renaming and recolouring keeps the id cards refer to', async () => {
  const { store } = await storeWith({ backlog: [card('a')], in_progress: [], done: [] })
  const tag = createTag(store, { name: 'old', color: 'gray' })
  setTaskTags(store, { taskId: 'a', add: [tag.id] })
  updateTag(store, 'OLD', { name: 'new', color: 'teal' })
  assert.deepEqual(store.get('tags'), [{ id: tag.id, name: 'new', color: 'teal' }])
  assert.deepEqual(store.get('board').backlog[0].tags, [tag.id])
  createTag(store, { name: 'other' })
  assert.throws(() => updateTag(store, tag.id, { name: 'Other' }), { code: 'TAG_EXISTS' })
  assert.throws(() => updateTag(store, 'missing', { name: 'x' }), { code: 'UNKNOWN_TAG' })
})

test('deleting a tag removes it from every card', async () => {
  const { store } = await storeWith({ backlog: [card('a'), card('b')], in_progress: [], done: [] })
  const keep = createTag(store, { name: 'keep' })
  const gone = createTag(store, { name: 'gone' })
  setTaskTags(store, { taskId: 'a', add: [keep.id, gone.id] })
  setTaskTags(store, { taskId: 'b', add: [gone.id] })
  deleteTag(store, 'gone')
  const board = store.get('board')
  assert.deepEqual(board.backlog[0].tags, [keep.id])
  assert.equal('tags' in board.backlog[1], false)
  assert.deepEqual(store.get('tags').map((t) => t.name), ['keep'])
})

test('setTaskTags adds by name, creates unknown names, dedupes and removes', async () => {
  const { store } = await storeWith({ backlog: [], in_progress: [card('a')], done: [] })
  const existing = createTag(store, { name: '等待 JFrog 簽核', color: 'blue' })
  const { task, tags } = setTaskTags(store, { taskId: 'a', add: ['等待 jfrog 簽核', 'Blocked', existing.id], color: 'red' })
  const blocked = tags.find((t) => t.name === 'Blocked')
  assert.equal(blocked.color, 'red')
  assert.deepEqual(task.tags, [existing.id, blocked.id])
  setTaskTags(store, { taskId: 'a', remove: ['blocked'] })
  assert.deepEqual(store.get('board').in_progress[0].tags, [existing.id])
  // Removing a card's tag leaves the tag on the board.
  assert.equal(store.get('tags').length, 2)
})

test('setTaskTags refuses to tag a Done card and unknown refs', async () => {
  const { store } = await storeWith({ backlog: [card('a')], in_progress: [], done: [card('d')] })
  assert.throws(() => setTaskTags(store, { taskId: 'd', add: ['x'] }), { code: 'TASK_DONE' })
  assert.throws(() => setTaskTags(store, { taskId: 'a', remove: ['nope'] }), { code: 'UNKNOWN_TAG' })
  assert.throws(() => setTaskTags(store, { taskId: 'zz', add: ['x'] }), { code: 'TASK_NOT_FOUND' })
  // A refused call creates nothing.
  assert.deepEqual(store.get('tags'), [])
})
