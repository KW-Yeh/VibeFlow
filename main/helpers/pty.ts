import os from 'os'
import * as nodePty from 'node-pty'
import type { WebContents } from 'electron'

/** Active PTY sessions keyed by task id (supports multiple parallel cards). */
const sessions = new Map<string, nodePty.IPty>()

/**
 * Build the child env with a sane PATH. Apps launched from Finder inherit a
 * minimal PATH, so `claude` and other user-installed CLIs would not be found —
 * we augment PATH with the common bin locations as a fallback. Spawning a login
 * shell additionally loads the user's profile for the full PATH.
 */
function buildEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') env[k] = v
  }
  const home = os.homedir()
  const extras = [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
    `${home}/.local/bin`,
    `${home}/.npm-global/bin`,
  ]
  const parts = (env.PATH ?? '').split(':').filter(Boolean)
  for (const p of extras) if (!parts.includes(p)) parts.push(p)
  env.PATH = parts.join(':')
  env.TERM = 'xterm-256color'
  return env
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
 */
export function startSession(
  taskId: string,
  cwd: string,
  sender: WebContents,
  command?: string
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
    env: buildEnv(),
    cols: 80,
    rows: 24,
  })
  sessions.set(taskId, proc)

  proc.onData((data) => {
    if (!sender.isDestroyed()) sender.send('pty:data', { taskId, data })
  })
  proc.onExit(({ exitCode }) => {
    if (!sender.isDestroyed()) sender.send('pty:exit', { taskId, exitCode })
    sessions.delete(taskId)
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
