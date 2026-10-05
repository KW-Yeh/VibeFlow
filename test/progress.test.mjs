import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  activityFromHook,
  addUsage,
  claudeUsageTotal,
  describeNotification,
  diffProgress,
  emptyUsage,
  formatTokens,
  initialClaudeState,
  initialCodexState,
  latestActivity,
  normalizeUsage,
  progressSummary,
  reduceClaudeLine,
  reduceCodexLine,
  totalTokens,
} from '../packages/core/src/progress.ts'

// Trimmed recordings of real runs (Claude Code 2.1.288 / Codex 0.144.5), see
// progress.ts. Expected numbers below were summed from these files by hand.
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'progress')
const lines = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8').split('\n').filter(Boolean)
const foldClaude = (ls) => ls.reduce(reduceClaudeLine, initialClaudeState())
const foldCodex = (ls) => ls.reduce(reduceCodexLine, initialCodexState())

test('Claude TodoWrite — the last list wins, every step completed', () => {
  const state = foldClaude(lines('claude-todowrite.jsonl'))
  assert.deepEqual(
    state.todos.map((t) => [t.content, t.status]),
    [
      ['Create b.txt containing b', 'completed'],
      ['Create c.txt containing c', 'completed'],
      ['Use subagent to read a.txt and report content', 'completed'],
    ]
  )
})

test('Claude TodoWrite — a partial transcript shows the list as it was then', () => {
  const all = lines('claude-todowrite.jsonl')
  const thirdWrite = all.findIndex((l, i) => l.includes('"TodoWrite"') && all.slice(0, i).filter((x) => x.includes('"TodoWrite"')).length === 2)
  const state = foldClaude(all.slice(0, thirdWrite + 1))
  assert.deepEqual(state.todos.map((t) => t.status), ['completed', 'in_progress', 'pending'])
  assert.equal(state.activity.state, 'working')
  assert.equal(state.activity.tool, 'TodoWrite')
})

test('Claude TaskCreate/TaskUpdate — items keep their ids and follow updates', () => {
  const state = foldClaude(lines('claude-tasks.jsonl'))
  assert.deepEqual(
    state.todos.map((t) => [t.id, t.content, t.status]),
    [
      ['1', 'Create b.txt containing b', 'completed'],
      ['2', 'Create c.txt containing c', 'completed'],
      ['3', 'Use subagent to read a.txt and report', 'completed'],
    ]
  )
  assert.deepEqual(state.pendingTasks, {})
})

test('Claude TaskUpdate — deleted removes the item, failed update is ignored', () => {
  const create = (id, toolId, subject) => [
    JSON.stringify({ type: 'assistant', message: { id: `m${toolId}`, content: [{ type: 'tool_use', id: toolId, name: 'TaskCreate', input: { subject } }] } }),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: toolId }] }, toolUseResult: { task: { id, subject } } }),
  ]
  const update = (toolId, input, result) => [
    JSON.stringify({ type: 'assistant', message: { id: `m${toolId}`, content: [{ type: 'tool_use', id: toolId, name: 'TaskUpdate', input }] } }),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: toolId }] }, toolUseResult: result }),
  ]
  const state = foldClaude([
    ...create('1', 't1', 'one'),
    ...create('2', 't2', 'two'),
    ...update('t3', { taskId: '1', status: 'deleted' }, { success: true }),
    ...update('t4', { taskId: '2', status: 'completed' }, { success: false }),
  ])
  assert.deepEqual(state.todos.map((t) => [t.id, t.status]), [['2', 'pending']])
})

test('Claude usage — one count per message id even when a reply spans lines', () => {
  const all = lines('claude-todowrite.jsonl')
  const assistantLines = all.filter((l) => l.includes('"type":"assistant"')).length
  const state = foldClaude(all)
  assert.ok(assistantLines > Object.keys(state.usageById).length, 'fixture repeats message ids')
  assert.deepEqual(claudeUsageTotal(state), {
    input: 94,
    output: 2364,
    cacheRead: 485121,
    cacheWrite: 22025,
    reasoning: 907,
  })
  assert.equal(state.contextTokens, 48920)
})

