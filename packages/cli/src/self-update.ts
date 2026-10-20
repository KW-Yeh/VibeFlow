import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { isNewerVersion } from './update-check'

const execFileAsync = promisify(execFile)
export const INSTALL_POLL_INTERVAL_MS = 3000
/** A failed run of the new CLI (install still writing, or broken) is retried this much later. */
export const PROBE_RETRY_MS = 30_000
/** Carries the running host's token to the host that replaces it, so open tabs stay signed in. */
export const HOST_TOKEN_ENV = 'VIBEFLOW_HOST_TOKEN'

function readInstalledVersion(packageRoot: string): string | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')) as { version?: unknown }
    return typeof pkg.version === 'string' ? pkg.version : null
  } catch {
    return null
  }
}

async function probeCli(cliEntry: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(process.execPath, [cliEntry, '--version'], { timeout: 15_000, windowsHide: true })
    return stdout.trim()
  } catch {
    return null
  }
}

/**
 * Report a newer release once npm has finished installing it over this one.
 * npm writes the package over several seconds, so a version counts only after
 * two identical reads and a run of the new CLI that reports it. `onInstalled`
 * repeats every tick, so a restart that was blocked can happen later.
 */
export function watchInstalledVersion(options: {
  packageRoot: string
  cliEntry: string
  currentVersion: string
  onInstalled: (version: string) => void
  readVersion?: (packageRoot: string) => string | null
  probe?: (cliEntry: string) => Promise<string | null>
  now?: () => number
}) {
  const readVersion = options.readVersion ?? readInstalledVersion
  const probe = options.probe ?? probeCli
  const now = options.now ?? Date.now
  let previous: string | null = null
  let installed: string | null = null
  const probedAt = new Map<string, number>()
  let busy = false

  const tick = async (): Promise<void> => {
    if (busy) return
    busy = true
    try {
      const version = readVersion(options.packageRoot)
      const seenTwice = version !== null && version === previous
      previous = version
      if (!version || !isNewerVersion(version, options.currentVersion)) return
      if (installed !== version) {
        const last = probedAt.get(version)
        if (!seenTwice || (last !== undefined && now() - last < PROBE_RETRY_MS)) return
        probedAt.set(version, now())
        if ((await probe(options.cliEntry)) !== version) return
        installed = version
      }
      options.onInstalled(version)
    } finally {
      busy = false
    }
  }

  return { tick }
}

/** The command line of the host that replaces this one: same store, port and session backend. */
export function relaunchArgs(cliEntry: string, options: { userDataDir: string; port: number; backend: string }): string[] {
  return [cliEntry, 'web', '--no-open', '--store-path', options.userDataDir, '--port', String(options.port), '--backend', options.backend]
}

/** A token handed over by the previous host, removed from the environment so sessions never inherit it. */
export function takeHandedOverToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const token = env[HOST_TOKEN_ENV]
  delete env[HOST_TOKEN_ENV]
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : undefined
}
