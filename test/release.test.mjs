import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { occupiedSlots, readyCards, releaseCandidates } from '../packages/core/src/release.ts'
import { createCore } from '../packages/core/src/service.ts'
import { EventBus } from '../packages/core/src/events.ts'
import { createNodePlatform, setPlatform } from '../packages/core/src/platform.ts'
import { findTask, getStore, updateTask } from '../packages/core/src/store.ts'
import { createTaskFromInput } from '../packages/core/src/tasks.ts'
import { executorSessionId } from '../packages/core/src/launch.ts'
import { setTaskStatus } from '../packages/core/src/status-tags.ts'
import { taskStatus } from '../packages/core/src/status-keys.ts'
import { makeRepo } from './support/repo.mjs'

const card = (id, extra = {}) => ({ id, title: id, branch: '', ...extra })
const board = (b) => ({ backlog: [], inventory: [], in_progress: [], done: [], ...b })

test('every non-master In Progress card holds a slot unless its status gave it back', () => {
  const b = board({
    in_progress: [
      card('manual'),
      card('run', { tags: ['status:running'] }),
      card('quota', { tags: ['status:quota_wait'] }),
      card('review', { tags: ['status:needs_review'] }),
      card('stuck', { tags: ['status:stuck'] }),
      card('pr', { tags: ['status:pr_opened'] }),
      card('m', { role: 'master' }),
    ],
  })
  assert.equal(occupiedSlots(b), 3)
})

test('ready cards are released in inventory-column order, up to the free slots', () => {
  const b = board({
    inventory: [card('a', { tags: ['status:ready'] }), card('q', { tags: ['status:needs_answer'] }), card('b', { tags: ['status:ready'] }), card('c', { tags: ['status:ready'] })],
    in_progress: [card('x')],
  })
  assert.deepEqual(readyCards(b).map((t) => t.id), ['a', 'b', 'c'])
  assert.deepEqual(releaseCandidates(b, 3).map((t) => t.id), ['a', 'b'])
  assert.deepEqual(releaseCandidates(b, 1), [])
})

// --- through the host ---

const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-release-'))
const workstation = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-release-ws-'))
setPlatform(createNodePlatform({ userDataDir: storeDir }))
getStore().set('settings', { autoMode: true, workstationPath: workstation })
test.after(() => Promise.all([
  fs.rm(storeDir, { recursive: true, force: true }),
  fs.rm(workstation, { recursive: true, force: true }),
]))

const fakeSessions = () => ({
  kind: 'pty', starts: [], alive: new Set(),
  async start(key, opts) { this.starts.push({ key, ...opts }); this.alive.add(key); return { pid: 1, scrollback: null } },
  write() {}, resize() {}, async kill(key) { this.alive.delete(key) }, async isAlive(key) { return this.alive.has(key) },
  scrollback: () => null, async list() { return [...this.alive] }, shutdown() {},
})

const settle = async (ms = 300) => {
  const end = Date.now() + ms
  while (Date.now() < end) await new Promise((r) => setTimeout(r, 10))
}

async function readyCard(projectPath, title) {
  const { task } = await createTaskFromInput({ projectPath, title, description: `做 ${title}`, status: 'inventory' })
  updateTask(task.id, { inventory: { finishedAt: Date.now(), passes: 1, docs: [`docs/features/${title}/plan.md`, `docs/features/${title}/spec.md`] } })
  setTaskStatus(getStore(), { taskId: task.id, status: 'ready', source: 'host' })
  return findTask(task.id)
}

async function releaseCore(t) {
  const { projectPath, cleanup } = await makeRepo({ withRemote: false })
  t.after(cleanup)
  // One store for the file: start each test from an empty board with the switch off.
  getStore().set('board', board({}))
  getStore().set('release', { enabled: false })
  getStore().set('batches', [])
  const sessions = fakeSessions()
  const bus = new EventBus()
  const core = createCore({ sessions, bus, version: '9.9.9', prStatus: async () => null, quotaProbe: async () => true })
  t.after(() => core.shutdown())
  return { core, sessions, bus, projectPath }
}

const columnIds = (col) => getStore().get('board')[col].map((t) => t.id)