test('Claude sub-agent transcript — usage counted on its own', () => {
  const state = foldClaude(lines('claude-todowrite-subagent.jsonl'))
  assert.deepEqual(claudeUsageTotal(state), { input: 18, output: 355, cacheRead: 28623, cacheWrite: 31752, reasoning: 190 })
  assert.equal(state.todos, null)
})

test('Claude activity — end_turn means waiting for input', () => {
  const state = foldClaude(lines('claude-tasks.jsonl'))
  assert.equal(state.activity.state, 'waiting')
  assert.equal(state.activity.waitingFor, 'input')
  assert.ok(state.activity.at > 0)
  assert.ok(state.startedAt <= state.activity.at)
})

test('Codex update_plan — last plan wins; usage is the last cumulative count', () => {
  const state = foldCodex(lines('codex-plan.jsonl'))
  assert.equal(state.cwd, '/repo')
  assert.deepEqual(
    state.todos.map((t) => [t.content, t.status]),
    [
      ['Create b.txt containing b', 'completed'],
      ['Create c.txt containing c', 'completed'],
    ]
  )
  // total_token_usage: input 95820 of which 67840 cached.
  assert.deepEqual(state.usage, { input: 27980, output: 262, cacheRead: 67840, cacheWrite: 0, reasoning: 19 })
  assert.equal(state.contextTokens, 16139)
  assert.equal(state.activity.state, 'waiting')
})

test('Codex — a run in progress shows the tool being called', () => {
  const all = lines('codex-plan.jsonl')
  const state = foldCodex(all.slice(0, all.findIndex((l) => l.includes('apply_patch')) + 1))
  assert.deepEqual(state.activity, { state: 'working', tool: 'apply_patch', at: state.activity.at })
  assert.deepEqual(state.todos.map((t) => t.status), ['in_progress', 'pending'])
})

test('no todo tool used — todos stay null', () => {
  const state = foldClaude([
    JSON.stringify({ type: 'assistant', timestamp: '2026-10-05T00:00:00Z', message: { id: 'm1', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 2 }, content: [{ type: 'text', text: 'hi' }] } }),
  ])
  assert.equal(state.todos, null)
  assert.equal(totalTokens(claudeUsageTotal(state)), 3)
})

test('broken and truncated lines are skipped, the rest still counts', () => {
  const all = lines('claude-todowrite.jsonl')
  const broken = ['not json', '{"type":"assistant","message":', '42', 'null', ...all, all[5].slice(0, 30)]
  assert.deepEqual(foldClaude(broken).todos, foldClaude(all).todos)
  assert.deepEqual(claudeUsageTotal(foldClaude(broken)), claudeUsageTotal(foldClaude(all)))
  const codex = lines('codex-plan.jsonl')
  assert.deepEqual(foldCodex(['{', ...codex, '{"type":"event_msg","payload":{"type":"token_count","info":null}}']).usage, foldCodex(codex).usage)
})

test('usage helpers — add, total, normalize', () => {
  const a = { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, reasoning: 1 }
  assert.deepEqual(addUsage(a, a), { input: 2, output: 4, cacheRead: 6, cacheWrite: 8, reasoning: 2 })
  assert.equal(totalTokens(a), 10)
  assert.deepEqual(normalizeUsage({ input: 5, output: 'x' }), { ...emptyUsage(), input: 5 })
  assert.equal(normalizeUsage('nope'), undefined)
})

