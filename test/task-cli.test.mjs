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
