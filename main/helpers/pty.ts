import * as nodePty from 'node-pty'
import type { WebContents } from 'electron'
import { buildEnv } from './env'

/** Active PTY sessions keyed by task id (supports multiple parallel cards). */
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
 * Start (or restart) a PTY session for a task. When `command` is provided it is
 * run inside a login shell (full PATH); otherwise an interactive login shell is
 * started so the user can drive the CLI (e.g. type `claude`).
 * `onExit` fires when this session ends for any reason (natural exit included),
 * unless it has already been replaced by a newer session for the same task.
 */
export function startSession(
  taskId: string,
  cwd: string,
  sender: WebContents,
  command?: string,
  onExit?: () => void
): StartResult {
  killSession(taskId)

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
  sessions.set(taskId, proc)

  proc.onData((data) => {
    if (!sender.isDestroyed()) sender.send('pty:data', { taskId, data })
  })
  proc.onExit(({ exitCode }) => {
    if (!sender.isDestroyed()) sender.send('pty:exit', { taskId, exitCode })
    // Guard against a stale exit: a kill-and-restart replaces the map entry
    // before the old process's exit event fires, and that old event must not
    // deregister (or fire callbacks for) the new session.
    if (sessions.get(taskId) === proc) {
      sessions.delete(taskId)
      onExit?.()
    }
  })

  return { pid: proc.pid }
}

export function writeSession(taskId: string, data: string): void {
  sessions.get(taskId)?.write(data)
}

export function resizeSession(
  taskId: string,
  cols: number,
  rows: number
): void {
  try {
    sessions.get(taskId)?.resize(Math.max(cols, 1), Math.max(rows, 1))
  } catch {
    // resize can throw if the pty already exited — safe to ignore
  }
}

export function killSession(taskId: string): void {
  const proc = sessions.get(taskId)
  if (proc) {
    try {
      proc.kill()
    } catch {
      // already dead
    }
    sessions.delete(taskId)
  }
}

export function killAllSessions(): void {
  for (const taskId of Array.from(sessions.keys())) {
    killSession(taskId)
  }
}
