import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createHeartbeat, firstDueAt, RESET_BUFFER_MS } from '../packages/core/src/heartbeat.ts'
import { QUOTA_CONTINUE_MESSAGE, createCore } from '../packages/core/src/service.ts'
import { EventBus } from '../packages/core/src/events.ts'
import { createNodePlatform, setPlatform } from '../packages/core/src/platform.ts'
import { findTask, getStore } from '../packages/core/src/store.ts'
import { createTaskFromInput } from '../packages/core/src/tasks.ts'
import { executorSessionId } from '../packages/core/src/launch.ts'
import { claudeProjectDir } from '../packages/core/src/progress-tracker.ts'
import { setTaskStatus } from '../packages/core/src/status-tags.ts'
import { taskStatus } from '../packages/core/src/status-keys.ts'
import { makeRepo } from './support/repo.mjs'

/** Timers that only move when the test says so. */
function fakeClock(start = 1_000_000) {
  let now = start
  const timers = []
  return {
    now: () => now,
    setTimer(fn, ms) {
      const t = { at: now + ms, fn }
      timers.push(t)
      return t
    },
    clearTimer(t) {
      const i = timers.indexOf(t)
      if (i >= 0) timers.splice(i, 1)
    },
    pending: () => timers.map((t) => t.at).sort((a, b) => a - b),
    async advanceTo(at) {
      now = at
      for (;;) {
        const due = timers.filter((t) => t.at <= now).sort((a, b) => a.at - b.at)[0]
        if (!due) break
        timers.splice(timers.indexOf(due), 1)
        due.fn()
        await settle()
      }
      await settle()
    },
  }
}

const settle = async () => {
  for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r))
}

function waitsStore(initial) {
  const waits = new Map(Object.entries(initial))
  return {
    waits,
    waiting: () => [...waits].map(([taskId, wait]) => ({ taskId, wait })),
    reschedule: (taskId, nextProbeAt) => waits.set(taskId, { ...waits.get(taskId), nextProbeAt }),
  }
}

test('the first attempt is due a buffer after the reset, or one interval after the limit when no reset is known', () => {
  assert.equal(firstDueAt({ since: 0, agent: 'claude', phase: 'run', resetsAt: 5000 }, 60_000), 5000 + RESET_BUFFER_MS)
  assert.equal(firstDueAt({ since: 100, agent: 'claude', phase: 'run' }, 60_000), 60_100)
  assert.equal(firstDueAt({ since: 100, agent: 'claude', phase: 'run', resetsAt: 5000, nextProbeAt: 9 }, 60_000), 9)
})

test('a passing probe resumes the card; a failing one retries at the interval and remembers it', async () => {
  const clock = fakeClock()
  const store = waitsStore({ a: { since: clock.now(), agent: 'claude', phase: 'run', resetsAt: clock.now() + 1000 } })
  let accept = false
  const probes = []
  const resumed = []
  const hb = createHeartbeat({
    clock,
    ...store,
    probe: async (agent) => { probes.push(agent); return accept },
    resume: async (taskId) => { resumed.push(taskId); store.waits.delete(taskId); return 'done' },
    intervalMs: () => 300_000,
  })
  hb.sync()
  const due = clock.now() + 1000 + RESET_BUFFER_MS
  assert.deepEqual(clock.pending(), [due])
  await clock.advanceTo(due)
  assert.deepEqual(probes, ['claude'])
  assert.deepEqual(resumed, [])
  assert.equal(store.waits.get('a').nextProbeAt, due + 300_000, 'the next probe is stored for a restart')
  assert.deepEqual(clock.pending(), [due + 300_000])
  accept = true
  await clock.advanceTo(due + 300_000)
  assert.deepEqual(resumed, ['a'])
  hb.sync()
  assert.deepEqual(clock.pending(), [])
})

test('cards on different providers wait and carry on apart; one probe answers for a provider at a time', async () => {
  const clock = fakeClock()
  const store = waitsStore({
    a: { since: 0, agent: 'claude', phase: 'run', resetsAt: clock.now() },
    b: { since: 0, agent: 'claude', phase: 'run', resetsAt: clock.now() },
    c: { since: 0, agent: 'codex', phase: 'run', resetsAt: clock.now() + 10_000_000 },
  })
  const probes = []
  const resumed = []
  const hb = createHeartbeat({
    clock,
    ...store,
    probe: async (agent) => { probes.push(agent); return true },
    resume: async (taskId) => { resumed.push(taskId); store.waits.delete(taskId); return 'done' },
    intervalMs: () => 300_000,
  })
  hb.sync()
  await clock.advanceTo(clock.now() + RESET_BUFFER_MS)
  assert.deepEqual(resumed.sort(), ['a', 'b'])
  assert.ok(probes.filter((p) => p === 'claude').length <= 2)
  assert.ok(!probes.includes('codex'), 'the codex card is still before its reset')
  assert.ok(store.waits.has('c'))
})

