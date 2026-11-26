import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { batchDrained, dispatchable, occupiedSlots, waitingOnDependencies } from '../packages/core/src/release.ts'
import { createCore } from '../packages/core/src/service.ts'
import { EventBus } from '../packages/core/src/events.ts'
import { createNodePlatform, setPlatform } from '../packages/core/src/platform.ts'
import { findTask, getStore } from '../packages/core/src/store.ts'
import { createTaskFromInput } from '../packages/core/src/tasks.ts'
import { executorSessionId, nightShiftBrief } from '../packages/core/src/launch.ts'
import { claudeProjectDir } from '../packages/core/src/progress-tracker.ts'
import { reportRows, reportTable } from '../packages/core/src/report.ts'
import { setTaskStatus } from '../packages/core/src/status-tags.ts'
import { taskStatus } from '../packages/core/src/status-keys.ts'
import { makeRepo } from './support/repo.mjs'

const card = (id, extra = {}) => ({ id, title: id, branch: '', ...extra })
const board = (b) => ({ backlog: [], in_progress: [], done: [], ...b })
const READY = ['status:ready']

// --- tonight's list ---

test('tonight goes out in order: 待辦, then running cards marked to go again; waits and masters stay', () => {
  const b = board({
    backlog: [card('b1', { tags: READY }), card('plain'), card('m', { role: 'master', tags: READY }), card('dep', { tags: READY, after: ['x'] }), card('b2', { tags: READY })],
    in_progress: [card('redo', { tags: READY, launchedAt: 1, worktreePath: '/w' }), card('run', { tags: ['status:running'] })],
  })
  assert.deepEqual(dispatchable(b).map((t) => t.id), ['b1', 'b2', 'redo'])
  assert.deepEqual(waitingOnDependencies(b).map((t) => t.id), ['dep'])
  assert.equal(occupiedSlots(b), 1, 'a card waiting to go again holds no slot')
  b.done.push(card('x'))
  assert.ok(dispatchable(b).some((t) => t.id === 'dep'), 'it goes once what it waits on is Done')
})

test('a batch is drained once it sent something, nothing it sent holds a slot and nothing is left', () => {
  const batch = { id: 'n', startedAt: 0, taskIds: [], events: [] }
  assert.equal(batchDrained(batch, board({})), false, 'an empty batch never closes itself')
  batch.taskIds = ['a', 'b']
  const b = board({ in_progress: [card('a', { tags: ['status:pr_opened'] }), card('b', { tags: ['status:running'] })] })
  assert.equal(batchDrained(batch, b), false)
  b.in_progress[1].tags = ['status:stuck']
  assert.equal(batchDrained(batch, b), true)
  b.backlog.push(card('c', { tags: READY }))
  assert.equal(batchDrained(batch, b), false, 'more to send out')
})

// --- the brief ---

test('the night brief hands the work to work-mode and overrides only what would wait for a person (AC-5)', () => {
  const text = nightShiftBrief({ title: 'Player bugs', description: 'WCL260522-0003' }, { canWrite: true })
  for (const part of ['work-mode', '預先授權', '不要停下來問問題', 'Draft', '不要盯 PR', 'pr-watch', '--set pr_opened', '--set stuck', 'WCL260522-0003']) {
    assert.ok(text.includes(part), part)
  }
  assert.ok(!text.includes('## 步驟'), 'no steps of its own: the playbook decides them')
  const redo = nightShiftBrief({ title: 'Login' }, { canWrite: false, redo: '改用 OAuth', progress: '分支 vf-1，PR #3' })
  assert.ok(redo.startsWith('## 修正方向'))
  assert.ok(redo.includes('改用 OAuth') && redo.includes('PR #3'))
})

// --- the morning report ---

test('the morning report puts what needs a person first and lists cards that never went out (AC-7, AC-9)', () => {
  const batch = {
    id: 'n1', startedAt: 0, endedAt: 3_600_000, taskIds: ['pr', 'stuck'], titles: { later: 'Later card' }, skipped: ['later'],
    events: [
      { at: 0, taskId: 'pr', status: 'running', source: 'host' },
      { at: 10, taskId: 'pr', status: 'pr_opened', reason: 'https://github.com/a/b/pull/1', source: 'cli' },
      { at: 0, taskId: 'stuck', status: 'running', source: 'host' },
      { at: 20, taskId: 'stuck', status: 'stuck', reason: '缺測試資料', source: 'cli' },
    ],
  }
  const b = board({ in_progress: [card('pr', { tags: ['status:pr_opened'] }), card('stuck', { tags: ['status:stuck'] })] })
  const table = reportTable(batch, reportRows(batch, b, () => undefined, 3_600_000))
  assert.ok(table.startsWith('# 晨報'))
  const attention = table.indexOf('## 需要你處理')
  const review = table.indexOf('## 等你驗收')
  assert.ok(attention > 0 && review > attention)
  assert.ok(table.indexOf('缺測試資料') < review)
  assert.ok(table.includes('## 沒有派出') && table.includes('later Later card'))
})

