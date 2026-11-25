import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { createReporter, reportPath, reportRows, reportTable } from '../packages/core/src/report.ts'
import { createCore } from '../packages/core/src/service.ts'
import { EventBus } from '../packages/core/src/events.ts'
import { createNodePlatform, setPlatform } from '../packages/core/src/platform.ts'
import { findTask, getStore, getStoreAtPath, updateTask } from '../packages/core/src/store.ts'
import { createTaskFromInput } from '../packages/core/src/tasks.ts'
import { setTaskStatus } from '../packages/core/src/status-tags.ts'
import { makeRepo } from './support/repo.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const card = (id, extra = {}) => ({ id, title: `Card ${id}`, branch: '', ...extra })
const board = (b) => ({ backlog: [], inventory: [], in_progress: [], done: [], ...b })
const usage = (n) => ({ input: n, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 })
const H = 3_600_000

const batch = () => ({
  id: 'b1',
  startedAt: 0,
  endedAt: 5 * H,
  taskIds: ['done1', 'run1', 'gone'],
  titles: { gone: 'Deleted card' },
  events: [
    { at: 0, taskId: 'done1', status: 'running', source: 'host' },
    { at: 2 * H, taskId: 'done1', status: 'pr_opened', reason: 'https://github.com/acme/x/pull/7', source: 'cli' },
    { at: H, taskId: 'run1', status: 'running', source: 'host' },
    { at: 2 * H, taskId: 'run1', status: 'quota_wait', reason: '額度重置時間 …', source: 'host' },
  ],
})

test('the table lists every released card with its last status, reason, usage, time and PR — a Done card from its events (AC-8)', () => {
  const b = board({
    done: [card('done1', { usage: usage(12_300) })],
    in_progress: [card('run1', { tags: ['status:quota_wait'], usage: usage(500) })],
  })
  const rows = reportRows(batch(), b, (t) => t.usage, 6 * H)
  assert.deepEqual(rows.map((r) => [r.taskId, r.status, r.inProgress]), [
    ['done1', 'pr_opened', false],
    ['run1', 'quota_wait', true],
    ['gone', null, false],
  ])
  assert.equal(rows[0].pr, 'https://github.com/acme/x/pull/7')
  assert.equal(rows[0].durationMs, 2 * H)
  assert.equal(rows[1].durationMs, 4 * H, 'a card still running counts to the end of the batch')
  const table = reportTable(batch(), rows)
  for (const part of ['| done1 Card done1 | 已完成 | 已完成（已開 PR）', '12k', '2 小時 0 分', 'https://github.com/acme/x/pull/7', '進行中（等待額度）', 'gone Deleted card', '## 狀態時間軸', '已開 PR（agent/CLI）']) {
    assert.ok(table.includes(part), part)
  }
})

/** Timers that only move when told. */
function fakeClock() {
  let now = 1_000
  const timers = []
  return {
    now: () => now,
    setTimer(fn, ms) { const t = { at: now + ms, fn }; timers.push(t); return t },
    clearTimer(t) { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1) },
    async advance(ms) {
      now += ms
      for (const t of timers.filter((x) => x.at <= now)) {
        timers.splice(timers.indexOf(t), 1)
        t.fn()
      }
      for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r))
    },
  }
}

async function reporterStore(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-report-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const store = getStoreAtPath(dir)
  store.set('board', board({ done: [card('done1')] }))
  return { dir, store }
}

test('with the agent out of quota the report keeps the table, is marked pending, and gets its narrative later (AC-9)', async (t) => {
  const { dir, store } = await reporterStore(t)
  store.set('batches', [batch()])
  const clock = fakeClock()
  let quota = false
  const reporter = createReporter({
    store: () => store, storeDir: () => dir, usageOf: (x) => x.usage, keep: () => 10, retryMs: () => 60_000, clock,
    narrate: async (prompt) => {
      assert.ok(prompt.includes('| 卡片 |'), 'the agent reads the table')
      if (!quota) throw new Error("You've hit your limit")
      return '三張卡中一張開了 PR。'
    },
  })
  t.after(() => reporter.stop())
  const entry = await reporter.create('b1')
  assert.equal(entry.status, 'pending')
  const pending = await fs.readFile(reportPath(dir, entry.id), 'utf8')
  assert.match(pending, /\| 卡片 \|/)
  assert.match(pending, /待補寫/)
  quota = true
  await clock.advance(60_000)
  const [done] = store.get('reports')
  assert.equal(done.status, 'complete')
  const text = await fs.readFile(reportPath(dir, entry.id), 'utf8')
  assert.match(text, /三張卡中一張開了 PR。/)
  assert.doesNotMatch(text, /待補寫/)
})