test('a resume that cannot go through yet (someone is typing) is tried again later', async () => {
  const clock = fakeClock()
  const store = waitsStore({ a: { since: 0, agent: 'claude', phase: 'run', resetsAt: clock.now() } })
  let calls = 0
  const hb = createHeartbeat({
    clock,
    ...store,
    probe: async () => true,
    resume: async () => { calls += 1; if (calls === 1) return 'retry'; store.waits.delete('a'); return 'done' },
    intervalMs: () => 1000,
  })
  hb.sync()
  await clock.advanceTo(clock.now() + RESET_BUFFER_MS)
  assert.equal(calls, 1)
  await clock.advanceTo(clock.now() + 1000)
  assert.equal(calls, 2)
  hb.stop()
})

// --- through the host ---

const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-heartbeat-'))
const workstation = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-heartbeat-ws-'))
setPlatform(createNodePlatform({ userDataDir: storeDir }))
getStore().set('settings', { autoMode: true, workstationPath: workstation })
process.env.VIBEFLOW_QUIET_MS = '0'
test.after(() => Promise.all([
  fs.rm(storeDir, { recursive: true, force: true }),
  fs.rm(workstation, { recursive: true, force: true }),
]))

function fakeSessions() {
  const alive = new Set()
  return {
    kind: 'pty',
    starts: [],
    writes: [],
    alive,
    async start(key, opts) { this.starts.push({ key, ...opts }); alive.add(key); return { pid: 1, scrollback: null } },
    write(key, data) { this.writes.push({ key, data }) },
    resize() {},
    async kill(key) { alive.delete(key) },
    async isAlive(key) { return alive.has(key) },
    scrollback: () => null,
    async list() { return Array.from(alive) },
    shutdown() {},
  }
}

const iso = (ms) => new Date(ms).toISOString()
const prompt = (at) => JSON.stringify({ type: 'user', timestamp: iso(at), origin: { kind: 'human' }, message: { role: 'user', content: '請實作 A' } })
const limit = (at, resetsAtMs) => JSON.stringify({
  type: 'assistant', timestamp: iso(at), isApiErrorMessage: true, error: 'rate_limit', apiError: 'usage_limit_reached',
  quotaLimits: { status: 'rejected', resetsAt: Math.floor(resetsAtMs / 1000), rateLimitType: 'five_hour' },
  message: { id: `x${at}`, model: '<synthetic>', role: 'assistant', stop_reason: 'stop_sequence', content: [{ type: 'text', text: "You've hit your 5-hour limit" }] },
})
const answered = (at) => JSON.stringify({ type: 'assistant', timestamp: iso(at), message: { id: `m${at}`, model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: '要用哪個方案？' }] } })

async function runningCard(t) {
  const { projectPath, cleanup } = await makeRepo({ withRemote: false })
  t.after(cleanup)
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-heartbeat-home-'))
  t.after(() => fs.rm(home, { recursive: true, force: true }))
  const { task: created } = await createTaskFromInput({ projectPath, title: 'Limited card', status: 'in_progress' })
  const launchedAt = Date.now() - 60_000
  const board = getStore().get('board')
  getStore().set('board', { ...board, in_progress: board.in_progress.map((x) => (x.id === created.id ? { ...x, launchedAt } : x)) })
  setTaskStatus(getStore(), { taskId: created.id, status: 'running', source: 'host' })
  const dir = claudeProjectDir(home, created.worktreePath)
  await fs.mkdir(dir, { recursive: true })
  const transcript = path.join(dir, `${executorSessionId(created.id, created.runId)}.jsonl`)
  return { task: { ...created, launchedAt }, transcript, home }
}

function hostCore(t, home, { probe = async () => true } = {}) {
  const sessions = fakeSessions()
  const clock = fakeClock(Date.now())
  const probes = []
  const core = createCore({
    sessions,
    bus: new EventBus(),
    version: '9.9.9',
    homeDir: home,
    prStatus: async () => null,
    quotaProbe: async (agent) => { probes.push(agent); return probe(agent) },
    heartbeatClock: clock,
    resumeSettleMs: 0,
  })
  t.after(() => core.shutdown())
  return { core, sessions, clock, probes }
}