test('switching release on with a limit of 2 starts the first two ready cards with new sessions; a freed slot releases the third (AC-5)', async (t) => {
  const { core, sessions, bus, projectPath } = await releaseCore(t)
  const a = await readyCard(projectPath, 'alpha')
  const b = await readyCard(projectPath, 'beta')
  const c = await readyCard(projectPath, 'gamma')
  // createTaskFromInput puts each new card first; order the column a, b, c.
  const state = getStore().get('board')
  getStore().set('board', { ...state, inventory: [a, b, c].map((x) => state.inventory.find((y) => y.id === x.id)) })
  core.handlers['vibeflow:setSettings']({ autonomous: { concurrency: 2 } })

  core.handlers['vibeflow:setRelease']({ enabled: true })
  await settle()
  assert.deepEqual(columnIds('in_progress').sort(), [a.id, b.id].sort())
  assert.deepEqual(columnIds('inventory'), [c.id])
  for (const x of [a, b]) {
    const started = findTask(x.id)
    const start = sessions.starts.find((s) => s.key === x.id)
    assert.ok(started.runId, 'a released card gets a new run')
    assert.ok(start.command.includes(`--session-id ${executorSessionId(x.id, started.runId)}`), 'a new session, not a resume')
    assert.ok(start.command.includes(`docs/features/${x.title}/plan.md`), 'the first message points at the plan')
    assert.ok(start.command.includes('執行準備'), 'and says the 執行準備 is the authorization')
    assert.equal(taskStatus(started), 'running')
  }

  // One card opens its PR: its slot is free again.
  setTaskStatus(getStore(), { taskId: a.id, status: 'pr_opened', reason: 'https://example.test/pr/1', source: 'cli' })
  bus.emit('state:changed', core.handlers['vibeflow:getState']())
  await settle()
  assert.deepEqual(columnIds('inventory'), [])
  assert.ok(columnIds('in_progress').includes(c.id))

  const batch = getStore().get('batches')[0]
  assert.deepEqual(batch.taskIds, [a.id, b.id, c.id])
  assert.equal(batch.titles[c.id], 'gamma')
  const events = batch.events.map((e) => [e.taskId, e.status, e.source])
  assert.deepEqual(events.filter(([id]) => id === a.id), [[a.id, 'running', 'host'], [a.id, 'pr_opened', 'cli']])
})

test('switching off stops releasing and closes the batch; running cards keep going', async (t) => {
  const { core, sessions, bus, projectPath } = await releaseCore(t)
  core.handlers['vibeflow:setSettings']({ autonomous: { concurrency: 1 } })
  const a = await readyCard(projectPath, 'one')
  core.handlers['vibeflow:setRelease']({ enabled: true })
  await settle()
  assert.deepEqual(columnIds('in_progress'), [a.id])
  core.handlers['vibeflow:setRelease']({ enabled: false })
  const b = await readyCard(projectPath, 'two')
  setTaskStatus(getStore(), { taskId: a.id, status: 'pr_opened', source: 'cli' })
  bus.emit('state:changed', core.handlers['vibeflow:getState']())
  await settle()
  assert.deepEqual(columnIds('inventory'), [b.id], 'nothing is released with the switch off')
  assert.ok(sessions.alive.has(a.id), 'the running card was not stopped')
  const [batch] = getStore().get('batches')
  assert.ok(batch.endedAt >= batch.startedAt)
  assert.deepEqual(getStore().get('release'), { enabled: false })
})

test('a switch left on keeps releasing after a host restart', async (t) => {
  const { projectPath } = await releaseCore(t)
  const a = await readyCard(projectPath, 'later')
  getStore().set('release', { enabled: true, batchId: 'b1' })
  getStore().set('batches', [{ id: 'b1', startedAt: 1, taskIds: [], events: [] }])
  const sessions = fakeSessions()
  const core = createCore({ sessions, bus: new EventBus(), version: '9.9.9', prStatus: async () => null })
  t.after(() => core.shutdown())
  await settle()
  assert.deepEqual(columnIds('in_progress'), [a.id])
  assert.deepEqual(getStore().get('batches')[0].taskIds, [a.id])
})

test('a ready card started by hand gets the same execution brief, once', async (t) => {
  const { core, sessions, projectPath } = await releaseCore(t)
  const a = await readyCard(projectPath, 'manual')
  await core.handlers['vibeflow:startTask'](a.id)
  const start = sessions.starts.find((s) => s.key === a.id)
  assert.ok(start.command.includes('docs/features/manual/plan.md'))
  assert.equal(taskStatus(findTask(a.id)), 'running')
  // A later start of the same card (a restart) is not handed the brief again.
  assert.ok(findTask(a.id).inventory.handedOffAt)
})
