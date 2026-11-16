import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createCore } from '../packages/core/src/service.ts'
import { EventBus } from '../packages/core/src/events.ts'
import { createNodePlatform, setPlatform } from '../packages/core/src/platform.ts'
import { getStore } from '../packages/core/src/store.ts'
import { exists, git, makeRepo, writeFile } from './support/repo.mjs'

function fakeSessions() {
  const alive = new Set()
  return {
    kind: 'pty',
    starts: [],
    alive,
    async start(key, opts) {
      this.starts.push({ key, ...opts })
      alive.add(key)
      return { pid: 1, scrollback: null }
    },
    write() {},
    resize() {},
    async kill(key) { alive.delete(key) },
    async isAlive(key) { return alive.has(key) },
    scrollback: () => null,
    discardScrollback() {},
    async list() { return Array.from(alive) },
    shutdown() {},
  }
}

const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-nobranch-'))
const workstation = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-nobranch-ws-'))
setPlatform(createNodePlatform({ userDataDir: storeDir }))
getStore().set('settings', { autoMode: true, workstationPath: workstation })

test.after(() =>
  Promise.all([
    fs.rm(storeDir, { recursive: true, force: true }),
    fs.rm(workstation, { recursive: true, force: true }),
  ])
)

function setup(t) {
  const sessions = fakeSessions()
  const core = createCore({ sessions, bus: new EventBus(), version: '9.9.9', prStatus: async () => null })
  t.after(() => core.shutdown())
  return { core, sessions }
}

const card = (core, id) => {
  const board = core.handlers['vibeflow:getState']().board
  return [...board.backlog, ...board.in_progress, ...board.done].find((t) => t.id === id)
}

const launch = (core, id) => core.handlers['pty:start']({ taskId: id, launch: {} })

async function plainFolder(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-nobranch-folder-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  await writeFile(dir, 'notes.md', 'keep me')
  return dir
}

test('a card created without a branch in a git project runs in a detached worktree and pushes nothing', async (t) => {
  const { core, sessions } = setup(t)
  const { projectPath, remotePath, cleanup } = await makeRepo()
  t.after(cleanup)
  const branchesBefore = await git(projectPath, 'branch', '--list')

  const { task } = await core.handlers['vibeflow:createTask']({
    projectPath, title: 'Investigate flaky test', createBranch: false, model: 'sonnet', // a named model skips Jev routing
  })
  assert.equal(task.noBranch, true)
  assert.equal(task.inPlace, undefined)
  assert.equal(task.branch, '')
  assert.equal(task.baseBranch, 'main')

  await launch(core, task.id)
  const running = card(core, task.id)
  assert.ok(running.worktreePath)
  assert.notEqual(running.worktreePath, projectPath)
  assert.equal(sessions.starts.at(-1).cwd, running.worktreePath)
  assert.equal(await git(running.worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD'), 'HEAD')
  assert.equal(await git(projectPath, 'branch', '--list'), branchesBefore)
  assert.equal(await git(remotePath, 'branch', '--list'), await git(remotePath, 'branch', '--list', 'main'))

  await core.handlers['vibeflow:deleteTask'](task.id)
  assert.equal(await exists(running.worktreePath), false)
  assert.equal(await git(projectPath, 'branch', '--list'), branchesBefore)
})

test('a git project still requires a repo when the branch is kept', async (t) => {
  const { core } = setup(t)
  const folder = await plainFolder(t)
  await assert.rejects(
    core.handlers['vibeflow:createTask']({ projectPath: folder, title: 'Needs git' }),
    /git repository/
  )
})

test('a card without a branch in a non-git folder runs in that folder and never touches it', async (t) => {
  const { core, sessions } = setup(t)
  const folder = await plainFolder(t)

  const { task } = await core.handlers['vibeflow:createTask']({
    projectPath: folder, title: 'Tidy notes', createBranch: false, model: 'sonnet',
  })
  assert.equal(task.inPlace, true)
  assert.equal(task.baseBranch, undefined)

  await launch(core, task.id)
  assert.equal(card(core, task.id).worktreePath, folder)
  assert.equal(sessions.starts.at(-1).cwd, folder)
  assert.deepEqual(await core.handlers['git:getDiffEntries'](task.id), [])
  assert.equal(await core.handlers['git:listCommits'](task.id), null)

  await core.handlers['vibeflow:resetTaskRun'](task.id)
  assert.equal(await exists(path.join(folder, 'notes.md')), true)

  await core.handlers['vibeflow:cleanupTask'](task.id)
  assert.equal(card(core, task.id).outcome, undefined)
  assert.equal(await exists(path.join(folder, 'notes.md')), true)

  await core.handlers['vibeflow:deleteTask'](task.id)
  assert.equal(await exists(path.join(folder, 'notes.md')), true)
})

test('createBranch must be a boolean over the wire', async (t) => {
  const { core } = setup(t)
  const folder = await plainFolder(t)
  await assert.rejects(
    core.handlers['vibeflow:createTask']({ projectPath: folder, title: 'x', createBranch: 'no' }),
    /createBranch/
  )
})
