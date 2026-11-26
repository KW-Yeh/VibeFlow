import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { getStoreAtPath } from '../packages/core/src/store.ts'
import { makeRepo } from './support/repo.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const run = promisify(execFile)

/** The `vibeflow task …` CLI as an agent's shell runs it; `env` is that shell's. */
async function task(args, env = {}) {
  const { VIBEFLOW_TASK_ID, ...inherited } = process.env
  const { stdout } = await run(
    process.execPath,
    ['--experimental-strip-types', '--import', './test/support/register.mjs', 'scripts/vibeflow.mjs', 'task', ...args],
    { cwd: root, env: { ...inherited, ...env } }
  ).catch((err) => err)
  return JSON.parse(stdout)
}

test('a card created from a master shell belongs to that master unless told otherwise', async (t) => {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-task-cli-'))
  const { projectPath, cleanup } = await makeRepo({ withRemote: false })
  t.after(() => Promise.all([cleanup(), fs.rm(storeDir, { recursive: true, force: true })]))
  const store = ['--store-path', storeDir]
  const create = (title, env, extra = []) =>
    task(['create', '--project', projectPath, '--title', title, '--prompt', 'p', ...store, ...extra], env).then((r) => r.task)

  const master = (await task(['create', '--role', 'master', '--title', 'M', '--prompt', 'p', ...store])).task
  const other = (await task(['create', '--role', 'master', '--title', 'M2', '--prompt', 'p', ...store])).task
  const fromMaster = await create('S', { VIBEFLOW_TASK_ID: master.id })
  assert.equal(fromMaster.masterId, master.id)
  assert.equal((await create('S2', { VIBEFLOW_TASK_ID: fromMaster.id })).masterId, null, 'a slave shell is not a master')
  assert.equal((await create('S3', {})).masterId, null, 'no card shell at all')
  assert.equal((await create('S4', { VIBEFLOW_TASK_ID: master.id }, ['--master', other.id])).masterId, other.id)
})

test('task send needs a running host and says so', async () => {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-task-cli-'))
  const out = await task(['send', '--task', 'abc', '--text', 'hi', '--store-path', storeDir], { VIBEFLOW_TASK_ID: 'def' })
  assert.equal(out.error.code, 'HOST_NOT_RUNNING')
  const missing = await task(['send', '--task', 'abc', '--store-path', storeDir])
  assert.equal(missing.error.code, 'MISSING_ARGUMENT')
  await fs.rm(storeDir, { recursive: true, force: true })
})

test('task start --new-session needs a running host; a misplaced flag fails before it', async (t) => {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-task-cli-'))
  t.after(() => fs.rm(storeDir, { recursive: true, force: true }))
  const store = ['--store-path', storeDir]
  assert.equal((await task(['start', '--task', 'abc', '--new-session', ...store])).error.code, 'HOST_NOT_RUNNING')
  assert.equal((await task(['start', '--task', 'abc', '--new-session', '--force', ...store])).error.code, 'HOST_NOT_RUNNING')
  assert.equal((await task(['start', '--task', 'abc', '--force', ...store])).error.code, 'INVALID_ARGUMENT', '--force alone has nothing to force')
  assert.equal((await task(['send', '--task', 'abc', '--text', 'x', '--new-session', ...store], { VIBEFLOW_TASK_ID: 'def' })).error.code, 'INVALID_ARGUMENT')
  assert.equal((await task(['start', '--new-session', ...store])).error.code, 'MISSING_ARGUMENT')
})

test('task create --no-branch records a branchless card and refuses --branch with it', async (t) => {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-task-cli-'))
  const workstation = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-task-cli-ws-'))
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-task-cli-folder-'))
  t.after(() => Promise.all([storeDir, workstation, folder].map((d) => fs.rm(d, { recursive: true, force: true }))))
  getStoreAtPath(storeDir).set('settings', { autoMode: true, workstationPath: workstation })
  const args = ['create', '--project', folder, '--title', 'T', '--prompt', 'p', '--store-path', storeDir]

  const { task: card } = await task([...args, '--no-branch'])
  assert.equal(card.noBranch, true)
  assert.equal(card.branch, '')
  assert.equal((await task(args)).error.code, 'PROJECT_NOT_GIT_REPO')
  assert.equal((await task([...args, '--no-branch', '--branch', 'x'])).error.code, 'INVALID_ARGUMENT')
})

