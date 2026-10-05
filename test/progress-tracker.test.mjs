import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  claudeProjectDir,
  createProgressTracker,
  PROGRESS_EVENTS_DIR,
} from '../packages/core/src/progress-tracker.ts'

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'progress')
const fixture = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8').split('\n').filter(Boolean)

const SESSION = '0fe794b5-2ca3-4750-ab34-9002a73c6238'
// The fixtures were recorded on 2026-10-05 around 14:04Z.
const RUN_START = Date.parse('2026-10-05T14:00:00Z')

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-progress-'))
  const home = path.join(root, 'home')
  const worktree = path.join(root, 'project', '.vibeflow', 'vf-abc')
  fs.mkdirSync(worktree, { recursive: true })
  const updates = []
  const notes = []
  const tracker = createProgressTracker({
    homeDir: home,
    pollMs: 60_000, // tests drive syncs through snapshot()
    onUpdate: (taskId, progress) => updates.push({ taskId, progress }),
    onNotify: (taskId, list) => notes.push(...list.map((n) => ({ taskId, ...n }))),
  })
  t.after(() => {
    tracker.untrackAll()
    fs.rmSync(root, { recursive: true, force: true })
  })
  const projectDir = claudeProjectDir(home, worktree)
  fs.mkdirSync(projectDir, { recursive: true })
  return { root, home, worktree, tracker, updates, notes, projectDir }
}

const append = (file, lines) => fs.appendFileSync(file, lines.map((l) => l + '\n').join(''))

test('Claude — follows the executor transcript as it grows, including a half-written line', (t) => {
  const { worktree, tracker, updates, projectDir } = setup(t)
  const file = path.join(projectDir, `${SESSION}.jsonl`)
  const lines = fixture('claude-tasks.jsonl')
  const half = Math.floor(lines.length / 2)
  append(file, lines.slice(0, half))
  fs.appendFileSync(file, lines[half].slice(0, 25)) // the CLI is mid-write

  tracker.track({ taskId: 'card', agent: 'claude', worktreePath: worktree, sessionId: SESSION, since: RUN_START })
  const first = tracker.snapshot('card')
  assert.ok(first, 'has progress')
  assert.ok(first.todos.length >= 1)

  fs.appendFileSync(file, lines[half].slice(25) + '\n')
  append(file, lines.slice(half + 1))
  const done = tracker.snapshot('card')
  assert.deepEqual(done.todos.map((t) => t.status), ['completed', 'completed', 'completed'])
  assert.equal(done.activity.state, 'waiting')
  assert.equal(updates.at(-1).taskId, 'card')
})

test('Claude — usage adds other sessions of this run and their sub-agents, not older runs', (t) => {
  const { worktree, tracker, projectDir } = setup(t)
  append(path.join(projectDir, `${SESSION}.jsonl`), fixture('claude-todowrite.jsonl'))
  // A sub-agent of the executor session.
  const sub = path.join(projectDir, SESSION, 'subagents')
  fs.mkdirSync(sub, { recursive: true })
  append(path.join(sub, 'agent-1.jsonl'), fixture('claude-todowrite-subagent.jsonl'))
  // An agent tab in the same worktree during this run…
  append(path.join(projectDir, 'tab-session.jsonl'), [
    JSON.stringify({ type: 'assistant', timestamp: '2026-10-05T15:00:00Z', message: { id: 'tab', usage: { input_tokens: 1000 }, content: [] } }),
  ])
  // …and one from an earlier run that must not count.
  append(path.join(projectDir, 'old-run.jsonl'), [
    JSON.stringify({ type: 'assistant', timestamp: '2026-10-01T00:00:00Z', message: { id: 'old', usage: { input_tokens: 999999 }, content: [] } }),
  ])
  const prior = { input: 1, output: 1, cacheRead: 1, cacheWrite: 1, reasoning: 0 }
  tracker.track({ taskId: 'card', agent: 'claude', worktreePath: worktree, sessionId: SESSION, since: RUN_START, priorUsage: prior })
  const p = tracker.snapshot('card')
  assert.deepEqual(p.runUsage, {
    input: 94 + 18 + 1000,
    output: 2364 + 355,
    cacheRead: 485121 + 28623,
    cacheWrite: 22025 + 31752,
    reasoning: 907 + 190,
  })
  assert.deepEqual(p.totalUsage, {
    input: p.runUsage.input + 1,
    output: p.runUsage.output + 1,
    cacheRead: p.runUsage.cacheRead + 1,
    cacheWrite: p.runUsage.cacheWrite + 1,
    reasoning: p.runUsage.reasoning,
  })
  // Todos still come from the executor, not the tab.
  assert.equal(p.todos.length, 3)
})

test('no transcript yet — snapshot is null and nothing is emitted', (t) => {
  const { worktree, tracker, updates } = setup(t)
  tracker.track({ taskId: 'card', agent: 'claude', worktreePath: worktree, sessionId: SESSION, since: RUN_START })
  assert.equal(tracker.snapshot('card'), null)
  assert.equal(updates.length, 0)
  assert.equal(tracker.snapshot('unknown'), null)
})

