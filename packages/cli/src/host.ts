import fs from 'fs'
import path from 'path'
import { randomBytes } from 'crypto'
import { EventBus } from '../../core/src/events'
import { acquireLock, liveHost, releaseLock, updateLock, type LockInfo } from '../../core/src/lock'
import { createNodePlatform, setPlatform } from '../../core/src/platform'
import { syncBuiltinsAtStartup } from '../../core/src/library-builtins'
import { createCore, type Core, type CoreHandlers } from '../../core/src/service'
import { createSessionBackend } from '../../core/src/sessions'
import { startWebServer, type WebServer } from '../../core/src/web-server'

export interface HostOptions {
  userDataDir: string
  version: string
  /** The renderer's static export; null serves the API only (TUI-only hosts). */
  staticDir: string | null
  /** Repo checkout root when run from source, for the agents' board CLI. */
  sourceRoot: string | null
  /** The bundled CLI, when run from the npm build. */
  cliEntry: string | null
  backend: 'auto' | 'tmux' | 'pty'
  port?: number
}

export interface RunningHost {
  core: Core
  server: WebServer
  lock: LockInfo
  stop(): Promise<void>
}

export type HostStart = { kind: 'started'; host: RunningHost } | { kind: 'running'; lock: LockInfo }

/** Wait for a host that holds the lock but has not written its port yet. */
async function waitForPort(userDataDir: string, timeoutMs = 10_000): Promise<LockInfo | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const lock = liveHost(userDataDir)
    if (!lock) return null
    if (lock.port) return lock
    await new Promise((r) => setTimeout(r, 100))
  }
  return liveHost(userDataDir)
}

/**
 * Become this machine's core host (lock, core, Web server), or report the
 * host that already is. Only the host writes the store while it runs.
 */
export async function startHost(options: HostOptions): Promise<HostStart> {
  setPlatform(
    createNodePlatform({
      userDataDir: options.userDataDir,
      sourceRoot: options.sourceRoot,
      cliEntry: options.cliEntry,
    })
  )
  const lock: LockInfo = {
    pid: process.pid,
    port: 0,
    token: randomBytes(32).toString('base64url'),
    version: options.version,
    startedAt: Date.now(),
  }
  const acquired = acquireLock(options.userDataDir, lock)
  if (!acquired.acquired) {
    const running = acquired.holder.port ? acquired.holder : await waitForPort(options.userDataDir)
    if (running) return { kind: 'running', lock: running }
    // The holder died while starting; take over.
    return startHost(options)
  }

  try {
    // Only the lock holder writes the library, so this runs after acquiring it.
    await syncBuiltinsAtStartup()
    const bus = new EventBus()
    const sessions = createSessionBackend(bus.sink(), {
      prefer: options.backend,
      stateDir: options.userDataDir,
    })
    const core = createCore({ sessions, bus, version: options.version })
    let stopping: Promise<void> | null = null
    const handlers: CoreHandlers = {
      ...core.handlers,
      // `vibeflow shutdown`. Replies first, then stops.
      'host:shutdown': () => {
        setTimeout(() => void stop(), 50)
      },
      'host:info': () => ({
        pid: process.pid,
        version: options.version,
        backend: sessions.kind,
        startedAt: lock.startedAt,
      }),
    }
    const server = await startWebServer({
      handlers,
      bus,
      token: lock.token,
      staticDir: options.staticDir,
      port: options.port,
    })
    lock.port = server.port
    updateLock(options.userDataDir, lock)
    const stopWatch = core.watchStore()

    const stop = () =>
      (stopping ??= (async () => {
        stopWatch()
        core.shutdown()
        await server.close()
        releaseLock(options.userDataDir)
      })())

    return { kind: 'started', host: { core, server, lock, stop } }
  } catch (err) {
    releaseLock(options.userDataDir)
    throw err
  }
}

/** `http://127.0.0.1:<port>/home/?token=…` for a lock, the address a browser opens first. */
export function loginUrl(lock: LockInfo, pathname = '/home/'): string {
  return `http://127.0.0.1:${lock.port}${pathname}?token=${encodeURIComponent(lock.token)}`
}

/** A static export is usable when it has the board page. */
export function isWebDir(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'home', 'index.html'))
}
