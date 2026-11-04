import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
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

const statsRun = (overrides) => ({
  startedAt: 1,
  endedAt: 2,
  endedBy: 'completed',
  agent: 'claude',
  sessionIds: [],
  modelSource: 'jev',
  usage: { input: 0, output: 100, cacheRead: 900, cacheWrite: 0, reasoning: 0 },
  calls: 10,
  ...overrides,
})

/** A store holding finished cards: two with run records, one from before records existed. */
async function seededStore(t) {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-task-cli-'))
  t.after(() => fs.rm(storeDir, { recursive: true, force: true }))
  const card = (id, runs) => ({ id, title: id, branch: `vf-${id}`, ...(runs ? { runs } : {}) })
  const simple = { complexity: 'simple', model: 'haiku', effort: 'low' }
  await fs.writeFile(
    path.join(storeDir, 'vibeflow-state.json'),
    JSON.stringify({
      version: 4,
      projectPath: null,
      settings: { autoMode: true },
      board: {
        backlog: [],
        in_progress: [],
        done: [
          card('a', [statsRun(simple)]),
          card('b', [statsRun({ ...simple, endedBy: 'restart', usage: { input: 0, output: 100, cacheRead: 2900, cacheWrite: 0, reasoning: 0 }, calls: 20 })]),
          card('old'),
        ],
      },
    })
  )
  return storeDir
}

test('task stats reads the run records from the store, with no host', async (t) => {
  const storeDir = await seededStore(t)
  const out = await task(['stats', '--store-path', storeDir])
  assert.equal(out.ok, true)
  assert.deepEqual([out.runs, out.cards, out.cardsWithoutRuns], [2, 2, 1])
  assert.deepEqual(out.groups, [{
    complexity: 'simple', model: 'haiku', effort: 'low',
    runs: 2, cards: 2,
    medianTokens: 2000, // (1000 + 3000) / 2
    medianCalls: 15,
    medianContextPerCall: 118, // (90 + 145) / 2 = 117.5
    restartRate: 0.5,
  }])
})

test('task stats --table prints a table, not the JSON envelope', async (t) => {
  const storeDir = await seededStore(t)
  const { stdout } = await run(
    process.execPath,
    ['--experimental-strip-types', '--import', './test/support/register.mjs', 'scripts/vibeflow.mjs', 'task', 'stats', '--table', '--store-path', storeDir],
    { cwd: root }
  )
  const lines = stdout.trimEnd().split('\n')
  assert.match(lines[0], /^complexity\s+model\s+effort\s+runs\s+cards\s+tokens\s+calls\s+ctx\/call\s+restarted$/)
  assert.match(lines[1], /^simple\s+haiku\s+low\s+2\s+2\s+2000\s+15\s+118\s+50%$/)
  assert.match(stdout, /2 runs on 2 cards; 1 cards without run records skipped\./)
  assert.throws(() => JSON.parse(stdout))
})

test('task stats on a store with no records is an empty report', async (t) => {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-task-cli-'))
  t.after(() => fs.rm(storeDir, { recursive: true, force: true }))
  const out = await task(['stats', '--store-path', storeDir])
  assert.deepEqual([out.ok, out.groups, out.runs, out.cards], [true, [], 0, 0])
})
