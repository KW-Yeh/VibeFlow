import * as nodePty from 'node-pty'
import type { EventSink } from './events'
import type { SessionBackend, SessionStartOptions, StartResult } from './session-backend'
import { buildEnv } from './env'
import { findGitBash, GIT_BASH_MISSING_MESSAGE } from './git-bash'

// Procs we tore down on purpose (session kill / phase switch). node-pty's
// kill() sends SIGHUP, so the shell exits 129 — an expected teardown, not a
// crash. The renderer reads this flag to avoid a false「異常結束」warning.
const intentionalKills = new WeakSet<nodePty.IPty>()

const MAX_SCROLLBACK = 512 * 1024  // 512 KB per session

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
export function buildPtyEnv(): Record<string, string> {
  const env: Record<string, string> = { ...buildEnv(), TERM: 'xterm-256color' }
  for (const key of INHERITED_AGENT_SESSION_VARS) delete env[key]
  return env
}

export function defaultShell(): string {
  if (process.platform === 'win32') {
    // Launch commands are written in POSIX sh syntax; Git Bash is required to run them.
    return findGitBash() ?? 'powershell.exe'
  }
  return process.env.SHELL || '/bin/zsh'
}

/**
 * Login-shell arguments for `shell`: run `command` when given, else stay
 * interactive. Launch commands are POSIX sh, so on Windows only Git Bash can
 * run them; the PowerShell fallback reports what is missing and exits 1 so the
 * renderer shows the failure and hands back an interactive shell.
 */
export function shellArgs(shell: string, command?: string): string[] {
  const isPosixShell =
    process.platform !== 'win32' || shell.toLowerCase().endsWith('bash.exe')
  if (isPosixShell) return command ? ['-lic', command] : ['-l']
  if (command) {
    const message = GIT_BASH_MISSING_MESSAGE.replace(/'/g, "''")
    return ['-NoProfile', '-NonInteractive', '-Command', `Write-Host '${message}' -ForegroundColor Yellow; exit 1`]
  }
  return ['-NoProfile']
}

/**
 * Sessions owned by this process: node-pty children of core. They end when
 * core ends. This is the only backend on Windows, where there is no tmux.
 */
export class PtyBackend implements SessionBackend {
  readonly kind = 'pty' as const
  private readonly sessions = new Map<string, nodePty.IPty>()
  /**
   * Scrollback ring buffer. It survives `kill` so a remounting terminal can
   * replay what happened before it unmounted, and is cleared when a new
   * *command* starts (a phase switch means a fresh terminal).
   */
  private readonly scrollbacks = new Map<string, string>()

  private readonly sink: EventSink

  constructor(sink: EventSink) {
    this.sink = sink
  }

  private appendScrollback(key: string, data: string): void {
    const cur = (this.scrollbacks.get(key) ?? '') + data
    // ponytail: slice from the end to keep the most-recent output
    this.scrollbacks.set(key, cur.length > MAX_SCROLLBACK ? cur.slice(-MAX_SCROLLBACK) : cur)
  }

  async start(key: string, options: SessionStartOptions): Promise<StartResult> {
    const { cwd, command, onExit, cols = 80, rows = 24, fresh = false } = options
    // Capture scrollback before the old PTY is killed. A new command means a new
    // phase (planning → execution), and an explicitly fresh interactive shell
    // is a new terminal session. Both start with an empty buffer; ordinary
    // remounts preserve output that arrived while the renderer was unmounted.
    const clearScrollback = Boolean(command) || fresh
    const scrollback = clearScrollback ? null : (this.scrollbacks.get(key) ?? null)
    if (clearScrollback) this.scrollbacks.delete(key)

    this.killNow(key)

    const shell = defaultShell()
    const proc = nodePty.spawn(shell, shellArgs(shell, command), {
      name: 'xterm-256color',
      cwd,
      env: buildPtyEnv(),
      cols,
      rows,
    })
    this.sessions.set(key, proc)

    proc.onData((data) => {
      this.appendScrollback(key, data)
      if (!this.sink.isDestroyed()) this.sink.send('pty:data', { sessionKey: key, data })
    })
    proc.onExit(({ exitCode }) => {
      const intentional = intentionalKills.has(proc)
      if (!this.sink.isDestroyed())
        this.sink.send('pty:exit', { sessionKey: key, exitCode, intentional })
      // Guard against a stale exit: a kill-and-restart replaces the map entry
      // before the old process's exit event fires, and that old event must not
      // deregister (or fire callbacks for) the new session.
      if (this.sessions.get(key) === proc) {
        this.sessions.delete(key)
        onExit?.()
      }
    })

    return { pid: proc.pid, scrollback }
  }

  write(key: string, data: string): void {
    this.sessions.get(key)?.write(data)
  }

  resize(key: string, cols: number, rows: number): void {
    try {
      this.sessions.get(key)?.resize(Math.max(cols, 1), Math.max(rows, 1))
    } catch {
      // resize can throw if the pty already exited — safe to ignore
    }
  }

  private killNow(key: string): void {
    const proc = this.sessions.get(key)
    if (!proc) return
    intentionalKills.add(proc)
    try {
      proc.kill()
    } catch {
      // already dead
    }
    this.sessions.delete(key)
  }

  async kill(key: string): Promise<void> {
    this.killNow(key)
  }

  async isAlive(key: string): Promise<boolean> {
    return this.sessions.has(key)
  }

  async list(): Promise<string[]> {
    return Array.from(this.sessions.keys())
  }

  scrollback(key: string): string | null {
    return this.scrollbacks.get(key) ?? null
  }

  discardScrollback(key: string): void {
    this.scrollbacks.delete(key)
  }

  async isScrolledBack(): Promise<boolean> {
    return false
  }

  async scrollToBottom(): Promise<void> {}

  shutdown(): void {
    for (const key of Array.from(this.sessions.keys())) this.killNow(key)
  }
}