// --- through the host ---

const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-night-'))
const workstation = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-night-ws-'))
const home = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-night-home-'))
setPlatform(createNodePlatform({ userDataDir: storeDir }))
getStore().set('settings', { autoMode: true, workstationPath: workstation })
test.after(() => Promise.all([storeDir, workstation, home].map((d) => fs.rm(d, { recursive: true, force: true }))))

const fakeSessions = () => ({
  kind: 'pty', starts: [], alive: new Set(),
  async start(key, opts) { this.starts.push({ key, ...opts }); this.alive.add(key); return { pid: 1, scrollback: null } },
  write() {}, resize() {}, async kill(key) { this.alive.delete(key) }, async isAlive(key) { return this.alive.has(key) },
  scrollback: () => null, async list() { return [...this.alive] }, shutdown() {},
})

/** Wait until `check` holds; the host starts cards in the background. */
async function until(check, ms = 8000) {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting for the host')
    await new Promise((r) => setTimeout(r, 20))
  }
}

async function nightCore(t) {
  const { projectPath, cleanup } = await makeRepo({ withRemote: false })
  t.after(cleanup)
  getStore().set('board', board({}))
  getStore().set('release', { enabled: false })
  getStore().set('batches', [])
  getStore().set('reports', [])
  const sessions = fakeSessions()
  const bus = new EventBus()
  const core = createCore({ sessions, bus, version: '9.9.9', homeDir: home, prStatus: async () => null, quotaProbe: async () => true, agentRunner: async () => '一張卡開了 PR。' })
  t.after(() => core.shutdown())
  core.handlers['vibeflow:setSettings']({ autonomous: { concurrency: 2 } })
  return { core, sessions, bus, projectPath }
}

/** A backlog card marked for tonight, oldest last like the column puts it. */
async function tonight(projectPath, title, extra = {}) {
  const { task } = await createTaskFromInput({ projectPath, title, description: `做 ${title}`, model: 'sonnet', effort: 'high', ...extra })
  setTaskStatus(getStore(), { taskId: task.id, status: 'ready', source: 'user' })
  return task
}

const columnIds = (col) => getStore().get('board')[col].map((t) => t.id)

test('下班派工 with nothing marked for tonight is refused (AC-4)', async (t) => {
  const { core } = await nightCore(t)
  assert.throws(() => core.handlers['vibeflow:setRelease']({ enabled: true }), (err) => err.code === 'NOTHING_READY')
  assert.deepEqual(getStore().get('batches'), [])
})

test('下班派工 sends backlog cards out up to the limit with the night brief; a freed slot sends the next (AC-2, AC-3, AC-5)', async (t) => {
  const { core, sessions, bus, projectPath } = await nightCore(t)
  const c = await tonight(projectPath, 'gamma')
  const b = await tonight(projectPath, 'beta')
  const a = await tonight(projectPath, 'alpha')
  assert.equal(findTask(a.id).worktreePath, undefined, 'marking a card for tonight provisions nothing')

  core.handlers['vibeflow:setRelease']({ enabled: true })
  await until(() => [a.id, b.id].every((id) => sessions.starts.some((s) => s.key === id) && taskStatus(findTask(id)) === 'running'))
  assert.deepEqual(columnIds('in_progress').sort(), [a.id, b.id].sort())
  assert.deepEqual(columnIds('backlog'), [c.id])
  const startOf = (id) => sessions.starts.find((s) => s.key === id).command
  for (const id of [a.id, b.id]) assert.ok(startOf(id).includes('夜班任務') && startOf(id).includes('work-mode'))
  for (const id of [a.id, b.id]) {
    assert.equal(taskStatus(findTask(id)), 'running')
    assert.ok(findTask(id).dispatch.briefedAt)
  }

  setTaskStatus(getStore(), { taskId: a.id, status: 'pr_opened', reason: 'https://github.com/x/y/pull/1', source: 'cli' })
  bus.emit('state:changed', core.handlers['vibeflow:getState']())
  await until(() => columnIds('in_progress').includes(c.id))
})

