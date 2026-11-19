import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { assertDependencies, updateTaskFromInput, createTaskFromInput } from '../packages/core/src/tasks.ts'
import { getStoreAtPath } from '../packages/core/src/store.ts'

const card = (id, extra = {}) => ({ id, title: id, branch: `vf-${id}`, ...extra })
const master = card('m1', { branch: '', role: 'master' })
const other = card('m2', { branch: '', role: 'master' })

function board(...cards) {
  return { backlog: cards, in_progress: [], done: [] }
}

function code(fn) {
  try { fn() } catch (err) { return err.code }
  return null
}

test('a card may wait on cards of its own master only', () => {
  const b = board(master, other, card('a', { masterId: 'm1' }), card('x', { masterId: 'm2' }), card('free'))
  assert.equal(code(() => assertDependencies(b, 'new', 'm1', ['a'])), null)
  assert.equal(code(() => assertDependencies(b, 'new', 'm1', ['x'])), 'INVALID_DEPENDENCY')
  assert.equal(code(() => assertDependencies(b, 'new', 'm1', ['free'])), 'INVALID_DEPENDENCY')
  assert.equal(code(() => assertDependencies(b, 'new', 'm1', ['nope'])), 'INVALID_DEPENDENCY')
  assert.equal(code(() => assertDependencies(b, 'new', undefined, ['a'])), 'INVALID_DEPENDENCY')
  assert.equal(code(() => assertDependencies(b, 'new', undefined, [])), null)
})

test('waits that loop or point at the card itself are refused', () => {
  const b = board(master, card('a', { masterId: 'm1', after: ['b'] }), card('b', { masterId: 'm1' }), card('c', { masterId: 'm1', after: ['a'] }))
  assert.equal(code(() => assertDependencies(b, 'b', 'm1', ['b'])), 'INVALID_DEPENDENCY')
  assert.equal(code(() => assertDependencies(b, 'b', 'm1', ['c'])), 'INVALID_DEPENDENCY')
  assert.equal(code(() => assertDependencies(b, 'c', 'm1', ['a', 'b'])), null)
})

async function seed(cards) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-deps-'))
  getStoreAtPath(dir).set('board', board(...cards))
  return dir
}

test('update sets, keeps and clears a card\'s waits', async () => {
  const dir = await seed([master, other, card('a', { masterId: 'm1' }), card('b', { masterId: 'm1' })])
  assert.deepEqual(updateTaskFromInput({ taskId: 'b', after: ['a', 'a'], storePath: dir }).task.after, ['a'])
  assert.deepEqual(updateTaskFromInput({ taskId: 'b', title: 'renamed', storePath: dir }).task.after, ['a'])
  assert.equal(updateTaskFromInput({ taskId: 'b', after: [], storePath: dir }).task.after, undefined)
  updateTaskFromInput({ taskId: 'b', after: ['a'], storePath: dir })
  // Moving to another master drops waits that no longer hold.
  assert.equal(updateTaskFromInput({ taskId: 'b', masterId: 'm2', storePath: dir }).task.after, undefined)
  assert.equal(code(() => updateTaskFromInput({ taskId: 'a', after: ['a'], storePath: dir })), 'INVALID_DEPENDENCY')
})

test('related projects belong to a master and must be existing folders', async () => {
  const dir = await seed([])
  const project = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-deps-project-'))
  const { task } = await createTaskFromInput({ role: 'master', title: 'plan', projects: [project, project], storePath: dir })
  assert.deepEqual(task.projects, [project])
  await assert.rejects(
    createTaskFromInput({ role: 'master', title: 'plan', projects: [path.join(project, 'missing')], storePath: dir }),
    { code: 'PROJECT_NOT_FOUND' }
  )
  await assert.rejects(
    createTaskFromInput({ projectPath: project, title: 'card', projects: [project], storePath: dir }),
    { code: 'INVALID_ARGUMENT' }
  )
  await assert.rejects(
    createTaskFromInput({ role: 'master', title: 'plan', after: ['x'], storePath: dir }),
    { code: 'INVALID_DEPENDENCY' }
  )
})
