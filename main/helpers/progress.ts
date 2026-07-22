import fs from 'fs'
import path from 'path'

/** One step in a task's execution plan, maintained by the Claude agent. */
export interface TaskProgressStep {
  text: string
  done: boolean
}

/**
 * Persisted execution progress of a task. The Claude agent maintains a
 * progress file (in the userData dir, named by workspace — see agentProgressPath;
 * per the progress protocol appended to the system prompt); main watches that
 * file and mirrors its content into the store, so progress survives restarts and
 * a re-run can resume from the recorded state.
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
 * Absolute path of a task's progress file. The agent-maintained progress /
 * plan files no longer live inside the worktree — they sit in `baseDir`
 * (the task workspace parent) named by the task's workspace (the worktree
 * folder), so git never sees them and concurrent tasks never collide. Renderer
 * builds the identical path from the same workspace path (see
 * renderer/lib/claude.ts agentFilePaths) — keep both in sync.
 *
 * ponytail: workspace name = the worktree folder basename (branch slug). Two
 * different projects running an identically-named branch worktree at the same
 * time would collide; acceptable for now — prefix with a project discriminator
 * if that ever happens in practice.
 */
export function agentProgressPath(baseDir: string, worktreePath: string): string {
  return path.join(baseDir, `${path.basename(worktreePath)}${PROGRESS_FILE}`)
}

/**
 * Absolute path of a task's planning artifact (PLAN.md). Like the progress /
 * review files it lives in `baseDir` (the task's workspace folder = the
 * worktree's parent), named by the worktree folder, so git never sees it and
 * concurrent tasks never collide. Renderer builds the identical path (see
 * renderer/lib/claude.ts agentFilePaths) — keep both in sync.
 */
export function agentPlanPath(baseDir: string, worktreePath: string): string {
  return path.join(baseDir, `${path.basename(worktreePath)}.${PLAN_FILE}`)
}

/**
 * Best-effort removal of a task's progress + plan files. Called when
 * the task's worktree is torn down (cleanup / delete / re-provision) so these
 * runtime files share the worktree's lifecycle. The preserved plan.html is NOT
 * removed here — it outlives the task.
 */
export function deleteAgentFiles(baseDir: string, worktreePath: string): void {
  for (const p of [
    agentProgressPath(baseDir, worktreePath),
    agentPlanPath(baseDir, worktreePath),
  ]) {
    try {
      fs.rmSync(p, { force: true })
    } catch {
      // best-effort — a missing file or unlink race must not fail teardown
    }
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
      updatedAt: Date.now(),
    }
  } catch {
    return null
  }
}

/** Read + parse the progress file at `filePath`; null when absent or invalid. */
export function readProgressFile(filePath: string): TaskProgress | null {
  try {
    return parseProgress(fs.readFileSync(filePath, 'utf8'))
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
 * Active progress-file watchers keyed by session key (= taskId).
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
  filePath: string,
  onUpdate: (progress: TaskProgress) => void
): void {
  unwatchProgress(sessionKey)
  const file = filePath
  const dir = path.dirname(filePath)
  const name = path.basename(filePath)
  const sync = () => {
    const progress = readProgressFile(file)
    if (!progress) return
    const json = JSON.stringify({
      summary: progress.summary,
      steps: progress.steps,
      planDone: progress.planDone,
      needsUserInput: progress.needsUserInput,
    })
    if (json === entry.lastJson) return
    entry.lastJson = json
    onUpdate(progress)
  }
  const entry: WatchEntry = { file, lastJson: null, sync }
  watchers.set(sessionKey, entry)

  // Try event-based watching on the containing directory (stable on macOS/Linux).
  // Fall back to poll if the platform doesn't support it (network drives, etc.).
  try {
    const fsWatcher = fs.watch(dir, (_event: string, filename: string | null) => {
      if (filename === name) sync()
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
