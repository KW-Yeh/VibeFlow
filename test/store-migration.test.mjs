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

test('a v4 store keeps its board, tags and settings and gains the v5 fields with defaults', async () => {
  const store = getStoreAtPath(await storeDirWith(v4()))
  assert.equal(store.get('version'), STATE_VERSION)
  assert.equal(STATE_VERSION, 5)
  const board = store.get('board')
  assert.deepEqual(board.inventory, [])
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

test('migration is keyed on the field: a v5 store an older binary rewrote gets its columns back', async () => {
  const state = { ...v4(), version: 5, release: { enabled: true, batchId: 'b1' } }
  const store = getStoreAtPath(await storeDirWith(state))
  assert.deepEqual(store.get('board').inventory, [])
  assert.deepEqual(store.get('release'), { enabled: true, batchId: 'b1' })
})

test('existing v5 values are left alone', async () => {
  const state = {
    ...v4(),
    version: 5,
    board: { ...v4().board, inventory: [{ id: 'i', title: 'I', branch: 'vf-i' }] },
    settings: { autoMode: true, autonomous: { concurrency: 4 } },
    batches: [{ id: 'b1', startedAt: 1, taskIds: [], events: [] }],
  }
  const store = getStoreAtPath(await storeDirWith(state))
  assert.deepEqual(store.get('board').inventory.map((t) => t.id), ['i'])
  assert.deepEqual(store.get('settings').autonomous, { concurrency: 4 })
  assert.equal(store.get('batches').length, 1)
})

test('normalizeBoard and writeBoard always keep four columns', async () => {
  assert.deepEqual(normalizeBoard({ backlog: [], in_progress: [], done: [] }), { backlog: [], inventory: [], in_progress: [], done: [] })
  const store = getStoreAtPath(await storeDirWith(v4()))
  writeBoard(store, { backlog: [], in_progress: [], done: [] })
  assert.deepEqual(Object.keys(store.get('board')).sort(), ['backlog', 'done', 'in_progress', 'inventory'])
})

test('resolveAutonomousSettings falls back on junk and keeps valid values', () => {
  assert.deepEqual(resolveAutonomousSettings({}), DEFAULT_AUTONOMOUS_SETTINGS)
  const s = resolveAutonomousSettings({ autonomous: { concurrency: 0, heartbeatMinutes: 1.5, reportKeep: 3, reportEffort: 'bogus', inventoryCommands: ['npm whoami', '', 3] } })
  assert.equal(s.concurrency, 2)
  assert.equal(s.heartbeatMinutes, 5)
  assert.equal(s.reportKeep, 3)
  assert.equal(s.reportEffort, 'low')
  assert.deepEqual(s.inventoryCommands, ['npm whoami'])
  assert.equal(resolveAutonomousSettings({ autonomous: { reportAgent: 'codex' } }).reportModel, undefined)
})
