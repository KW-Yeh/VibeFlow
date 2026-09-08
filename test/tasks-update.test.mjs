import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { updateTaskFromInput } from '../main/helpers/tasks.ts'
import { getStoreAtPath } from '../main/helpers/store.ts'

const CARD = {
  id: 'abc12345',
  title: 'Original title',
  description: 'Original description',
  branch: 'feature/original',
  projectPath: '/tmp/project',
  projectName: 'project',
  worktreePath: '/tmp/workspace/project-abc12345',
  workspacePath: '/tmp/workspace',
  baseBranch: 'main',
  agentCli: 'claude',
  effort: 'medium',
}

/** A throwaway store seeded with one backlog card, plus its directory. */
async function seedStore(board) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-tasks-update-'))
  const store = getStoreAtPath(dir)
  store.set('board', board ?? { backlog: [{ ...CARD }], in_progress: [], done: [] })
  return dir
}

function boardAt(dir) {
  return getStoreAtPath(dir).get('board')
}

test('title and description are patched in place', async () => {
  const dir = await seedStore()

  const { task, storePath } = updateTaskFromInput({
    taskId: CARD.id,
    title: '[索引] Original title',
    description: 'sub-card index',
    storePath: dir,
  })

  assert.equal(task.title, '[索引] Original title')
  assert.equal(task.description, 'sub-card index')
  assert.equal(storePath, path.join(dir, 'vibeflow-state.json'))
  assert.deepEqual(boardAt(dir).backlog[0], task)
})

test('provisioned fields survive an update', async () => {
  const dir = await seedStore()

  const { task } = updateTaskFromInput({
    taskId: CARD.id,
    title: 'Renamed',
    storePath: dir,
  })

  assert.equal(task.branch, CARD.branch)
  assert.equal(task.worktreePath, CARD.worktreePath)
  assert.equal(task.projectPath, CARD.projectPath)
  assert.equal(task.baseBranch, CARD.baseBranch)
  assert.equal(task.description, CARD.description, 'an absent description is left alone')
})

test('an empty description clears the field', async () => {
  const dir = await seedStore()

  const { task } = updateTaskFromInput({ taskId: CARD.id, description: '   ', storePath: dir })

  assert.equal(task.description, undefined)
  assert.equal('description' in boardAt(dir).backlog[0], false)
})

test('a blank title is ignored rather than blanking the card', async () => {
  const dir = await seedStore()

  const { task } = updateTaskFromInput({ taskId: CARD.id, title: '  ', storePath: dir })

  assert.equal(task.title, CARD.title)
})

test('status moves the card to the head of the target column', async () => {
  const other = { ...CARD, id: 'zzz99999', title: 'Already in progress' }
  const dir = await seedStore({
    backlog: [{ ...CARD }],
    in_progress: [other],
    done: [],
  })

  updateTaskFromInput({ taskId: CARD.id, status: 'in_progress', storePath: dir })

  const board = boardAt(dir)
  assert.deepEqual(board.backlog, [])
  assert.deepEqual(
    board.in_progress.map((t) => t.id),
    [CARD.id, other.id]
  )
})

test('an unknown card id fails with TASK_NOT_FOUND and writes nothing', async () => {
  const dir = await seedStore()

  assert.throws(
    () => updateTaskFromInput({ taskId: 'nope', title: 'x', storePath: dir }),
    (err) => err.code === 'TASK_NOT_FOUND'
  )
  assert.equal(boardAt(dir).backlog[0].title, CARD.title)
})
