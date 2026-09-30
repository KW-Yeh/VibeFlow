/**
 * How core runs a task's terminal. `PtyBackend` owns the process directly, so
 * the session ends with core. `TmuxBackend` runs it inside a tmux server that
 * outlives core, and core only attaches to watch it.
 *
 * Both push `pty:data` / `pty:exit` through the EventSink they were built
 * with. The payloads carry the `sessionKey`.
 */
export interface SessionStartOptions {
  cwd: string
  /** Run this in a login shell. Absent = an interactive login shell. */
  command?: string
  cols?: number
  rows?: number
  /** Drop output buffered from the previous session instead of replaying it. */
  fresh?: boolean
  /** Fires once when this session ends for any reason, unless a newer one replaced it. */
  onExit?: () => void
}

export interface StartResult {
  pid: number
  /** Previous session's buffered output, replayed by the renderer on remount. */
  scrollback: string | null
  /** True when an already-running session was re-attached instead of started. */
  attached?: boolean
}

export interface SessionBackend {
  readonly kind: 'pty' | 'tmux'
  /**
   * Start a session, replacing any running one for `key`. With no `command`
   * and no `fresh`, a backend whose sessions outlive core re-attaches instead.
   */
  start(key: string, options: SessionStartOptions): Promise<StartResult>
  write(key: string, data: string): void
  resize(key: string, cols: number, rows: number): void
  /** End the session. */
  kill(key: string): Promise<void>
  isAlive(key: string): Promise<boolean>
  /**
   * Output buffered so far, for a frontend joining a running session without
   * restarting it. Null when the backend redraws on attach instead (tmux).
   */
  scrollback(key: string): string | null
  /** Keys of the sessions currently running. */
  list(): Promise<string[]>
  /**
   * Core is shutting down. PtyBackend ends every session; TmuxBackend only
   * detaches, so agents keep running.
   */
  shutdown(): void
}

/** Session keys are task ids, optionally `<taskId>:<tab>`. Safe for tmux names and file names. */
export function safeSessionName(key: string): string {
  return key.replace(/[^A-Za-z0-9_-]/g, '_')
}
