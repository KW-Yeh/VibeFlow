import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  activityFromHook,
  addUsage,
  claudeUsageTotal,
  diffProgress,
  emptyUsage,
  initialClaudeState,
  initialCodexState,
  latestActivity,
  reduceClaudeLine,
  reduceCodexLine,
  type Activity,
  type ClaudeState,
  type CodexState,
  type ProgressNotification,
  type TaskProgress,
  type TokenUsage,
} from './progress'
import { PROGRESS_EVENTS_DIR } from './launch'

export { PROGRESS_EVENTS_DIR }

/** What to follow for one card. */
export interface ProgressTarget {
  taskId: string
  agent: 'claude' | 'codex'
  worktreePath: string
  /**
   * Claude's pinned executor session. Its file always counts and is the one
   * todos and activity are read from; other sessions in the worktree only add usage.
   */
  sessionId?: string
  /** When this run began (Task.launchedAt): sessions started earlier belong to a previous run. */
  since?: number
  /** Usage of the card's earlier runs (Task.usage). */
  priorUsage?: TokenUsage
}

export interface ProgressTrackerOptions {
  onUpdate: (taskId: string, progress: TaskProgress) => void
  onNotify: (taskId: string, notifications: ProgressNotification[]) => void
  /** Defaults to os.homedir(); tests point it at a temp dir. */
  homeDir?: string
  /** Every CODEX_HOME rollouts may land in. Defaults to `<home>/.codex`. */
  codexHomes?: () => string[]
  /** Transcript poll interval. Hook events trigger a sync on their own. */
  pollMs?: number
}

export interface ProgressTracker {
  /** Start (or retarget) following a card. Retargeting restarts the baseline. */
  track(target: ProgressTarget): void
  untrack(taskId: string): void
  untrackAll(): void
  /** Read whatever is new and return the card's progress (null = no transcript yet). */
  snapshot(taskId: string): TaskProgress | null
  isTracking(taskId: string): boolean
}

/** A session that started this long before `since` still counts (clock skew, launch latency). */
const SINCE_SLACK_MS = 5_000

interface Cursor<S> {
  offset: number
  /** Bytes after the last newline — a line still being written. */
  rest: Buffer
  state: S
}

interface Entry {
  target: ProgressTarget
  claude: Map<string, Cursor<ClaudeState>>
  codex: Map<string, Cursor<CodexState>>
  /** Files looked at and found not to belong to this run. */
  rejected: Set<string>
  hookActivity: Activity | null
  last?: TaskProgress
  lastJson?: string
  timer: ReturnType<typeof setInterval>
  watcher: fs.FSWatcher | null
  pending: ReturnType<typeof setTimeout> | null
}

/** Claude names a project dir after its cwd with every non-alphanumeric turned into '-'. */
export function claudeProjectDir(home: string, cwd: string): string {
  return path.join(home, '.claude', 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'))
}

/**
 * Agents record the cwd with symlinks resolved (/tmp → /private/tmp on macOS),
 * while a card keeps the path it was given; both spellings name the worktree.
 */
function pathAliases(p: string): string[] {
  const resolved = path.resolve(p)
  try {
    const real = fs.realpathSync(resolved)
    return real === resolved ? [resolved] : [resolved, real]
  } catch {
    return [resolved]
  }
}

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => {
    const r = p.replace(/\\/g, '/').replace(/\/+$/, '')
    return process.platform === 'win32' ? r.toLowerCase() : r
  }
  const bs = pathAliases(b).map(norm)
  return pathAliases(a).some((x) => bs.includes(norm(x)))
}

function listFiles(dir: string, test: (name: string) => boolean): string[] {
  try {
    return fs.readdirSync(dir).filter(test).map((name) => path.join(dir, name))
  } catch {
    return []
  }
}

