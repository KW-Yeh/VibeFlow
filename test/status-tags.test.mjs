import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { getStoreAtPath, writeBoard } from '../packages/core/src/store.ts'
import { deleteTag, updateTag } from '../packages/core/src/tags.ts'
import {
  STATUS_KEYS,
  ensureStatusTags,
  resolveStatus,
  setTaskStatus,
  setTaskTagsWithStatus,
  statusTagId,
  taskStatus,
} from '../packages/core/src/status-tags.ts'

const card = (id, extra = {}) => ({ id, title: id, branch: '', ...extra })
const tempDirs = []
test.after(() => Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true }))))

async function storeWith(board, tags) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-status-'))
  tempDirs.push(dir)
  const store = getStoreAtPath(dir)
  writeBoard(store, { backlog: [], inventory: [], in_progress: [], done: [], ...board })
  if (tags) store.set('tags', tags)
  return store
}

const find = (store, id) => Object.values(store.get('board')).flat().find((t) => t.id === id)

test('the eight reserved status tags are added once, under fixed ids', async () => {
  const store = await storeWith({}, [{ id: 'tag_1', name: '卡住', color: 'gray' }])
  ensureStatusTags(store)
  ensureStatusTags(store)
  const tags = store.get('tags')
  assert.equal(tags.length, 9)
  for (const key of STATUS_KEYS) assert.ok(tags.some((t) => t.id === statusTagId(key)), key)
  assert.equal(tags.find((t) => t.id === 'status:stuck').name, '卡住（狀態）', 'a user tag keeps its name')
})

test('a renamed or recoloured status tag still resolves by key and by its new name', async () => {
  const store = await storeWith({ in_progress: [card('a')] })
  ensureStatusTags(store)
  updateTag(store, 'status:stuck', { name: 'Blocked', color: 'purple' })
  const tags = store.get('tags')
  assert.equal(resolveStatus(tags, 'stuck'), 'stuck')
  assert.equal(resolveStatus(tags, 'blocked'), 'stuck')
  assert.equal(resolveStatus(tags, '卡住'), null)
  setTaskStatus(store, { taskId: 'a', status: 'Blocked', source: 'cli' })
  assert.equal(taskStatus(find(store, 'a')), 'stuck')
})

test('setting a status replaces the old one, keeps ordinary tags and records the reason (AC-4)', async () => {
  const store = await storeWith({ in_progress: [card('a', { tags: ['tag_x', 'status:running'] })] }, [{ id: 'tag_x', name: 'x', color: 'red' }])
  const { task, status } = setTaskStatus(store, { taskId: 'a', status: '卡住', reason: 'JFrog token 失效', source: 'cli', now: 5 })
  assert.equal(status, 'stuck')
  assert.deepEqual(task.tags, ['tag_x', 'status:stuck'])
  assert.deepEqual(find(store, 'a').statusNote, { status: 'stuck', reason: 'JFrog token 失效', at: 5 })
})

test('an unknown status fails, lists the choices and creates no tag (AC-4)', async () => {
  const store = await storeWith({ in_progress: [card('a')] })
  ensureStatusTags(store)
  const before = store.get('tags').length
  assert.throws(() => setTaskStatus(store, { taskId: 'a', status: '不存在的狀態', source: 'cli' }), (err) => {
    assert.equal(err.code, 'UNKNOWN_STATUS')
    assert.match(err.message, /ready（準備開工）/)
    return true
  })
  assert.equal(store.get('tags').length, before)
  assert.equal(find(store, 'a').tags, undefined)
})

test('clearing a status removes the tag and the note; a Done card refuses one', async () => {
  const store = await storeWith({ in_progress: [card('a', { tags: ['status:ready'] })], done: [card('d')] })
  setTaskStatus(store, { taskId: 'a', status: null, source: 'cli' })
  assert.equal(find(store, 'a').tags, undefined)
  assert.throws(() => setTaskStatus(store, { taskId: 'd', status: 'ready', source: 'cli' }), { code: 'TASK_DONE' })
})

test('status tags cannot be deleted', async () => {
  const store = await storeWith({})
  ensureStatusTags(store)
  assert.throws(() => deleteTag(store, 'status:ready'), { code: 'RESERVED_TAG' })
})

test('a tag edit that adds a status tag drops the other one and is logged in the open batch as the user', async () => {
  const store = await storeWith({ in_progress: [card('a', { tags: ['status:running'] }), card('b')] })
  ensureStatusTags(store)
  store.set('release', { enabled: true, batchId: 'b1' })
  store.set('batches', [{ id: 'b1', startedAt: 1, taskIds: ['a'], events: [] }])
  setTaskTagsWithStatus(store, { taskId: 'a', add: ['已開 PR', 'misc'] }, 'user', 7)
  assert.deepEqual(find(store, 'a').tags.filter((id) => id.startsWith('status:')), ['status:pr_opened'])
  assert.ok(find(store, 'a').tags.some((id) => !id.startsWith('status:')), 'the ordinary tag is created and kept')
  setTaskTagsWithStatus(store, { taskId: 'a', remove: ['status:pr_opened'] }, 'user', 8)
  setTaskTagsWithStatus(store, { taskId: 'b', add: ['status:stuck'] }, 'user', 9)
  assert.deepEqual(store.get('batches')[0].events, [
    { at: 7, taskId: 'a', status: 'pr_opened', source: 'user' },
    { at: 8, taskId: 'a', status: null, source: 'user' },
  ], 'b is not in the batch, so its change is not logged there')
})

test('setTaskStatus logs only while the batch is open', async () => {
  const store = await storeWith({ in_progress: [card('a')] })
  store.set('release', { enabled: false, batchId: undefined })
  store.set('batches', [{ id: 'b1', startedAt: 1, endedAt: 2, taskIds: ['a'], events: [] }])
  setTaskStatus(store, { taskId: 'a', status: 'stuck', source: 'cli' })
  assert.deepEqual(store.get('batches')[0].events, [])
})