test('with 3 reports kept, the fourth deletes the oldest file and index entry (AC-10)', async (t) => {
  const { dir, store } = await reporterStore(t)
  const reporter = createReporter({ store: () => store, storeDir: () => dir, usageOf: () => undefined, keep: () => 3, retryMs: () => 1000, narrate: async () => 'ok', clock: fakeClock() })
  t.after(() => reporter.stop())
  const ids = []
  for (let i = 0; i < 4; i += 1) {
    store.set('batches', [...(store.get('batches') ?? []), { ...batch(), id: `b${i}` }])
    ids.push((await reporter.create(`b${i}`)).id)
  }
  const kept = store.get('reports').map((e) => e.id)
  assert.deepEqual(kept, ids.slice(1).reverse())
  await assert.rejects(fs.access(reportPath(dir, ids[0])))
  for (const id of ids.slice(1)) await fs.access(reportPath(dir, id))
  assert.ok(!store.get('batches').some((b) => b.id === 'b0'), 'the batch goes with its report')
})

test('a host restart picks pending reports up again', async (t) => {
  const { dir, store } = await reporterStore(t)
  store.set('batches', [batch()])
  const failing = createReporter({ store: () => store, storeDir: () => dir, usageOf: () => undefined, keep: () => 10, retryMs: () => 1000, narrate: async () => { throw new Error('x') }, clock: fakeClock() })
  await failing.create('b1')
  failing.stop()
  const clock = fakeClock()
  const next = createReporter({ store: () => store, storeDir: () => dir, usageOf: () => undefined, keep: () => 10, retryMs: () => 1000, narrate: async () => 'later', clock })
  t.after(() => next.stop())
  next.resumePending()
  await clock.advance(10_000_000)
  assert.equal(store.get('reports')[0].status, 'complete')
})

// --- through the host ---

const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-report-host-'))
const workstation = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-report-ws-'))
setPlatform(createNodePlatform({ userDataDir: storeDir }))
getStore().set('settings', { autoMode: true, workstationPath: workstation })
test.after(() => Promise.all([fs.rm(storeDir, { recursive: true, force: true }), fs.rm(workstation, { recursive: true, force: true })]))

const fakeSessions = () => ({
  kind: 'pty', starts: [], alive: new Set(),
  async start(key, opts) { this.starts.push({ key, ...opts }); this.alive.add(key); return { pid: 1, scrollback: null } },
  write() {}, resize() {}, async kill(key) { this.alive.delete(key) }, async isAlive(key) { return this.alive.has(key) },
  scrollback: () => null, async list() { return [...this.alive] }, shutdown() {},
})

const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms))

test('switching release off writes a report the host lists and reads, and the CLI shows (AC-8)', async (t) => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: false })
  t.after(cleanup)
  const runs = []
  const core = createCore({
    sessions: fakeSessions(), bus: new EventBus(), version: '9.9.9', prStatus: async () => null,
    agentRunner: async (bin, args, input) => { runs.push({ bin, args, input }); return '一張卡開了 PR。' },
  })
  t.after(() => core.shutdown())
  const { task } = await createTaskFromInput({ projectPath, title: 'Report me', status: 'inventory' })
  updateTask(task.id, { inventory: { finishedAt: Date.now(), docs: [] } })
  setTaskStatus(getStore(), { taskId: task.id, status: 'ready', source: 'host' })
  core.handlers['vibeflow:setRelease']({ enabled: true })
  await settle()
  assert.equal(findTask(task.id).tags.includes('status:running'), true)
  setTaskStatus(getStore(), { taskId: task.id, status: 'pr_opened', reason: 'https://github.com/acme/x/pull/9', source: 'cli' })
  await core.handlers['vibeflow:cleanupTask'](task.id).catch(() => {})
  core.handlers['vibeflow:setRelease']({ enabled: false })
  await settle()
  const [entry] = core.handlers['reports:list']()
  assert.equal(entry.status, 'complete')
  const { markdown } = core.handlers['reports:read'](entry.id)
  assert.ok(markdown.includes('Report me'))
  assert.ok(markdown.includes('https://github.com/acme/x/pull/9'))
  assert.ok(markdown.includes('一張卡開了 PR。'))
  const narrate = runs.find((r) => r.input.includes('| 卡片 |'))
  assert.deepEqual(narrate.args.slice(0, 4), ['-p', '--permission-mode', 'dontAsk', '--no-session-persistence'])
  assert.ok(narrate.args.includes('haiku') && narrate.args.includes('low'), 'the default report model and effort')
  assert.throws(() => core.handlers['reports:read']('../x'), /report id/)

  const run = promisify(execFile)
  const { stdout } = await run(process.execPath, ['--experimental-strip-types', '--import', './test/support/register.mjs', 'scripts/vibeflow.mjs', 'report', 'show', '--report', entry.id, '--store-path', storeDir], { cwd: root })
  assert.ok(stdout.includes('Report me'))
})