test('hook events — permission prompt shows as waiting, files are consumed, foreign sessions ignored', (t) => {
  const { worktree, tracker, projectDir } = setup(t)
  const lines = fixture('claude-todowrite.jsonl')
  // Stop right after a tool call: the transcript alone says "working".
  const upTo = lines.findIndex((l) => l.includes('"name":"Write"'))
  append(path.join(projectDir, `${SESSION}.jsonl`), lines.slice(0, upTo + 1))
  tracker.track({ taskId: 'card', agent: 'claude', worktreePath: worktree, sessionId: SESSION, since: RUN_START })
  assert.equal(tracker.snapshot('card').activity.state, 'working')

  const events = path.join(worktree, PROGRESS_EVENTS_DIR)
  assert.ok(fs.existsSync(events), 'tracker creates the events dir')
  fs.writeFileSync(path.join(events, '1-1-1.json'), JSON.stringify({ hook_event_name: 'Notification', notification_type: 'permission_prompt', session_id: 'someone-else' }))
  assert.equal(tracker.snapshot('card').activity.state, 'working', 'another session’s prompt is not this card’s')

  fs.writeFileSync(path.join(events, '2-1-1.json'), JSON.stringify({ hook_event_name: 'Notification', notification_type: 'permission_prompt', session_id: SESSION }))
  const p = tracker.snapshot('card')
  assert.deepEqual([p.activity.state, p.activity.waitingFor], ['waiting', 'permission'])
  assert.deepEqual(fs.readdirSync(events), [])
})

test('notifications — baseline first, then transitions only', (t) => {
  const { worktree, tracker, notes, projectDir } = setup(t)
  const file = path.join(projectDir, `${SESSION}.jsonl`)
  const lines = fixture('claude-todowrite.jsonl')
  const writes = lines.map((l, i) => (l.includes('"TodoWrite"') ? i : -1)).filter((i) => i >= 0)
  // Restart scenario: the first two steps happened before the host came up.
  append(file, lines.slice(0, writes[2] + 1))
  tracker.track({ taskId: 'card', agent: 'claude', worktreePath: worktree, sessionId: SESSION, since: RUN_START })
  tracker.snapshot('card')
  assert.deepEqual(notes, [], 'nothing from before the tracker started is announced')

  append(file, lines.slice(writes[2] + 1, writes[3] + 1))
  tracker.snapshot('card')
  assert.deepEqual(notes.map((n) => [n.kind, n.item]), [['step_completed', 'Create c.txt containing c']])

  append(file, lines.slice(writes[3] + 1))
  tracker.snapshot('card')
  assert.deepEqual(notes.slice(1).map((n) => n.kind), ['step_completed', 'all_completed', 'waiting_input'])
  tracker.snapshot('card')
  assert.equal(notes.length, 4, 'no repeats')
})

test('Codex — rollout matched by cwd and run start across CODEX_HOMEs', (t) => {
  const { root, worktree, tracker } = setup(t)
  const userHome = path.join(root, 'codex-user')
  const libraryHome = path.join(root, 'codex-library')
  const day = (home) => {
    const d = new Date(RUN_START)
    const pad = (n) => String(n).padStart(2, '0')
    const dir = path.join(home, 'sessions', String(d.getFullYear()), pad(d.getMonth() + 1), pad(d.getDate()))
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }
  const rollout = fixture('codex-plan.jsonl').map((l) => l.replace('"cwd":"/repo"', `"cwd":${JSON.stringify(worktree)}`))
  append(path.join(day(libraryHome), 'rollout-a.jsonl'), rollout)
  // Same worktree, an earlier run; and another project on the same day.
  append(path.join(day(userHome), 'rollout-old.jsonl'), [
    JSON.stringify({ type: 'session_meta', payload: { cwd: worktree, timestamp: '2026-10-05T10:00:00Z' } }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 5000000 } } } }),
  ])
  append(path.join(day(userHome), 'rollout-other.jsonl'), [
    JSON.stringify({ type: 'session_meta', payload: { cwd: path.join(root, 'elsewhere'), timestamp: '2026-10-05T14:05:00Z' } }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 7000000 } } } }),
  ])
  const tracker2 = createProgressTracker({
    homeDir: path.join(root, 'home'),
    codexHomes: () => [userHome, libraryHome],
    pollMs: 60_000,
    onUpdate: () => {},
    onNotify: () => {},
  })
  t.after(() => tracker2.untrackAll())
  tracker2.track({ taskId: 'card', agent: 'codex', worktreePath: worktree, since: RUN_START })
  const p = tracker2.snapshot('card')
  assert.deepEqual(p.runUsage, { input: 27980, output: 262, cacheRead: 67840, cacheWrite: 0, reasoning: 19 })
  assert.deepEqual(p.todos.map((t) => t.status), ['completed', 'completed'])
  assert.equal(p.activity.state, 'waiting')
  assert.equal(tracker.isTracking('card'), false)
})

test('track — retargeting (restart) resets the baseline; untrack stops', (t) => {
  const { worktree, tracker, projectDir, notes } = setup(t)
  append(path.join(projectDir, `${SESSION}.jsonl`), fixture('claude-todowrite.jsonl'))
  tracker.track({ taskId: 'card', agent: 'claude', worktreePath: worktree, sessionId: SESSION, since: RUN_START })
  assert.ok(tracker.snapshot('card'))
  tracker.track({ taskId: 'card', agent: 'claude', worktreePath: worktree, sessionId: 'new-run', since: Date.parse('2026-10-06T00:00:00Z') })
  assert.equal(tracker.snapshot('card'), null, 'new run has no transcript yet')
  assert.deepEqual(notes, [])
  tracker.untrack('card')
  assert.equal(tracker.isTracking('card'), false)
})
