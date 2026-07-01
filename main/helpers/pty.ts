import * as nodePty from 'node-pty'
import type { WebContents } from 'electron'
import { existsSync } from 'fs'
import path from 'path'
import { buildEnv } from './env'

/**
 * Active PTY sessions keyed by session key.
 * Executor session key = taskId; reviewer session key = `${taskId}:review`.
 * This lets each task have two concurrent PTY sessions without collision.
 */
const sessions = new Map<string, nodePty.IPty>()

// Procs we tore down on purpose (session kill / phase switch). node-pty's
// kill() sends SIGHUP, so the shell exits 129 — an expected teardown, not a
// crash. The renderer reads this flag to avoid a false「異常結束」warning.
const intentionalKills = new WeakSet<nodePty.IPty>()

// ---------------------------------------------------------------------------
// Scrollback ring buffer — survives `killSession` so a remounting terminal
// can replay what happened before it unmounted. Cleared when a new *command*
// is given to `startSession` (phase switch = fresh terminal).
// ---------------------------------------------------------------------------

const MAX_SCROLLBACK = 512 * 1024  // 512 KB per session
const scrollbacks = new Map<string, string>()

function appendScrollback(key: string, data: string): void {
  const cur = (scrollbacks.get(key) ?? '') + data
  // ponytail: slice from the end to keep the most-recent output
  scrollbacks.set(key, cur.length > MAX_SCROLLBACK ? cur.slice(-MAX_SCROLLBACK) : cur)
}

/** Shared augmented env (sane PATH) plus the terminal-specific TERM. */
function buildPtyEnv(): Record<string, string> {
  return { ...buildEnv(), TERM: 'xterm-256color' }
}

function findGitBash(): string | undefined {
  const candidates = [
    process.env['ProgramFiles']
      ? path.join(process.env['ProgramFiles'], 'Git', 'bin', 'bash.exe')
      : undefined,
    process.env['ProgramFiles(x86)']
      ? path.join(process.env['ProgramFiles(x86)'] as string, 'Git', 'bin', 'bash.exe')
      : undefined,
    process.env['LOCALAPPDATA']
      ? path.join(process.env['LOCALAPPDATA'], 'Programs', 'Git', 'bin', 'bash.exe')
      : undefined,
  ]
  return candidates.filter((p): p is string => !!p).find(existsSync)
}

function defaultShell(): string {
  if (process.platform === 'win32') {
    // Launch commands are written in POSIX sh syntax; Git Bash is required to run them.
    return findGitBash() ?? 'powershell.exe'
  }
  return process.env.SHELL || '/bin/zsh'
}

export interface StartResult {
  pid: number
  /** Previous session's buffered output, replayed by the renderer on remount. */
  scrollback: string | null
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
  onExit?: () => void,
  cols = 80,
  rows = 24
): StartResult {
  // Capture scrollback before the old PTY is killed. A new command means a new
  // phase (planning → execution), so clear the buffer; otherwise preserve it so
  // a remounting terminal can replay what it missed while unmounted.
  const scrollback = command ? null : (scrollbacks.get(sessionKey) ?? null)
  if (command) scrollbacks.delete(sessionKey)

  killSession(sessionKey)

  const shell = defaultShell()
  let args: string[]
  // Git Bash (bash.exe) on Windows uses the same POSIX login-shell flags as macOS/Linux.
  // Fall back to PowerShell args only when Git Bash is unavailable (launch commands
  // containing POSIX syntax will not work in that case).
  const isPosixShell =
    process.platform !== 'win32' || shell.toLowerCase().endsWith('bash.exe')
  if (isPosixShell) {
    args = command ? ['-lic', command] : ['-l']
  } else {
    args = command ? ['-NoProfile', '-NonInteractive', '-Command', command] : ['-NoProfile']
  }

  const proc = nodePty.spawn(shell, args, {
    name: 'xterm-256color',
    cwd,
    env: buildPtyEnv(),
    cols,
    rows,
  })
  sessions.set(sessionKey, proc)

  proc.onData((data) => {
    appendScrollback(sessionKey, data)
    if (!sender.isDestroyed()) sender.send('pty:data', { sessionKey, data })
  })
  proc.onExit(({ exitCode }) => {
    const intentional = intentionalKills.has(proc)
    if (!sender.isDestroyed())
      sender.send('pty:exit', { sessionKey, exitCode, intentional })
    // Guard against a stale exit: a kill-and-restart replaces the map entry
    // before the old process's exit event fires, and that old event must not
    // deregister (or fire callbacks for) the new session.
    if (sessions.get(sessionKey) === proc) {
      sessions.delete(sessionKey)
      onExit?.()
    }
  })

  return { pid: proc.pid, scrollback }
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
    intentionalKills.add(proc)
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