test('a master names related projects and its cards wait on each other with --after', async (t) => {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-task-cli-'))
  const { projectPath, cleanup } = await makeRepo({ withRemote: false })
  t.after(() => Promise.all([cleanup(), fs.rm(storeDir, { recursive: true, force: true })]))
  const store = ['--store-path', storeDir]
  const master = (await task(['create', '--role', 'master', '--title', 'M', '--prompt', 'p', '--project', projectPath, '--project', projectPath, ...store])).task
  assert.deepEqual(master.projects, [projectPath])
  const card = (title, extra = []) =>
    task(['create', '--project', projectPath, '--title', title, '--prompt', 'p', '--master', master.id, ...store, ...extra])
  const api = (await card('API')).task
  const ui = (await card('UI', ['--after', api.id])).task
  assert.deepEqual(ui.after, [api.id])
  assert.equal((await card('Loop', ['--after', 'nope1234'])).error.code, 'INVALID_DEPENDENCY')
  assert.equal((await task(['update', '--task', api.id, '--after', ui.id, ...store])).error.code, 'INVALID_DEPENDENCY', 'a loop')
  assert.deepEqual((await task(['update', '--task', ui.id, '--after', 'none', ...store])).task.after, [])
  assert.equal((await task(['create', '--project', projectPath, '--project', projectPath, '--title', 'X', '--prompt', 'p', ...store])).error.code, 'INVALID_ARGUMENT')
  assert.equal((await task(['create', '--role', 'master', '--title', 'X', '--prompt', 'p', '--after', api.id, ...store])).error.code, 'INVALID_ARGUMENT')
})

/** `vibeflow tag …`, run the same way as `task`. */
async function tagCli(args, env = {}) {
  const { VIBEFLOW_TASK_ID, VIBEFLOW_STORE_DIR, ...inherited } = process.env
  const { stdout } = await run(
    process.execPath,
    ['--experimental-strip-types', '--import', './test/support/register.mjs', 'scripts/vibeflow.mjs', 'tag', ...args],
    { cwd: root, env: { ...inherited, ...env } }
  ).catch((err) => err)
  return JSON.parse(stdout)
}

async function seededStore(t) {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-tag-cli-'))
  t.after(() => fs.rm(storeDir, { recursive: true, force: true }))
  const card = (id) => ({ id, title: id, branch: '' })
  getStoreAtPath(storeDir).set('board', { backlog: [card('a'), card('b'), card('c')], in_progress: [card('run')], done: [card('fin')] })
  return storeDir
}

test('an agent tags its own card from its shell, by name, without a host', async (t) => {
  const storeDir = await seededStore(t)
  const shell = { VIBEFLOW_TASK_ID: 'run', VIBEFLOW_STORE_DIR: storeDir }
  const added = await task(['tag', '--add', '等待 JFrog 簽核', '--add', 'Blocked', '--color', 'amber'], shell)
  assert.equal(added.ok, true)
  assert.deepEqual(added.task.tags.map((x) => [x.name, x.color]), [['等待 JFrog 簽核', 'amber'], ['Blocked', 'amber']])

  const removed = await task(['tag', '--remove', 'blocked'], shell)
  assert.deepEqual(removed.task.tags.map((x) => x.name), ['等待 JFrog 簽核'])

  const listed = await tagCli(['list'], { VIBEFLOW_STORE_DIR: storeDir })
  assert.deepEqual(listed.tags.map((x) => x.name), ['等待 JFrog 簽核', 'Blocked'])

  assert.equal((await task(['tag', '--task', 'fin', '--add', 'x', '--store-path', storeDir])).error.code, 'TASK_DONE')
  assert.equal((await task(['tag', '--task', 'run', '--add', 'x', '--color', 'pink', '--store-path', storeDir])).error.code, 'INVALID_ARGUMENT')
  assert.equal((await task(['tag', '--task', 'run', '--store-path', storeDir])).error.code, 'MISSING_ARGUMENT')
})

test('tag create, update and delete manage the board tags and their cards', async (t) => {
  const storeDir = await seededStore(t)
  const store = ['--store-path', storeDir]
  const created = await tagCli(['create', '--name', '等待 PL review PR', '--color', 'blue', ...store])
  assert.equal(created.tag.color, 'blue')
  assert.equal((await tagCli(['create', '--name', '等待 pl review pr', ...store])).error.code, 'TAG_EXISTS')
  await task(['tag', '--task', 'a', '--add', created.tag.id, ...store])

  const updated = await tagCli(['update', '--tag', '等待 PL review PR', '--name', 'PL review', '--color', 'purple', ...store])
  assert.deepEqual([updated.tag.id, updated.tag.name, updated.tag.color], [created.tag.id, 'PL review', 'purple'])
  assert.equal((await tagCli(['update', '--tag', 'nope', '--name', 'x', ...store])).error.code, 'UNKNOWN_TAG')

  await tagCli(['delete', '--tag', 'pl review', ...store])
  assert.equal(getStoreAtPath(storeDir).get('board').backlog[0].tags, undefined)
  assert.deepEqual((await tagCli(['list', ...store])).tags, [])
  assert.equal((await tagCli(['rename', ...store])).error.code, 'UNKNOWN_COMMAND')
})

