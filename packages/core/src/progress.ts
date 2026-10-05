/**
 * A card's progress and token usage, derived from the agent CLI's own JSONL
 * transcript rather than from anything the model is asked to write.
 *
 * Pure: every function here folds one already-read line (or one hook event)
 * into a plain state object. progress-tracker.ts owns the files.
 *
 * Neither CLI documents these formats, so each reducer reads as few fields as
 * it can and skips anything it does not recognise. test/fixtures/progress/
 * holds trimmed recordings that pin the shapes this was written against
 * (Claude Code 2.1.288, Codex 0.144.5).
 */

/** Token counts, normalised across CLIs. `input` excludes cache reads and writes. */
export interface TokenUsage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  /** Reasoning/thinking tokens — already included in `output`, shown separately. */
  reasoning: number
}

export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export interface TodoItem {
  /** Claude's TaskCreate id; absent for TodoWrite / update_plan items. */
  id?: string
  content: string
  /** Present-tense label Claude gives the in-progress item, when it does. */
  activeForm?: string
  status: TodoStatus
}

export type ActivityState = 'working' | 'waiting' | 'unknown'

export interface Activity {
  state: ActivityState
  /** Tool the agent is running right now (state 'working'). */
  tool?: string
  /** Why it stopped (state 'waiting'): end of turn, or asking for a permission. */
  waitingFor?: 'input' | 'permission'
  /** Epoch ms of the last transcript line or hook event seen. */
  at?: number
}

export interface TaskProgress {
  /** The agent's latest todo list. null = it never made one. */
  todos: TodoItem[] | null
  /** This run's usage (every session in the worktree since the run began). */
  runUsage: TokenUsage
  /** Earlier runs (Task.usage) plus this one — what the card has cost so far. */
  totalUsage: TokenUsage
  /** Tokens the last request sent — how full the context window is. */
  contextTokens?: number
  activity: Activity
}

export type ProgressNotificationKind = 'step_completed' | 'all_completed' | 'waiting_input'

export interface ProgressNotification {
  kind: ProgressNotificationKind
  /** step_completed: the item that finished. */
  item?: string
  done?: number
  total?: number
  /** waiting_input: what it is waiting for. */
  waitingFor?: 'input' | 'permission'
}

export function emptyUsage(): TokenUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    reasoning: a.reasoning + b.reasoning,
  }
}

/** Every token the usage represents (reasoning is part of output). */
export function totalTokens(u: TokenUsage): number {
  return u.input + u.output + u.cacheRead + u.cacheWrite
}

/** Accept only a TokenUsage-shaped value (persisted store data is untrusted). */
export function normalizeUsage(value: unknown): TokenUsage | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>
  const n = (k: string) => (typeof v[k] === 'number' && Number.isFinite(v[k]) ? (v[k] as number) : 0)
  return { input: n('input'), output: n('output'), cacheRead: n('cacheRead'), cacheWrite: n('cacheWrite'), reasoning: n('reasoning') }
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

function todoStatus(v: unknown): TodoStatus | null {
  return v === 'pending' || v === 'in_progress' || v === 'completed' ? v : null
}

function parseTime(v: unknown): number | undefined {
  if (typeof v !== 'string') return undefined
  const t = Date.parse(v)
  return Number.isNaN(t) ? undefined : t
}

