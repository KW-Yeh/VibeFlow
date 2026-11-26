import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import {
  DEFAULT_AUTONOMOUS_SETTINGS,
  STATE_VERSION,
  getStoreAtPath,
  normalizeBoard,
  resolveAutonomousSettings,
  writeBoard,
} from '../packages/core/src/store.ts'

const tempDirs = []
test.after(() => Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true }))))

async function storeDirWith(state) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-migrate-'))
  tempDirs.push(dir)
  await fs.writeFile(path.join(dir, 'vibeflow-state.json'), JSON.stringify(state))
  return dir
}

const v4 = () => ({
  version: 4,
  projectPath: null,
  board: {
    backlog: [{ id: 'a', title: 'A', branch: 'vf-a', tags: ['tag_1'] }],
    in_progress: [{ id: 'b', title: 'B', branch: 'vf-b', worktreePath: '/w/b' }],
    done: [{ id: 'c', title: 'C', branch: 'vf-c' }],
  },
  settings: { autoMode: false, systemPrompt: 'hi' },
  recentProjects: [],
  terminals: [],
  tags: [{ id: 'tag_1', name: '等待 review', color: 'amber' }],
})

test('a v4 store keeps its board, tags and settings and gains the later fields with defaults', async () => {
  const store = getStoreAtPath(await storeDirWith(v4()))
  assert.equal(store.get('version'), STATE_VERSION)
  assert.equal(STATE_VERSION, 6)
  const board = store.get('board')
  assert.deepEqual(Object.keys(board).sort(), ['backlog', 'done', 'in_progress'])
  assert.deepEqual(board.backlog.map((t) => t.id), ['a'])
  assert.deepEqual(board.backlog[0].tags, ['tag_1'])
  assert.deepEqual(board.in_progress.map((t) => t.worktreePath), ['/w/b'])
  assert.deepEqual(board.done.map((t) => t.id), ['c'])
  assert.deepEqual(store.get('tags'), v4().tags)
  assert.deepEqual(store.get('release'), { enabled: false })
  assert.deepEqual(store.get('batches'), [])
  assert.deepEqual(store.get('reports'), [])
  const settings = store.get('settings')
  assert.equal(settings.autoMode, false)
  assert.equal(settings.systemPrompt, 'hi')
  // Not written: read through resolveAutonomousSettings, so a later default applies to stores that never set one.
  assert.equal(settings.autonomous, undefined)
  assert.deepEqual(resolveAutonomousSettings(settings), DEFAULT_AUTONOMOUS_SETTINGS)
})

const v5 = () => ({
  ...v4(),
  version: 5,
  board: {
    backlog: [{ id: 'a', title: 'A', branch: 'vf-a' }],
    inventory: [
      { id: 'r', title: 'Ready', branch: 'vf-r', worktreePath: '/w/r', tags: ['status:ready', 'tag_1'], inventory: { finishedAt: 1, docs: ['docs/features/r/plan.md'] } },
      { id: 'q', title: 'Asked', branch: 'vf-q', description: '做 Q', tags: ['status:needs_answer'], statusNote: { status: 'needs_answer', at: 1 }, inventory: { context: '用 OAuth' } },
      { id: 'w', title: 'Waiting', branch: 'vf-w', tags: ['status:quota_wait'], quotaWait: { since: 1, agent: 'claude', phase: 'inventory', statusBefore: 'inventorying' } },
    ],
    in_progress: [{ id: 'b', title: 'B', branch: 'vf-b', tags: ['status:running'] }],
    done: [],
  },
  tags: [
    { id: 'tag_1', name: '等待 review', color: 'amber' },
    { id: 'status:inventorying', name: '盤點中', color: 'blue' },
    { id: 'status:needs_answer', name: '待回答', color: 'amber' },
    { id: 'status:ready', name: '準備開工', color: 'green' },
  ],
  release: { enabled: false },
  batches: [{ id: 'b1', startedAt: 1, taskIds: [], events: [] }],
  reports: [],
  settings: { autoMode: true, autonomous: { concurrency: 4, inventoryCommands: ['jf rt ping'] } },
})

test('v5 → v6: 盤點 cards go back to the head of 待辦, keep 準備開工 and their worktree, and lose the inventory statuses (AC-10)', async () => {
  const store = getStoreAtPath(await storeDirWith(v5()))
  assert.equal(store.get('version'), 6)
  const board = store.get('board')
  assert.deepEqual(Object.keys(board).sort(), ['backlog', 'done', 'in_progress'])
  assert.deepEqual(board.backlog.map((t) => t.id), ['r', 'q', 'w', 'a'])
  const [r, q, w] = board.backlog
  assert.deepEqual(r.tags, ['status:ready', 'tag_1'])
  assert.equal(r.worktreePath, '/w/r')
  assert.deepEqual(q.tags, [])
  assert.equal(q.statusNote, undefined)
  assert.equal(q.description, '做 Q\n\n## 盤點時的補充\n\n用 OAuth', 'what the person added is kept')
  assert.equal(w.quotaWait, undefined)
  assert.deepEqual(w.tags, [])
  assert.deepEqual(board.in_progress[0].tags, ['status:running'])
  assert.deepEqual(store.get('tags').map((t) => t.id), ['tag_1', 'status:ready'])
  assert.deepEqual(store.get('settings').autonomous.concurrency, 4)
  assert.equal(store.get('batches').length, 1)
})

test('a v6 store a v5 binary rewrote with an empty 盤點 column loses the column again', async () => {
  const state = { ...v4(), version: 6, board: { ...v4().board, inventory: [] } }
  const store = getStoreAtPath(await storeDirWith(state))
  assert.deepEqual(Object.keys(store.get('board')).sort(), ['backlog', 'done', 'in_progress'])
  assert.deepEqual(store.get('board').backlog.map((t) => t.id), ['a'])
})

test('normalizeBoard and writeBoard keep exactly three columns', async () => {
  assert.deepEqual(normalizeBoard({ backlog: [], inventory: [{ id: 'x' }], in_progress: [], done: [] }), { backlog: [], in_progress: [], done: [] })
  const store = getStoreAtPath(await storeDirWith(v4()))
  writeBoard(store, { backlog: [], in_progress: [], done: [] })
  assert.deepEqual(Object.keys(store.get('board')).sort(), ['backlog', 'done', 'in_progress'])
})

test('resolveAutonomousSettings falls back on junk and keeps valid values', () => {
  assert.deepEqual(resolveAutonomousSettings({}), DEFAULT_AUTONOMOUS_SETTINGS)
  const s = resolveAutonomousSettings({ autonomous: { concurrency: 0, heartbeatMinutes: 1.5, reportKeep: 3, reportEffort: 'bogus', inventoryCommands: ['npm whoami'] } })
  assert.equal(s.concurrency, 2)
  assert.equal(s.heartbeatMinutes, 5)
  assert.equal(s.reportKeep, 3)
  assert.equal(s.reportEffort, 'low')
  assert.equal('inventoryCommands' in s, false, 'an old setting is no longer read')
  assert.equal(resolveAutonomousSettings({ autonomous: { reportAgent: 'codex' } }).reportModel, undefined)
})