test('task move reorders a card within its column', async (t) => {
  const storeDir = await seededStore(t)
  const store = ['--store-path', storeDir]
  const order = () => getStoreAtPath(storeDir).get('board').backlog.map((c) => c.id)
  assert.equal((await task(['move', '--task', 'c', '--top', ...store])).task.position, 0)
  assert.deepEqual(order(), ['c', 'a', 'b'])
  await task(['move', '--task', 'c', '--bottom', ...store])
  assert.deepEqual(order(), ['a', 'b', 'c'])
  await task(['move', '--task', 'a', '--after', 'b', ...store])
  assert.deepEqual(order(), ['b', 'a', 'c'])
  await task(['move', '--task', 'c', '--before', 'b', ...store])
  assert.deepEqual(order(), ['c', 'b', 'a'])
  assert.equal((await task(['move', '--task', 'a', '--before', 'run', ...store])).error.code, 'INVALID_MOVE')
  assert.equal((await task(['move', '--task', 'a', '--top', '--bottom', ...store])).error.code, 'MISSING_ARGUMENT')
})

test('task status --set replaces the card status and refuses an unknown one (AC-4)', async (t) => {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-task-cli-'))
  const { projectPath, cleanup } = await makeRepo({ withRemote: false })
  t.after(() => Promise.all([cleanup(), fs.rm(storeDir, { recursive: true, force: true })]))
  const store = ['--store-path', storeDir]
  const card = (await task(['create', '--project', projectPath, '--title', 'S', '--prompt', 'p', ...store])).task
  const ready = await task(['status', '--set', 'ready', ...store], { VIBEFLOW_TASK_ID: card.id })
  assert.equal(ready.task.status, 'ready')
  const stuck = await task(['status', '--task', card.id, '--set', '卡住', '--reason', '缺 token', ...store])
  assert.deepEqual([stuck.task.status, stuck.task.reason], ['stuck', '缺 token'])
  const saved = getStoreAtPath(storeDir).get('board').backlog[0]
  assert.deepEqual(saved.tags, ['status:stuck'])
  const tagCount = getStoreAtPath(storeDir).get('tags').length
  const unknown = await task(['status', '--task', card.id, '--set', '不存在的狀態', ...store])
  assert.equal(unknown.error.code, 'UNKNOWN_STATUS')
  assert.match(unknown.error.message, /stuck（卡住）/)
  assert.equal(getStoreAtPath(storeDir).get('tags').length, tagCount)
  assert.equal((await task(['status', '--task', card.id, ...store])).error.code, 'MISSING_ARGUMENT')
  assert.equal((await task(['status', '--task', card.id, '--clear', ...store])).task.status, null)
})

test('task create --kind ebug --ready puts an eBug card on tonight\'s list; dispatch needs a host (night shift)', async (t) => {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-task-cli-'))
  const { projectPath, cleanup } = await makeRepo({ withRemote: false })
  t.after(() => Promise.all([cleanup(), fs.rm(storeDir, { recursive: true, force: true })]))
  const store = ['--store-path', storeDir]
  const created = await task(['create', '--project', projectPath, '--title', 'Bugs', '--prompt', 'WCL260522-0003', '--kind', 'ebug', '--ready', ...store])
  assert.equal(created.task.kind, 'ebug')
  assert.equal(created.task.status, 'ready')
  const saved = getStoreAtPath(storeDir).get('board').backlog.find((c) => c.id === created.task.id)
  assert.equal(saved.kind, 'ebug')
  assert.ok(saved.tags.includes('status:ready'))
  assert.equal(saved.worktreePath, undefined)

  assert.equal((await task(['create', '--project', projectPath, '--title', 'x', '--prompt', 'p', '--kind', 'chore', ...store])).error.code, 'INVALID_ARGUMENT')
  assert.equal((await task(['create', '--role', 'master', '--title', 'M', '--prompt', 'p', '--ready', ...store])).error.code, 'INVALID_ARGUMENT')
  const updated = await task(['update', '--task', created.task.id, '--kind', 'feature', ...store])
  assert.equal(updated.ok, true)
  assert.equal(getStoreAtPath(storeDir).get('board').backlog.find((c) => c.id === created.task.id).kind, undefined)

  const { stdout } = await run(process.execPath, ['--experimental-strip-types', '--import', './test/support/register.mjs', 'scripts/vibeflow.mjs', 'dispatch', ...store], { cwd: root }).catch((err) => err)
  assert.equal(JSON.parse(stdout).error.code, 'HOST_NOT_RUNNING')
})