function parseLine(line: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(line)
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Claude Code
// ---------------------------------------------------------------------------

export interface ClaudeState {
  todos: TodoItem[] | null
  /** Usage per assistant message id: one reply is split over several lines that repeat it. */
  usageById: Record<string, TokenUsage>
  /** TaskCreate / TaskUpdate inputs waiting for their tool_result. */
  pendingTasks: Record<string, { name: string; input: Record<string, unknown> }>
  contextTokens?: number
  activity: Activity
  /** First timestamp in the file — when the session began. */
  startedAt?: number
}

export function initialClaudeState(): ClaudeState {
  return { todos: null, usageById: {}, pendingTasks: {}, activity: { state: 'unknown' } }
}

function claudeUsage(u: Record<string, unknown>): TokenUsage {
  const details = u.output_tokens_details as Record<string, unknown> | undefined
  return {
    input: num(u.input_tokens),
    output: num(u.output_tokens),
    cacheRead: num(u.cache_read_input_tokens),
    cacheWrite: num(u.cache_creation_input_tokens),
    reasoning: num(details?.thinking_tokens),
  }
}

function todoWriteItems(input: Record<string, unknown>): TodoItem[] | null {
  if (!Array.isArray(input.todos)) return null
  const items: TodoItem[] = []
  for (const raw of input.todos) {
    if (!raw || typeof raw !== 'object') continue
    const t = raw as Record<string, unknown>
    const status = todoStatus(t.status)
    if (typeof t.content !== 'string' || !status) continue
    items.push({
      content: t.content,
      status,
      ...(typeof t.activeForm === 'string' ? { activeForm: t.activeForm } : {}),
    })
  }
  return items
}

/** TaskCreate / TaskUpdate change one item at a time; apply one to the list. */
function applyClaudeTask(
  todos: TodoItem[] | null,
  name: string,
  input: Record<string, unknown>,
  result: Record<string, unknown> | undefined
): TodoItem[] | null {
  if (name === 'TaskCreate') {
    const task = result?.task as Record<string, unknown> | undefined
    const id = task && (typeof task.id === 'string' || typeof task.id === 'number') ? String(task.id) : undefined
    const content = typeof input.subject === 'string' ? input.subject : typeof task?.subject === 'string' ? task.subject : null
    if (!content) return todos
    const item: TodoItem = {
      ...(id ? { id } : {}),
      content,
      status: 'pending',
      ...(typeof input.activeForm === 'string' ? { activeForm: input.activeForm } : {}),
    }
    return [...(todos ?? []), item]
  }
  // TaskUpdate
  if (result && result.success === false) return todos
  const id = typeof input.taskId === 'string' || typeof input.taskId === 'number' ? String(input.taskId) : null
  if (!id || !todos) return todos
  if (input.status === 'deleted') return todos.filter((t) => t.id !== id)
  const status = todoStatus(input.status)
  return todos.map((t) => {
    if (t.id !== id) return t
    return {
      ...t,
      ...(status ? { status } : {}),
      ...(typeof input.subject === 'string' ? { content: input.subject } : {}),
      ...(typeof input.activeForm === 'string' ? { activeForm: input.activeForm } : {}),
    }
  })
}

/** Fold one Claude transcript line into the state. Unknown or broken lines leave it unchanged. */
export function reduceClaudeLine(state: ClaudeState, line: string): ClaudeState {
  const entry = parseLine(line)
  if (!entry) return state
  const at = parseTime(entry.timestamp)
  const next: ClaudeState = { ...state, startedAt: state.startedAt ?? at }
  const message = entry.message as Record<string, unknown> | undefined
  const content = Array.isArray(message?.content) ? (message!.content as Record<string, unknown>[]) : []

  if (entry.type === 'assistant' && message) {
    const usage = message.usage as Record<string, unknown> | undefined
    if (usage && typeof message.id === 'string') {
      const u = claudeUsage(usage)
      next.usageById = { ...state.usageById, [message.id]: u }
      next.contextTokens = u.input + u.cacheRead + u.cacheWrite
    }
    let tool: string | undefined
    for (const block of content) {
      if (block?.type !== 'tool_use' || typeof block.name !== 'string') continue
      tool = block.name
      const input = (block.input && typeof block.input === 'object' ? block.input : {}) as Record<string, unknown>
      if (block.name === 'TodoWrite') {
        const items = todoWriteItems(input)
        if (items) next.todos = items
      } else if ((block.name === 'TaskCreate' || block.name === 'TaskUpdate') && typeof block.id === 'string') {
        next.pendingTasks = { ...next.pendingTasks, [block.id]: { name: block.name, input } }
      }
    }
    if (tool) next.activity = { state: 'working', tool, at }
    else if (message.stop_reason === 'end_turn') next.activity = { state: 'waiting', waitingFor: 'input', at }
    else next.activity = { state: 'working', at }
    return next
  }

  if (entry.type === 'user' && message) {
    const result = entry.toolUseResult && typeof entry.toolUseResult === 'object'
      ? (entry.toolUseResult as Record<string, unknown>)
      : undefined
    let pending = next.pendingTasks
    for (const block of content) {
      if (block?.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue
      const call = pending[block.tool_use_id]
      if (!call) continue
      next.todos = applyClaudeTask(next.todos, call.name, call.input, result)
      pending = { ...pending }
      delete pending[block.tool_use_id]
    }
    next.pendingTasks = pending
    next.activity = { state: 'working', at }
    return next
  }

  return next
}

export function claudeUsageTotal(state: ClaudeState): TokenUsage {
  return Object.values(state.usageById).reduce(addUsage, emptyUsage())
}

// ---------------------------------------------------------------------------
// Codex
// ---------------------------------------------------------------------------

export interface CodexState {
  /** session_meta cwd — which worktree this rollout belongs to. */
  cwd?: string
  startedAt?: number
  todos: TodoItem[] | null
  /** token_count is cumulative per rollout: the last one is the total. */
  usage: TokenUsage
  contextTokens?: number
  activity: Activity
}

export function initialCodexState(): CodexState {
  return { todos: null, usage: emptyUsage(), activity: { state: 'unknown' } }
}

function codexUsage(u: Record<string, unknown>): TokenUsage {
  // Codex counts cached tokens inside input_tokens; split them out to match Claude.
  const cached = num(u.cached_input_tokens)
  return {
    input: Math.max(0, num(u.input_tokens) - cached),
    output: num(u.output_tokens),
    cacheRead: cached,
    cacheWrite: num(u.cache_write_input_tokens),
    reasoning: num(u.reasoning_output_tokens),
  }
}

function planItems(argumentsJson: unknown): TodoItem[] | null {
  if (typeof argumentsJson !== 'string') return null
  const args = parseLine(argumentsJson)
  if (!args || !Array.isArray(args.plan)) return null
  const items: TodoItem[] = []
  for (const raw of args.plan) {
    if (!raw || typeof raw !== 'object') continue
    const p = raw as Record<string, unknown>
    const status = todoStatus(p.status)
    if (typeof p.step === 'string' && status) items.push({ content: p.step, status })
  }
  return items
}

/** Fold one Codex rollout line into the state. Unknown or broken lines leave it unchanged. */
export function reduceCodexLine(state: CodexState, line: string): CodexState {
  const entry = parseLine(line)
  if (!entry) return state
  const at = parseTime(entry.timestamp)
  const payload = (entry.payload && typeof entry.payload === 'object' ? entry.payload : {}) as Record<string, unknown>

  if (entry.type === 'session_meta') {
    return {
      ...state,
      cwd: typeof payload.cwd === 'string' ? payload.cwd : state.cwd,
      startedAt: parseTime(payload.timestamp) ?? at ?? state.startedAt,
    }
  }
  if (entry.type === 'response_item' && (payload.type === 'function_call' || payload.type === 'custom_tool_call')) {
    const name = typeof payload.name === 'string' ? payload.name : undefined
    const next: CodexState = { ...state, activity: { state: 'working', tool: name, at } }
    if (name === 'update_plan') {
      const items = planItems(payload.arguments)
      if (items) next.todos = items
    }
    return next
  }
  if (entry.type === 'event_msg') {
    if (payload.type === 'token_count') {
      const info = payload.info as Record<string, unknown> | null | undefined
      const total = info?.total_token_usage as Record<string, unknown> | undefined
      if (!total) return state
      const last = info?.last_token_usage as Record<string, unknown> | undefined
      return { ...state, usage: codexUsage(total), contextTokens: last ? num(last.input_tokens) : state.contextTokens }
    }
    if (payload.type === 'task_complete') {
      return { ...state, activity: { state: 'waiting', waitingFor: 'input', at } }
    }
    if (payload.type === 'task_started' || payload.type === 'user_message') {
      return { ...state, activity: { state: 'working', at } }
    }
  }
  return state
}

// ---------------------------------------------------------------------------
// Hook events (Claude --settings hooks; see launch.ts PROGRESS_EVENTS_DIR)
// ---------------------------------------------------------------------------

/**
 * What a hook event says about activity, or null when it adds nothing the
 * transcript does not already show. Only hooks tell us about a permission
 * prompt; the transcript just shows a tool call that has not returned yet.
 */
export function activityFromHook(event: unknown, at: number): Activity | null {
  if (!event || typeof event !== 'object') return null
  const e = event as Record<string, unknown>
  switch (e.hook_event_name) {
    case 'Notification':
      // idle_prompt = Claude has been waiting on the user for a while; anything
      // else (permission_prompt, older CLIs without the field) is an approval.
      return e.notification_type === 'idle_prompt'
        ? { state: 'waiting', waitingFor: 'input', at }
        : { state: 'waiting', waitingFor: 'permission', at }
    case 'Stop':
      return { state: 'waiting', waitingFor: 'input', at }
    case 'UserPromptSubmit':
    case 'PostToolUse':
      return { state: 'working', at }
    default:
      return null
  }
}

/** The newer of two activity readings (transcript vs hook); ties go to `b`. */
export function latestActivity(a: Activity, b: Activity | null | undefined): Activity {
  if (!b) return a
  if (a.at == null) return b
  if (b.at == null) return a
  return b.at >= a.at ? b : a
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

function sameItem(a: TodoItem, b: TodoItem): boolean {
  return a.id != null || b.id != null ? a.id === b.id : a.content === b.content
}

/**
 * What changed between two readings that is worth telling the user. `prev`
 * undefined = first reading (host start, new tracker): it is the baseline, so
 * nothing that happened before it is announced again.
 */
export function diffProgress(prev: TaskProgress | undefined, next: TaskProgress): ProgressNotification[] {
  if (!prev) return []
  const out: ProgressNotification[] = []
  const todos = next.todos ?? []
  const before = prev.todos ?? []
  const done = todos.filter((t) => t.status === 'completed').length
  for (const item of todos) {
    if (item.status !== 'completed') continue
    const old = before.find((b) => sameItem(b, item))
    if (old?.status === 'completed') continue
    out.push({ kind: 'step_completed', item: item.content, done, total: todos.length })
  }
  const allDone = (list: TodoItem[]) => list.length > 0 && list.every((t) => t.status === 'completed')
  if (allDone(todos) && !allDone(before)) {
    out.push({ kind: 'all_completed', done, total: todos.length })
  }
  if (next.activity.state === 'waiting' && prev.activity.state !== 'waiting') {
    out.push({ kind: 'waiting_input', waitingFor: next.activity.waitingFor ?? 'input' })
  }
  return out
}

// ---------------------------------------------------------------------------
// Text (TUI; the Web UI keeps its own copy in renderer/components/task-progress.tsx
// because the renderer may only import core's types-only modules)
// ---------------------------------------------------------------------------

/** 950 · 12.3k · 1.24M */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

/** One notification as a sentence about the card. */
export function describeNotification(n: ProgressNotification): string {
  switch (n.kind) {
    case 'step_completed':
      return `完成 ${n.done}/${n.total} — ${n.item ?? ''}`
    case 'all_completed':
      return '所有步驟已完成'
    case 'waiting_input':
      return n.waitingFor === 'permission' ? '等待你允許權限' : '等待你的輸入'
  }
}

/** A card's progress in one short line: `3/7 · 12.3k tok · 等待輸入`. Empty when there is nothing to say. */
export function progressSummary(progress: TaskProgress | null | undefined, usage?: TokenUsage): string {
  const parts: string[] = []
  const todos = progress?.todos
  if (todos && todos.length) parts.push(`${todos.filter((t) => t.status === 'completed').length}/${todos.length}`)
  const total = progress?.totalUsage ?? usage
  if (total && totalTokens(total) > 0) parts.push(`${formatTokens(totalTokens(total))} tok`)
  if (progress?.activity.state === 'waiting') parts.push(progress.activity.waitingFor === 'permission' ? '等待權限' : '等待輸入')
  return parts.join(' · ')
}