function firstLine(file: string): string | null {
  let fd: number | undefined
  try {
    fd = fs.openSync(file, 'r')
    const buf = Buffer.alloc(64 * 1024)
    const n = fs.readSync(fd, buf, 0, buf.length, 0)
    const text = buf.subarray(0, n).toString('utf8')
    const nl = text.indexOf('\n')
    return nl === -1 ? null : text.slice(0, nl)
  } catch {
    return null
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

/** Fold the bytes appended since the last read into the cursor's state. */
function advance<S>(file: string, cursor: Cursor<S>, reduce: (s: S, line: string) => S, initial: () => S): void {
  let size: number
  try {
    size = fs.statSync(file).size
  } catch {
    return
  }
  if (size < cursor.offset) {
    // Rewritten from scratch: start over.
    cursor.offset = 0
    cursor.rest = Buffer.alloc(0)
    cursor.state = initial()
  }
  if (size === cursor.offset) return
  let fd: number | undefined
  try {
    fd = fs.openSync(file, 'r')
    const chunk = Buffer.alloc(size - cursor.offset)
    const n = fs.readSync(fd, chunk, 0, chunk.length, cursor.offset)
    cursor.offset += n
    const data = Buffer.concat([cursor.rest, chunk.subarray(0, n)])
    const nl = data.lastIndexOf(0x0a)
    if (nl === -1) {
      cursor.rest = data
      return
    }
    cursor.rest = data.subarray(nl + 1)
    for (const line of data.subarray(0, nl).toString('utf8').split('\n')) {
      if (line.trim()) cursor.state = reduce(cursor.state, line)
    }
  } catch {
    // Unreadable right now; the next poll tries again from the same offset.
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

function newCursor<S>(state: S): Cursor<S> {
  return { offset: 0, rest: Buffer.alloc(0), state }
}

/** Local YYYY/MM/DD dirs Codex may have filed this run's rollouts under. */
function codexDayDirs(sessionsRoot: string, since: number | undefined): string[] {
  const days: string[] = []
  const end = new Date()
  // A day before `since` too: the rollout's folder date and our clock can disagree around midnight.
  const start = since != null ? new Date(since - 24 * 3600_000) : null
  if (!start) {
    // No run start known: scan everything (rare — legacy cards).
    for (const y of listFiles(sessionsRoot, () => true))
      for (const m of listFiles(y, () => true))
        for (const d of listFiles(m, () => true)) days.push(d)
    return days
  }
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  while (cur <= end) {
    const pad = (n: number) => String(n).padStart(2, '0')
    days.push(path.join(sessionsRoot, String(cur.getFullYear()), pad(cur.getMonth() + 1), pad(cur.getDate())))
    cur.setDate(cur.getDate() + 1)
  }
  return days
}

export function createProgressTracker(opts: ProgressTrackerOptions): ProgressTracker {
  const home = opts.homeDir ?? os.homedir()
  const codexHomes = opts.codexHomes ?? (() => [path.join(home, '.codex')])
  const pollMs = opts.pollMs ?? 2000
  const entries = new Map<string, Entry>()

  const belongsToRun = (target: ProgressTarget, startedAt: number | undefined) =>
    target.since == null || (startedAt != null && startedAt >= target.since - SINCE_SLACK_MS)

  function discoverClaude(entry: Entry): void {
    const { target } = entry
    const dirs = pathAliases(target.worktreePath).map((p) => claudeProjectDir(home, p))
    for (const file of dirs.flatMap((dir) => listFiles(dir, (n) => n.endsWith('.jsonl')))) {
      if (entry.claude.has(file) || entry.rejected.has(file)) continue
      const session = path.basename(file, '.jsonl')
      if (session !== target.sessionId) {
        const head = firstLine(file)
        if (head == null) continue // not even one line yet — look again next time
        const started = reduceClaudeLine(initialClaudeState(), head).startedAt
        if (!belongsToRun(target, started)) {
          entry.rejected.add(file)
          continue
        }
      }
      entry.claude.set(file, newCursor(initialClaudeState()))
    }
    // Sub-agents write their own transcripts under <session>/subagents/.
    for (const file of Array.from(entry.claude.keys())) {
      if (file.includes(`${path.sep}subagents${path.sep}`)) continue
      const sub = path.join(file.slice(0, -'.jsonl'.length), 'subagents')
      for (const f of listFiles(sub, (n) => n.endsWith('.jsonl'))) {
        if (!entry.claude.has(f)) entry.claude.set(f, newCursor(initialClaudeState()))
      }
    }
  }

  function discoverCodex(entry: Entry): void {
    const { target } = entry
    for (const codexHome of codexHomes()) {
      for (const day of codexDayDirs(path.join(codexHome, 'sessions'), target.since)) {
        for (const file of listFiles(day, (n) => n.startsWith('rollout-') && n.endsWith('.jsonl'))) {
          if (entry.codex.has(file) || entry.rejected.has(file)) continue
          const head = firstLine(file)
          if (head == null) continue
          const meta = reduceCodexLine(initialCodexState(), head)
          if (!meta.cwd) continue // session_meta not written yet
          if (!samePath(meta.cwd, target.worktreePath) || !belongsToRun(target, meta.startedAt)) {
            entry.rejected.add(file)
            continue
          }
          entry.codex.set(file, newCursor(initialCodexState()))
        }
      }
    }
  }

  /** Consume the hook event files: keep the newest activity reading, delete the files. */
  function drainHooks(entry: Entry): void {
    const dir = path.join(entry.target.worktreePath, PROGRESS_EVENTS_DIR)
    for (const file of listFiles(dir, (n) => n.endsWith('.json')).sort()) {
      try {
        const at = fs.statSync(file).mtimeMs
        const event = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
        // Other Claude sessions in the worktree (agent tabs) carry the same
        // hooks; only the executor's say what the card is doing.
        const foreign = entry.target.sessionId && typeof event.session_id === 'string' && event.session_id !== entry.target.sessionId
        const activity = foreign ? null : activityFromHook(event, at)
        if (activity) entry.hookActivity = latestActivity(entry.hookActivity ?? activity, activity)
      } catch {
        // Half-written (the hook is still cat-ing) — leave it for the next pass.
        continue
      }
      try {
        fs.unlinkSync(file)
      } catch {
        // already gone
      }
    }
  }

  function compose(entry: Entry): TaskProgress | null {
    const { target } = entry
    let runUsage = emptyUsage()
    let primary: { todos: TaskProgress['todos']; contextTokens?: number; activity: Activity; startedAt?: number } | null = null
    if (target.agent === 'claude') {
      for (const [file, cursor] of entry.claude) {
        runUsage = addUsage(runUsage, claudeUsageTotal(cursor.state))
        if (file.includes(`${path.sep}subagents${path.sep}`)) continue
        const isExecutor = path.basename(file, '.jsonl') === target.sessionId
        const s = cursor.state
        if (isExecutor || (!target.sessionId && (!primary || (s.startedAt ?? 0) > (primary.startedAt ?? 0)))) {
          primary = { todos: s.todos, contextTokens: s.contextTokens, activity: s.activity, startedAt: s.startedAt }
        }
      }
    } else {
      for (const cursor of entry.codex.values()) {
        const s = cursor.state
        runUsage = addUsage(runUsage, s.usage)
        if (!primary || (s.startedAt ?? 0) >= (primary.startedAt ?? 0)) {
          primary = { todos: s.todos, contextTokens: s.contextTokens, activity: s.activity, startedAt: s.startedAt }
        }
      }
    }
    if (!primary) return null
    // A hook only knows "working", the transcript also knows which tool; keep
    // the hook for what the transcript cannot show (a permission prompt) and
    // for leaving a wait (UserPromptSubmit after Stop).
    const hook = entry.hookActivity
    const activity = hook?.state === 'working' && primary.activity.state === 'working'
      ? primary.activity
      : latestActivity(primary.activity, hook)
    return {
      todos: primary.todos,
      runUsage,
      totalUsage: addUsage(target.priorUsage ?? emptyUsage(), runUsage),
      ...(primary.contextTokens != null ? { contextTokens: primary.contextTokens } : {}),
      activity,
    }
  }

  function sync(entry: Entry): TaskProgress | null {
    drainHooks(entry)
    if (entry.target.agent === 'claude') {
      discoverClaude(entry)
      for (const [file, cursor] of entry.claude) advance(file, cursor, reduceClaudeLine, initialClaudeState)
    } else {
      discoverCodex(entry)
      for (const [file, cursor] of entry.codex) advance(file, cursor, reduceCodexLine, initialCodexState)
    }
    const next = compose(entry)
    if (!next) return null
    const json = JSON.stringify(next)
    if (json !== entry.lastJson) {
      const notifications = diffProgress(entry.last, next)
      entry.last = next
      entry.lastJson = json
      opts.onUpdate(entry.target.taskId, next)
      if (notifications.length) opts.onNotify(entry.target.taskId, notifications)
    }
    return next
  }

  function safeSync(entry: Entry): TaskProgress | null {
    try {
      return sync(entry)
    } catch {
      // A parse or fs surprise must never take the host down; the next poll retries.
      return entry.last ?? null
    }
  }

  function stop(entry: Entry): void {
    clearInterval(entry.timer)
    if (entry.pending) clearTimeout(entry.pending)
    entry.watcher?.close()
  }

  function sameTarget(a: ProgressTarget, b: ProgressTarget): boolean {
    return a.agent === b.agent && a.worktreePath === b.worktreePath && a.sessionId === b.sessionId && a.since === b.since &&
      JSON.stringify(a.priorUsage ?? null) === JSON.stringify(b.priorUsage ?? null)
  }

  return {
    track(target) {
      const existing = entries.get(target.taskId)
      if (existing && sameTarget(existing.target, target)) return
      if (existing) stop(existing)
      const entry: Entry = {
        target,
        claude: new Map(),
        codex: new Map(),
        rejected: new Set(),
        hookActivity: null,
        timer: setInterval(() => safeSync(entry), pollMs),
        watcher: null,
        pending: null,
      }
      entry.timer.unref?.()
      entries.set(target.taskId, entry)
      const eventsDir = path.join(target.worktreePath, PROGRESS_EVENTS_DIR)
      try {
        fs.mkdirSync(eventsDir, { recursive: true })
        // A hook event is the cue to look now instead of at the next poll.
        entry.watcher = fs.watch(eventsDir, () => {
          if (entry.pending) return
          entry.pending = setTimeout(() => {
            entry.pending = null
            safeSync(entry)
          }, 50)
        })
        entry.watcher.on('error', () => entry.watcher?.close())
        entry.watcher.unref?.()
      } catch {
        // No watch (worktree gone, fs without events): polling still covers it.
      }
      safeSync(entry)
    },
    untrack(taskId) {
      const entry = entries.get(taskId)
      if (!entry) return
      stop(entry)
      entries.delete(taskId)
    },
    untrackAll() {
      for (const entry of entries.values()) stop(entry)
      entries.clear()
    },
    snapshot(taskId) {
      const entry = entries.get(taskId)
      return entry ? safeSync(entry) : null
    },
    isTracking(taskId) {
      return entries.has(taskId)
    },
  }
}
