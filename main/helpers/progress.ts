import fs from 'fs'
import path from 'path'

/** One step in a task's execution plan, maintained by the Claude agent. */
export interface TaskProgressStep {
  text: string
  done: boolean
}

/**
 * Code-review verdict emitted by the reviewer stage of the auto-assign
 * pipeline. The reviewer agent writes it into the `review` field of the
 * progress file; main mirrors it onto the task so the renderer's pipeline
 * orchestrator can decide whether to approve or send the work back for changes.
 */
export interface ReviewVerdict {
  /** "approve" = no changes needed; "request_changes" = comments must be fixed. */
  verdict: 'approve' | 'request_changes'
  /** One-line summary of the review outcome. */
  summary?: string
  /** Concrete points that must be addressed (empty when approved). */
  comments: string[]
}

/**
 * Persisted execution progress of a task. The Claude agent maintains a
 * `.vibeflow-progress.json` file at the session cwd (per the progress protocol
 * appended to the system prompt); main watches that file and mirrors its
 * content into the store, so progress survives restarts and a re-run can
 * resume from the recorded state.
 */
export interface TaskProgress {
  /** One-line summary of where the task currently stands. */
  summary?: string
  steps: TaskProgressStep[]
  /**
   * Set to true by the agent once PLAN.md is finalized and execution is ready
   * to begin. Absent or false = still in planning stage.
   */
  planDone?: boolean
  /**
   * Set when planning cannot produce an executable plan without a human answer.
   * The renderer uses this to avoid auto-continuing into execution.
   */
  needsUserInput?: boolean
  /**
   * Present only after the reviewer stage runs: the code-review verdict the
   * reviewer agent wrote into the progress file. The executor stages omit it.
   */
  review?: ReviewVerdict
  /** Epoch ms when this snapshot was read from the progress file. */
  updatedAt: number
}

/**
 * File the agent writes its progress to, relative to the session cwd.
 * Must match the literal in renderer/lib/claude.ts (progress protocol prompt).
 */
export const PROGRESS_FILE = '.vibeflow-progress.json'

/**
 * Planning artifact written by the agent at the start of each task.
 * Runtime-only — excluded from git via .git/info/exclude (see ensureLocalExclude).
 */
export const PLAN_FILE = 'PLAN.md'

/**
 * Separate file the reviewer agent writes its verdict to, distinct from the
 * executor's progress file so a careless reviewer model cannot clobber the
 * executor's `steps` / `planDone` fields.
 */
export const REVIEW_FILE = '.vibeflow-review.json'

/** Parse the optional reviewer verdict; undefined when absent or malformed. */
function parseReview(raw: unknown): ReviewVerdict | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const obj = raw as { verdict?: unknown; summary?: unknown; comments?: unknown }
  if (obj.verdict !== 'approve' && obj.verdict !== 'request_changes') {
    return undefined
  }
  const comments = Array.isArray(obj.comments)
    ? obj.comments.filter((c): c is string => typeof c === 'string')
    : []
  return {
    verdict: obj.verdict,
    summary: typeof obj.summary === 'string' ? obj.summary : undefined,
    comments,
  }
}

/** Parse + validate raw file content; null when malformed (e.g. mid-write). */
function parseProgress(raw: string): TaskProgress | null {
  try {
    const data: unknown = JSON.parse(raw)
    if (!data || typeof data !== 'object') return null
    const obj = data as {
      summary?: unknown
      steps?: unknown
      review?: unknown
      planDone?: unknown
      needsUserInput?: unknown
    }
    if (!Array.isArray(obj.steps)) return null
    const steps: TaskProgressStep[] = []
    for (const s of obj.steps) {
      if (!s || typeof s !== 'object') return null
      const step = s as { text?: unknown; done?: unknown }
      if (typeof step.text !== 'string') return null
      steps.push({ text: step.text, done: step.done === true })
    }
    return {
      summary: typeof obj.summary === 'string' ? obj.summary : undefined,
      steps,
      planDone: obj.planDone === true,
      needsUserInput: obj.needsUserInput === true,
      review: parseReview(obj.review),
      updatedAt: Date.now(),
    }
  } catch {
    return null
  }
}

/** Read + parse the progress file under `cwd`; null when absent or invalid. */
export function readProgressFile(cwd: string): TaskProgress | null {
  try {
    return parseProgress(fs.readFileSync(path.join(cwd, PROGRESS_FILE), 'utf8'))
  } catch {
    return null
  }
}

interface WatchEntry {
  file: string
  lastJson: string | null
  /** Re-read the file and emit when its (valid) content changed. */
  sync: () => void
  /** fs.watch handle when event-based watching is active; absent when poll fallback is used. */
  fsWatcher?: fs.FSWatcher
}

/**
 * Active progress-file watchers keyed by session key.
 * Executor session key = taskId; reviewer session key = `${taskId}:review`.
 * Each session watches independently so they can't displace each other.
 */
