import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import {
  listRecentProjects,
  recentProjectsFromBoard,
  rememberProject,
} from '../main/helpers/recent-projects.ts'
import { getStoreAtPath } from '../main/helpers/store.ts'
import { createTaskFromInput } from '../main/helpers/tasks.ts'
import { makeRepo } from './support/repo.mjs'

const existsOnly = (...paths) => (p) => paths.includes(p)

test('the picked project moves to the front without duplicating', () => {
  const list = [
    { path: '/a/web', name: 'web', lastUsedAt: 2 },
    { path: '/a/api', name: 'api', lastUsedAt: 1 },
  ]
  const next = rememberProject(list, '/a/api', 10, existsOnly('/a/web', '/a/api'))
  assert.deepEqual(next.map((p) => p.path), ['/a/api', '/a/web'])
  assert.equal(next[0].lastUsedAt, 10)
})

test('a same-named project whose old folder is gone is replaced by the new path', () => {
  const list = [{ path: '/old/web', name: 'web', lastUsedAt: 1 }]
  const next = rememberProject(list, '/new/web', 5, existsOnly('/new/web'))
  assert.deepEqual(next, [{ path: '/new/web', name: 'web', lastUsedAt: 5 }])
})

test('a same-named project that still exists is a different project and is kept', () => {
  const list = [{ path: '/work/web', name: 'web', lastUsedAt: 1 }]
  const next = rememberProject(list, '/side/web', 5, existsOnly('/work/web', '/side/web'))
  assert.deepEqual(next.map((p) => p.path), ['/side/web', '/work/web'])
})

test('listing flags entries whose folder no longer exists', () => {
  const store = {
    get: () => [
      { path: '/here', name: 'here', lastUsedAt: 2 },
      { path: '/gone', name: 'gone', lastUsedAt: 1 },
    ],
  }
  const listed = listRecentProjects(store, existsOnly('/here'))
  assert.deepEqual(listed.map((p) => [p.path, p.missing]), [['/here', false], ['/gone', true]])
})

test('seeding from the board keeps one entry per project, newest first', () => {
  const board = {
    backlog: [{ id: '1', title: '', branch: '', projectPath: '/p/a', createdAt: 1 }],
    in_progress: [{ id: '2', title: '', branch: '', projectPath: '/p/b', createdAt: 3 }],
    done: [
      { id: '3', title: '', branch: '', projectPath: '/p/a', createdAt: 5 },
      { id: '4', title: '', branch: '' },
    ],
  }
  assert.deepEqual(recentProjectsFromBoard(board), [
    { path: '/p/a', name: 'a', lastUsedAt: 5 },
    { path: '/p/b', name: 'b', lastUsedAt: 3 },
  ])
})

test('a v3 store is migrated with projects taken from its existing cards', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-recent-migrate-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  await fs.writeFile(
    path.join(dir, 'vibeflow-state.json'),
    JSON.stringify({
      version: 3,
      projectPath: null,
      board: {
        backlog: [{ id: '1', title: 't', branch: 'b', projectPath: '/p/legacy', createdAt: 7 }],
        in_progress: [],
        done: [],
      },
      settings: { autoMode: true },
    })
  )
  const store = getStoreAtPath(dir)
  assert.equal(store.get('version'), 4)
  assert.deepEqual(store.get('recentProjects'), [
    { path: '/p/legacy', name: 'legacy', lastUsedAt: 7 },
  ])
})

test('creating a task records its project as the most recent one', async (t) => {
  const { projectPath, cleanup } = await makeRepo()
  t.after(cleanup)
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-recent-create-'))
  const workstation = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-workstation-'))
  t.after(() => Promise.all([
    fs.rm(dir, { recursive: true, force: true }),
    fs.rm(workstation, { recursive: true, force: true }),
  ]))
  getStoreAtPath(dir).set('settings', { autoMode: true, workstationPath: workstation })

  await createTaskFromInput({
    title: 'Record project',
    branch: 'feat/record-project',
    projectPath,
    storePath: dir,
  })

  assert.equal(getStoreAtPath(dir).get('recentProjects')[0].path, projectPath)
})
