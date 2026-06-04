import fs from 'fs'
import path from 'path'

/** One step in a task's execution plan, maintained by the Claude agent. */
export interface TaskProgressStep {
  text: string
  done: boolean
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
  /** Epoch ms when this snapshot was read from the progress file. */
  updatedAt: number
}

/**
 * File the agent writes its progress to, relative to the session cwd.
 * Must match the literal in renderer/lib/claude.ts (progress protocol prompt).
 */
export const PROGRESS_FILE = '.vibeflow-progress.json'

/** Parse + validate raw file content; null when malformed (e.g. mid-write). */
function parseProgress(raw: string): TaskProgress | null {
  try {
    const data: unknown = JSON.parse(raw)
    if (!data || typeof data !== 'object') return null
    const obj = data as { summary?: unknown; steps?: unknown }
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
}

/** Active progress-file watchers keyed by task id (one per PTY session). */
const watchers = new Map<string, WatchEntry>()

/**
 * Poll-watch a session's progress file and invoke `onUpdate` whenever its
 * (valid) content changes. `fs.watchFile` is used because it tolerates the
 * file not existing yet. Re-watching the same task replaces the old watcher.
 */
export function watchProgress(
  taskId: string,
  cwd: string,
  onUpdate: (progress: TaskProgress) => void
): void {
  unwatchProgress(taskId)
  const file = path.join(cwd, PROGRESS_FILE)
  const entry: WatchEntry = { file, lastJson: null }
  watchers.set(taskId, entry)

  const sync = () => {
    const progress = readProgressFile(cwd)
    if (!progress) return
    const json = JSON.stringify({
      summary: progress.summary,
      steps: progress.steps,
    })
    if (json === entry.lastJson) return
    entry.lastJson = json
    onUpdate(progress)
  }

  fs.watchFile(file, { interval: 800 }, sync)
  sync() // pick up pre-existing content immediately (e.g. on re-run)
}

/** Stop watching a task's progress file (PTY killed / task cleaned up). */
export function unwatchProgress(taskId: string): void {
  const entry = watchers.get(taskId)
  if (entry) {
    fs.unwatchFile(entry.file)
    watchers.delete(taskId)
  }
}

export function unwatchAllProgress(): void {
  for (const taskId of Array.from(watchers.keys())) {
    unwatchProgress(taskId)
  }
}