const watchers = new Map<string, WatchEntry>()

/**
 * Watch a session's progress file and invoke `onUpdate` whenever its (valid)
 * content changes. Prefers `fs.watch` (event-based, <10ms on local disks) and
 * falls back to `fs.watchFile` polling (800ms) for network/exotic filesystems.
 * Re-watching the same session key replaces the old watcher.
 */
export function watchProgress(
  sessionKey: string,
  cwd: string,
  onUpdate: (progress: TaskProgress) => void
): void {
  unwatchProgress(sessionKey)
  const file = path.join(cwd, PROGRESS_FILE)
  const sync = () => {
    const progress = readProgressFile(cwd)
    if (!progress) return
    const json = JSON.stringify({
      summary: progress.summary,
      steps: progress.steps,
      review: progress.review,
      planDone: progress.planDone,
      needsUserInput: progress.needsUserInput,
    })
    if (json === entry.lastJson) return
    entry.lastJson = json
    onUpdate(progress)
  }
  const entry: WatchEntry = { file, lastJson: null, sync }
  watchers.set(sessionKey, entry)

  // Try event-based watching on the worktree directory (stable on macOS/Linux).
  // Fall back to poll if the platform doesn't support it (network drives, etc.).
  try {
    const fsWatcher = fs.watch(cwd, (_event: string, filename: string | null) => {
      if (filename === PROGRESS_FILE) sync()
    })
    fsWatcher.on('error', () => {
      // Watcher died mid-session — activate poll fallback for the remainder.
      fsWatcher.close()
      entry.fsWatcher = undefined
      fs.watchFile(file, { interval: 800 }, sync)
    })
    entry.fsWatcher = fsWatcher
  } catch {
    fs.watchFile(file, { interval: 800 }, sync)
  }

  sync() // pick up pre-existing content immediately (e.g. on re-run)
}

/**
 * Stop watching a session's progress file (PTY exited/killed, task cleaned up).
 * Runs one final sync first so a write landing just before the session ended
 * is not lost to the polling interval.
 */
export function unwatchProgress(sessionKey: string): void {
  const entry = watchers.get(sessionKey)
  if (entry) {
    entry.sync()
    if (entry.fsWatcher) {
      entry.fsWatcher.close()
    } else {
      // Poll fallback was active — stop the watchFile listener.
      fs.unwatchFile(entry.file)
    }
    watchers.delete(sessionKey)
  }
}

export function unwatchAllProgress(): void {
  for (const key of Array.from(watchers.keys())) {
    unwatchProgress(key)
  }
}

// ---------------------------------------------------------------------------
// Reviewer verdict file (`.vibeflow-review.json`) — separate watcher map so
// reviewer writes never clobber the executor's progress fields.
// ---------------------------------------------------------------------------

/** Read + parse the reviewer verdict file; null when absent or invalid. */
export function readReviewFile(cwd: string): ReviewVerdict | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(cwd, REVIEW_FILE), 'utf8'))
    return parseReview(raw) ?? null
  } catch {
    return null
  }
}

const reviewWatchers = new Map<string, WatchEntry>()

/**
 * Watch a reviewer session's verdict file; calls `onUpdate` whenever the file
 * changes to a valid `ReviewVerdict`. Uses the same fs.watch → watchFile
 * fallback pattern as `watchProgress`.
 */
export function watchReview(
  sessionKey: string,
  cwd: string,
  onUpdate: (review: ReviewVerdict) => void
): void {
  unwatchReview(sessionKey)
  const file = path.join(cwd, REVIEW_FILE)
  const sync = () => {
    const review = readReviewFile(cwd)
    if (!review) return
    const json = JSON.stringify(review)
    if (json === entry.lastJson) return
    entry.lastJson = json
    onUpdate(review)
  }
  const entry: WatchEntry = { file, lastJson: null, sync }
  reviewWatchers.set(sessionKey, entry)

  try {
    const fsWatcher = fs.watch(cwd, (_event: string, filename: string | null) => {
      if (filename === REVIEW_FILE) sync()
    })
    fsWatcher.on('error', () => {
      fsWatcher.close()
      entry.fsWatcher = undefined
      fs.watchFile(file, { interval: 800 }, sync)
    })
    entry.fsWatcher = fsWatcher
  } catch {
    fs.watchFile(file, { interval: 800 }, sync)
  }

  sync()
}

export function unwatchReview(sessionKey: string): void {
  const entry = reviewWatchers.get(sessionKey)
  if (entry) {
    entry.sync()
    if (entry.fsWatcher) {
      entry.fsWatcher.close()
    } else {
      fs.unwatchFile(entry.file)
    }
    reviewWatchers.delete(sessionKey)
  }
}

export function unwatchAllReview(): void {
  for (const key of Array.from(reviewWatchers.keys())) {
    unwatchReview(key)
  }
}
