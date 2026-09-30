import { execFile, execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import * as nodePty from 'node-pty'
import type { EventSink } from './events'
import { buildPtyEnv, defaultShell } from './pty'
import {
  safeSessionName,
  type SessionBackend,
  type SessionStartOptions,
  type StartResult,
} from './session-backend'

/** Dedicated server socket, so the user's own tmux sessions and config are never touched. */
export const TMUX_SOCKET = 'vibeflow'

/**
 * VibeFlow's own tmux config (`-f`), so user `~/.tmux.conf` settings cannot
 * change how sessions behave. The status bar is off because the UI already
 * shows which card a terminal belongs to.
 */
export const TMUX_CONF = [
  'set -g default-terminal "xterm-256color"',
  'set -g status off',
  'set -g mouse on',
  'set -g history-limit 50000',
  'set -g escape-time 0',
  'set -g window-size latest',
  'set -g remain-on-exit off',
  '',
].join('\n')

export type TmuxRun = (args: string[]) => Promise<{ code: number; stdout: string }>

/** Quote for POSIX sh. */
function q(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function defaultRun(env: NodeJS.ProcessEnv): TmuxRun {
  return (args) =>
    new Promise((resolve) => {
      execFile('tmux', args, { env }, (err, stdout) => {
        const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0
        resolve({ code, stdout: String(stdout ?? '') })
      })
    })
}

/** True when a usable tmux is on PATH. Windows is never treated as having one. */
export function hasTmux(): boolean {
  if (process.platform === 'win32') return false
  try {
    execFileSync('tmux', ['-V'], { stdio: 'ignore', env: buildPtyEnv() })
    return true
  } catch {
    return false
  }
}

export interface TmuxBackendOptions {
  /** Directory for the config file, output logs and exit-status files. */
  stateDir: string
  /** Injected in tests; defaults to running the tmux binary. */
  run?: TmuxRun
  /** Injected in tests; defaults to node-pty running `tmux attach`. */
  attach?: (args: string[], cols: number, rows: number) => nodePty.IPty
}

interface Client {
  proc: nodePty.IPty
  onExit?: () => void
}

/**
 * Sessions live in a tmux server on the `vibeflow` socket and outlive core,
 * the UI and the TUI. Core watches one through a node-pty `tmux attach`
 * client, so the Web terminal behaves as it does with PtyBackend. Several
 * attached clients (another tab, the TUI) are kept in sync by tmux itself.
 *
 * Each session's output is appended to `<stateDir>/logs/<name>.log` by
 * `pipe-pane`. The exit status is written next to it by the wrapper around the
 * command, because tmux discards it when the pane closes.
 */
export class TmuxBackend implements SessionBackend {
  readonly kind = 'tmux' as const
  private readonly clients = new Map<string, Client>()
  /** Attach clients we closed on purpose, whose exit must not report the session as ended. */
  private readonly detached = new WeakSet<nodePty.IPty>()
  /** Sessions we killed, so their exit reads as intentional. */
  private readonly killed = new Set<string>()
  private readonly run: TmuxRun
  private readonly confPath: string
  private readonly logDir: string

  private readonly sink: EventSink
  private readonly options: TmuxBackendOptions

  constructor(sink: EventSink, options: TmuxBackendOptions) {
    this.sink = sink
    this.options = options
    this.run = options.run ?? defaultRun(buildPtyEnv())
    this.confPath = path.join(options.stateDir, 'tmux.conf')
    this.logDir = path.join(options.stateDir, 'logs')
  }

  /** `tmux -L vibeflow -f <conf> …` */
  private tmux(...args: string[]): Promise<{ code: number; stdout: string }> {
    return this.run(['-L', TMUX_SOCKET, '-f', this.confPath, ...args])
  }

  sessionName(key: string): string {
    return `vf-${safeSessionName(key)}`
  }

  logPath(key: string): string {
    return path.join(this.logDir, `${this.sessionName(key)}.log`)
  }

  private statusPath(key: string): string {
    return path.join(this.logDir, `${this.sessionName(key)}.status`)
  }

  private ensureFiles(): void {
    fs.mkdirSync(this.logDir, { recursive: true })
    fs.writeFileSync(this.confPath, TMUX_CONF)
  }

  /**
   * The pane's command: the login shell running `command` (or staying
   * interactive), then the exit status saved where `readExitCode` finds it.
   */
  paneCommand(key: string, command?: string): string {
    const shell = defaultShell()
    const inner = command ? `${q(shell)} -lic ${q(command)}` : `${q(shell)} -l`
    const status = q(this.statusPath(key))
    return `${inner}; code=$?; printf %s "$code" > ${status}; exit "$code"`
  }

  async isAlive(key: string): Promise<boolean> {
    const { code } = await this.tmux('has-session', '-t', `=${this.sessionName(key)}`)
    return code === 0
  }

  async list(): Promise<string[]> {
    const { code, stdout } = await this.tmux('list-sessions', '-F', '#{session_name}')
    if (code !== 0) return []
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((name) => name.startsWith('vf-'))
      .map((name) => name.slice(3))
  }

  async start(key: string, options: SessionStartOptions): Promise<StartResult> {
    const { cwd, command, onExit, cols = 80, rows = 24, fresh = false } = options
    this.ensureFiles()
    const name = this.sessionName(key)
    const alive = await this.isAlive(key)
    const reattach = alive && !command && !fresh

    // Drop our old client first: replacing a session, like PtyBackend's
    // kill-and-restart, reports no exit for the one being replaced.
    this.detach(key)
    if (!reattach) {
      if (alive) await this.tmux('kill-session', '-t', `=${name}`)
      fs.rmSync(this.statusPath(key), { force: true })
      const created = await this.tmux(
        'new-session', '-d', '-s', name, '-x', String(cols), '-y', String(rows),
        '-c', cwd, this.paneCommand(key, command)
      )
      if (created.code !== 0) throw new Error(`tmux new-session failed for ${name}`)
      await this.tmux('pipe-pane', '-o', '-t', `=${name}`, `cat >> ${q(this.logPath(key))}`)
    }

    const proc = this.options.attach
      ? this.options.attach(this.attachArgs(key), cols, rows)
      : nodePty.spawn('tmux', this.attachArgs(key), {
          name: 'xterm-256color',
          cwd,
          env: { ...buildPtyEnv(), TMUX: '' },
          cols,
          rows,
        })
    this.clients.set(key, { proc, onExit })
    proc.onData((data) => {
      if (!this.sink.isDestroyed()) this.sink.send('pty:data', { sessionKey: key, data })
    })
    proc.onExit(() => {
      void this.onClientExit(key, proc)
    })
    return { pid: proc.pid, scrollback: null, attached: reattach }
  }

  scrollback(): string | null {
    return null
  }

  attachArgs(key: string): string[] {
    return ['-L', TMUX_SOCKET, '-f', this.confPath, 'attach-session', '-t', `=${this.sessionName(key)}`]
  }

  /** The attach client ended: either we closed it, or the session itself is gone. */
  private async onClientExit(key: string, proc: nodePty.IPty): Promise<void> {
    if (this.detached.has(proc)) return
    const client = this.clients.get(key)
    if (client?.proc !== proc) return
    // A client can also drop without the session ending (tmux detach key);
    // then the task is still running and nothing is reported.
    if (await this.isAlive(key)) {
      this.clients.delete(key)
      return
    }
    this.clients.delete(key)
    const intentional = this.killed.delete(key)
    const exitCode = this.readExitCode(key) ?? (intentional ? 129 : 0)
    if (!this.sink.isDestroyed()) {
      this.sink.send('pty:exit', { sessionKey: key, exitCode, intentional })
    }
    client.onExit?.()
  }

  readExitCode(key: string): number | null {
    try {
      const code = Number(fs.readFileSync(this.statusPath(key), 'utf8').trim())
      return Number.isFinite(code) ? code : null
    } catch {
      return null
    }
  }

  /** Close this process's attach client; the tmux session keeps running. */
  private detach(key: string): void {
    const client = this.clients.get(key)
    if (!client) return
    this.detached.add(client.proc)
    this.clients.delete(key)
    try {
      client.proc.kill()
    } catch {
      // already gone
    }
  }

  write(key: string, data: string): void {
    this.clients.get(key)?.proc.write(data)
  }

  resize(key: string, cols: number, rows: number): void {
    try {
      this.clients.get(key)?.proc.resize(Math.max(cols, 1), Math.max(rows, 1))
    } catch {
      // the client already exited
    }
  }

  async kill(key: string): Promise<void> {
    const client = this.clients.get(key)
    this.killed.add(key)
    await this.tmux('kill-session', '-t', `=${this.sessionName(key)}`)
    if (!client) {
      this.killed.delete(key)
      return
    }
    // The attach client exits on its own once the session is gone and
    // reports it (intentional). Detached clients report nothing.
  }

  shutdown(): void {
    for (const key of Array.from(this.clients.keys())) this.detach(key)
  }
}
