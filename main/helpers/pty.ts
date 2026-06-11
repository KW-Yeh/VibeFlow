import * as nodePty from 'node-pty'
import type { WebContents } from 'electron'
import { buildEnv } from './env'

/**
 * Active PTY sessions keyed by session key.
 * Executor session key = taskId; reviewer session key = `${taskId}:review`.
 * This lets each task have two concurrent PTY sessions without collision.
 */
const sessions = new Map<string, nodePty.IPty>()

/** Shared augmented env (sane PATH) plus the terminal-specific TERM. */
function buildPtyEnv(): Record<string, string> {
  return { ...buildEnv(), TERM: 'xterm-256color' }
}

function defaultShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'powershell.exe'
  }
  return process.env.SHELL || '/bin/zsh'
}

export interface StartResult {
  pid: number
}

/**
 * Start (or restart) a PTY session for the given session key. When `command`
 * is provided it is run inside a login shell (full PATH); otherwise an
 * interactive login shell is started so the user can drive the CLI.
 * `sessionKey` is taskId for the executor, `${taskId}:review` for the reviewer.
 * `onExit` fires when this session ends for any reason (natural exit included),
 * unless it has already been replaced by a newer session for the same key.
 */
export function startSession(
  sessionKey: string,
  cwd: string,
  sender: WebContents,
  command?: string,
  onExit?: () => void
): StartResult {
  killSession(sessionKey)

  const shell = defaultShell()
  let args: string[]
  if (process.platform === 'win32') {
    args = command ? ['-Command', command] : []
  } else {
    args = command ? ['-lic', command] : ['-l']
  }

  const proc = nodePty.spawn(shell, args, {
    name: 'xterm-256color',
    cwd,
    env: buildPtyEnv(),
    cols: 80,
    rows: 24,
  })
  sessions.set(sessionKey, proc)

  proc.onData((data) => {
    if (!sender.isDestroyed()) sender.send('pty:data', { sessionKey, data })
  })
  proc.onExit(({ exitCode }) => {
    if (!sender.isDestroyed()) sender.send('pty:exit', { sessionKey, exitCode })
    // Guard against a stale exit: a kill-and-restart replaces the map entry
    // before the old process's exit event fires, and that old event must not
    // deregister (or fire callbacks for) the new session.
    if (sessions.get(sessionKey) === proc) {
      sessions.delete(sessionKey)
      onExit?.()
    }
  })

  return { pid: proc.pid }
}

export function writeSession(sessionKey: string, data: string): void {
  sessions.get(sessionKey)?.write(data)
}

export function resizeSession(
  sessionKey: string,
  cols: number,
  rows: number
): void {
  try {
    sessions.get(sessionKey)?.resize(Math.max(cols, 1), Math.max(rows, 1))
  } catch {
    // resize can throw if the pty already exited — safe to ignore
  }
}

export function killSession(sessionKey: string): void {
  const proc = sessions.get(sessionKey)
  if (proc) {
    try {
      proc.kill()
    } catch {
      // already dead
    }
    sessions.delete(sessionKey)
  }
}

export function killAllSessions(): void {
  for (const key of Array.from(sessions.keys())) {
    killSession(key)
  }
}

/** Derive the reviewer session key from a task id. */
export function reviewSessionKey(taskId: string): string {
  return `${taskId}:review`
}