test('a dispatched card that ends its turn without a status waits for a person and frees its slot (AC-6)', async (t) => {
  const { core, projectPath } = await nightCore(t)
  core.handlers['vibeflow:setSettings']({ autonomous: { concurrency: 1 } })
  const later = await tonight(projectPath, 'later')
  const first = await tonight(projectPath, 'first')
  core.handlers['vibeflow:setRelease']({ enabled: true })
  await until(() => taskStatus(findTask(first.id)) === 'running')
  const sent = findTask(first.id)
  assert.equal(taskStatus(sent), 'running')
  assert.deepEqual(columnIds('backlog'), [later.id])

  const dir = claudeProjectDir(home, sent.worktreePath)
  await fs.mkdir(dir, { recursive: true })
  const at = new Date(Date.now() + 1000).toISOString()
  await fs.writeFile(path.join(dir, `${executorSessionId(sent.id, sent.runId)}.jsonl`), JSON.stringify({
    type: 'assistant', timestamp: at, message: { id: 'm1', model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: '要用哪個方案？' }] },
  }) + '\n')
  await core.handlers['progress:get'](sent.id)
  await until(() => columnIds('in_progress').includes(later.id))
  assert.equal(taskStatus(findTask(first.id)), 'needs_review')
  assert.equal(findTask(first.id).statusNote.reason, 'agent 結束回合但沒有回報狀態')
  assert.ok(columnIds('in_progress').includes(later.id), 'its slot went to the next card')
})

test('the batch closes itself once everything it sent stopped, and the morning report is written (AC-7)', async (t) => {
  const { core, bus, projectPath } = await nightCore(t)
  const a = await tonight(projectPath, 'only')
  core.handlers['vibeflow:setRelease']({ enabled: true })
  await until(() => taskStatus(findTask(a.id)) === 'running')
  assert.equal(getStore().get('release').enabled, true)
  setTaskStatus(getStore(), { taskId: a.id, status: 'stuck', reason: '缺資料', source: 'cli' })
  bus.emit('state:changed', core.handlers['vibeflow:getState']())
  await until(() => (getStore().get('reports') ?? []).length === 1)
  assert.deepEqual(getStore().get('release'), { enabled: false })
  const [batch] = getStore().get('batches')
  assert.ok(batch.endedAt)
  const [report] = getStore().get('reports')
  assert.equal(report.batchId, batch.id)
  assert.ok(report.title.startsWith('晨報'))
})

test('a running card marked to go again gets a new session with the correction first (AC-8)', async (t) => {
  const { core, sessions, bus, projectPath } = await nightCore(t)
  const a = await tonight(projectPath, 'again')
  core.handlers['vibeflow:setRelease']({ enabled: true })
  await until(() => taskStatus(findTask(a.id)) === 'running')
  setTaskStatus(getStore(), { taskId: a.id, status: 'pr_opened', source: 'cli' })
  bus.emit('state:changed', core.handlers['vibeflow:getState']())
  await until(() => getStore().get('release').enabled === false)

  const runBefore = findTask(a.id).runId
  sessions.alive.delete(a.id)
  setTaskStatus(getStore(), { taskId: a.id, status: 'ready', reason: '改用 OAuth，不要自己存密碼', source: 'user' })
  core.handlers['vibeflow:setRelease']({ enabled: true })
  await until(() => findTask(a.id).runId !== runBefore && taskStatus(findTask(a.id)) === 'running')
  const after = findTask(a.id)
  assert.notEqual(after.runId, runBefore)
  assert.equal(after.dispatch.redo, '改用 OAuth，不要自己存密碼')
  assert.equal(taskStatus(after), 'running')
  const last = sessions.starts.filter((s) => s.key === a.id).at(-1).command
  assert.ok(last.includes('修正方向') && last.includes('改用 OAuth'))
})

test('a ready card started by hand drops its 準備開工 and gets no night brief', async (t) => {
  const { core, sessions, projectPath } = await nightCore(t)
  const a = await tonight(projectPath, 'byhand')
  await core.handlers['vibeflow:startTask'](a.id)
  assert.equal(taskStatus(findTask(a.id)), null)
  assert.ok(!sessions.starts.find((s) => s.key === a.id).command.includes('夜班任務'))
})
