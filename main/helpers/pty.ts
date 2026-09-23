import * as nodePty from 'node-pty'
import type { WebContents } from 'electron'
import { buildEnv } from './env'
import { findGitBash, GIT_BASH_MISSING_MESSAGE } from './git-bash'

/** Active PTY sessions keyed by session key (= taskId). */
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

// When VibeFlow itself is launched from an agent session (e.g. `npm start` run
// inside Claude Code), the app process inherits that session's markers and
// buildEnv() copies them wholesale. A terminal tab is the user's own top-level
// shell, not a child of that agent, so a CLI started in it would otherwise
// mis-detect itself as a nested session and disable transcript saving.
// Listed explicitly rather than matched by prefix so deliberate user config
// (ANTHROPIC_API_KEY, CLAUDE_CONFIG_DIR, …) still passes through.
const INHERITED_AGENT_SESSION_VARS = [
  'CLAUDECODE',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_HOST_SESSION_ID',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_PID',
  'CLAUDE_EFFORT',
]

/** Shared augmented env (sane PATH) plus the terminal-specific TERM. */
function buildPtyEnv(): Record<string, string> {
  const env: Record<string, string> = { ...buildEnv(), TERM: 'xterm-256color' }
  for (const key of INHERITED_AGENT_SESSION_VARS) delete env[key]
  return env
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
 * interactive login shell is started so the user can drive the CLI. Set
 * `fresh` when the caller is explicitly replacing the terminal session and
 * does not want output from the previous PTY replayed on a later remount.
 * `sessionKey` is the taskId.
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
  rows = 24,
  fresh = false
): StartResult {
  // Capture scrollback before the old PTY is killed. A new command means a new
  // phase (planning → execution), and an explicitly fresh interactive shell
  // is a new terminal session. Both start with an empty buffer; ordinary
  // remounts preserve output that arrived while the renderer was unmounted.
  const clearScrollback = Boolean(command) || fresh
  const scrollback = clearScrollback ? null : (scrollbacks.get(sessionKey) ?? null)
  if (clearScrollback) scrollbacks.delete(sessionKey)

  killSession(sessionKey)

  const shell = defaultShell()
  let args: string[]
  // Git Bash (bash.exe) on Windows uses the same POSIX login-shell flags as macOS/Linux.
  // PowerShell is only a fallback for a plain interactive shell: launch commands
  // are POSIX sh and cannot run there, so instead of letting one fail with a
  // parse error the session says what is missing and exits non-zero — the
  // renderer then reports the failure and hands back an interactive shell.
  const isPosixShell =
    process.platform !== 'win32' || shell.toLowerCase().endsWith('bash.exe')
  if (isPosixShell) {
    args = command ? ['-lic', command] : ['-l']
  } else if (command) {
    const message = GIT_BASH_MISSING_MESSAGE.replace(/'/g, "''")
    args = ['-NoProfile', '-NonInteractive', '-Command', `Write-Host '${message}' -ForegroundColor Yellow; exit 1`]
  } else {
    args = ['-NoProfile']
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