const append = (file, lines) => fs.appendFile(file, lines.map((l) => l + '\n').join(''))
const typed = (sessions, key) => sessions.writes.filter((w) => w.key === key).map((w) => w.data).join('')

test('a running card that hits its limit waits with the reset time, then gets "continue" once a probe passes (AC-6)', async (t) => {
  const { task, transcript, home } = await runningCard(t)
  const { core, sessions, clock, probes } = hostCore(t, home)
  sessions.alive.add(task.id)
  const resetsAt = Date.now() + 3_600_000
  await append(transcript, [prompt(Date.now() - 30_000), limit(Date.now() - 10_000, resetsAt)])
  await core.handlers['progress:get'](task.id)

  const waiting = findTask(task.id)
  assert.equal(taskStatus(waiting), 'quota_wait')
  assert.equal(waiting.quotaWait.resetsAt, Math.floor(resetsAt / 1000) * 1000)
  assert.equal(waiting.quotaWait.statusBefore, 'running')
  assert.ok(!waiting.tags.some((id) => id.includes(String(resetsAt))), 'the reset time is not in a tag name')
  assert.deepEqual(clock.pending(), [waiting.quotaWait.resetsAt + RESET_BUFFER_MS])

  await clock.advanceTo(waiting.quotaWait.resetsAt + RESET_BUFFER_MS)
  await new Promise((r) => setTimeout(r, 400))
  assert.deepEqual(probes, ['claude'])
  assert.ok(typed(sessions, task.id).includes(QUOTA_CONTINUE_MESSAGE), 'continue was typed into the same session')
  assert.equal(sessions.starts.length, 0, 'the live session was not restarted')
  const after = findTask(task.id)
  assert.equal(after.quotaWait, undefined)
  assert.equal(taskStatus(after), 'running', 'the status from before the wait is back')
})

test('a card waiting on a person after its limit is not sent "continue" (AC-6)', async (t) => {
  const { task, transcript, home } = await runningCard(t)
  const { core, sessions, clock } = hostCore(t, home)
  sessions.alive.add(task.id)
  await append(transcript, [prompt(Date.now() - 30_000), limit(Date.now() - 20_000, Date.now() + 1000)])
  await core.handlers['progress:get'](task.id)
  assert.ok(findTask(task.id).quotaWait)
  // The person carried it on by hand and the agent is now asking them something.
  await append(transcript, [prompt(Date.now() + 1), answered(Date.now() + 2)])
  await core.handlers['progress:get'](task.id)
  await clock.advanceTo(Date.now() + 10 * 60_000)
  await new Promise((r) => setTimeout(r, 300))
  assert.equal(typed(sessions, task.id), '')
  assert.equal(findTask(task.id).quotaWait, undefined)
})

test('a failed probe waits another interval; a host restart rebuilds the timer and resumes the ended session (AC-7)', async (t) => {
  const { task, transcript, home } = await runningCard(t)
  const first = hostCore(t, home, { probe: async () => false })
  first.sessions.alive.add(task.id)
  const resetsAt = Date.now() + 60_000
  await append(transcript, [prompt(Date.now() - 30_000), limit(Date.now() - 10_000, resetsAt)])
  await first.core.handlers['progress:get'](task.id)
  const wait = findTask(task.id).quotaWait
  await first.clock.advanceTo(wait.resetsAt + RESET_BUFFER_MS)
  const retryAt = findTask(task.id).quotaWait.nextProbeAt
  assert.equal(retryAt, wait.resetsAt + RESET_BUFFER_MS + 5 * 60_000, 'the default heartbeat interval is 5 minutes')
  first.core.shutdown()

  // A new host: the agent's session did not survive, the wait did.
  const second = hostCore(t, home)
  assert.deepEqual(second.clock.pending(), [retryAt])
  await second.clock.advanceTo(retryAt)
  await new Promise((r) => setTimeout(r, 400))
  assert.equal(second.sessions.starts.length, 1)
  assert.match(second.sessions.starts[0].command, /--resume/)
  assert.ok(typed(second.sessions, task.id).includes(QUOTA_CONTINUE_MESSAGE))
  assert.equal(findTask(task.id).quotaWait, undefined)
})