test('hook events — permission vs idle vs working; newer reading wins', () => {
  assert.deepEqual(activityFromHook({ hook_event_name: 'Notification', notification_type: 'permission_prompt' }, 5), { state: 'waiting', waitingFor: 'permission', at: 5 })
  assert.deepEqual(activityFromHook({ hook_event_name: 'Notification', notification_type: 'idle_prompt' }, 5), { state: 'waiting', waitingFor: 'input', at: 5 })
  assert.deepEqual(activityFromHook({ hook_event_name: 'Stop' }, 5), { state: 'waiting', waitingFor: 'input', at: 5 })
  assert.deepEqual(activityFromHook({ hook_event_name: 'UserPromptSubmit' }, 5), { state: 'working', at: 5 })
  assert.equal(activityFromHook({ hook_event_name: 'SessionStart' }, 5), null)
  assert.equal(activityFromHook('junk', 5), null)

  const transcript = { state: 'working', tool: 'Bash', at: 10 }
  const permission = { state: 'waiting', waitingFor: 'permission', at: 11 }
  assert.equal(latestActivity(transcript, permission), permission)
  // Approved: the tool_result lands after the hook and the transcript wins again.
  assert.equal(latestActivity({ state: 'working', at: 12 }, permission).state, 'working')
  assert.equal(latestActivity(transcript, null), transcript)
})

const reading = (todos, activity = { state: 'working' }) => ({
  todos,
  runUsage: emptyUsage(),
  totalUsage: emptyUsage(),
  activity,
})
const item = (content, status, id) => ({ content, status, ...(id ? { id } : {}) })

test('diffProgress — first reading is a baseline, never announced', () => {
  assert.deepEqual(diffProgress(undefined, reading([item('a', 'completed')], { state: 'waiting' })), [])
})

test('diffProgress — step completed, then all completed, each once', () => {
  const r1 = reading([item('a', 'in_progress'), item('b', 'pending')])
  const r2 = reading([item('a', 'completed'), item('b', 'in_progress')])
  const r3 = reading([item('a', 'completed'), item('b', 'completed')])
  assert.deepEqual(diffProgress(r1, r2), [{ kind: 'step_completed', item: 'a', done: 1, total: 2 }])
  assert.deepEqual(diffProgress(r2, r3), [
    { kind: 'step_completed', item: 'b', done: 2, total: 2 },
    { kind: 'all_completed', done: 2, total: 2 },
  ])
  assert.deepEqual(diffProgress(r3, r3), [])
})

test('diffProgress — matches TaskCreate items by id, not text', () => {
  const r1 = reading([item('a', 'pending', '1')])
  const r2 = reading([item('a (renamed)', 'completed', '1')])
  assert.equal(diffProgress(r1, r2).filter((n) => n.kind === 'step_completed').length, 1)
  assert.deepEqual(diffProgress(r2, reading([item('a (renamed again)', 'completed', '1')])), [])
})

test('diffProgress — waiting fires on the transition only', () => {
  const working = reading(null, { state: 'working' })
  const waiting = reading(null, { state: 'waiting', waitingFor: 'permission' })
  assert.deepEqual(diffProgress(working, waiting), [{ kind: 'waiting_input', waitingFor: 'permission' }])
  assert.deepEqual(diffProgress(waiting, waiting), [])
  assert.deepEqual(diffProgress(reading(null, { state: 'unknown' }), reading(null, { state: 'waiting' })), [
    { kind: 'waiting_input', waitingFor: 'input' },
  ])
})

test('diffProgress — an empty list is never all completed', () => {
  assert.deepEqual(diffProgress(reading(null), reading([])), [])
})

test('text — tokens, notification sentences, one-line summary', () => {
  assert.deepEqual([950, 1234, 12345, 1_234_567].map(formatTokens), ['950', '1.2k', '12k', '1.23M'])
  assert.equal(describeNotification({ kind: 'step_completed', item: 'a', done: 1, total: 3 }), '完成 1/3 — a')
  assert.equal(describeNotification({ kind: 'all_completed', done: 3, total: 3 }), '所有步驟已完成')
  assert.equal(describeNotification({ kind: 'waiting_input', waitingFor: 'permission' }), '等待你允許權限')
  const p = {
    ...reading([item('a', 'completed'), item('b', 'pending')], { state: 'waiting', waitingFor: 'input' }),
    totalUsage: { input: 12000, output: 345, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
  }
  assert.equal(progressSummary(p), '1/2 · 12k tok · 等待輸入')
  assert.equal(progressSummary(null, { input: 950, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }), '950 tok')
  assert.equal(progressSummary(null), '')
})
