import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'

export interface HelperRepairFailure {
  path: string
  error: string
  /** Owned by another user (typically root after `sudo npm i -g`), so only that user can chmod it. */
  ownedByOther: boolean
}

function nodePtyRoot(): string | null {
  try {
    return path.dirname(createRequire(import.meta.url).resolve('node-pty/package.json'))
  } catch {
    return null
  }
}

/**
 * node-pty spawns every pty through `spawn-helper`, but its macOS prebuilds ship
 * that file without the executable bit (node-pty 1.1.0). A source checkout fixes
 * it in `postinstall`; an npm install of VibeFlow has no such step, so without
 * this every terminal fails with `posix_spawnp failed`. Returns the helpers that
 * could not be repaired (e.g. a root-owned global install).
 */
export function ensurePtySpawnHelper(root: string | null = nodePtyRoot()): HelperRepairFailure[] {
  if (process.platform === 'win32' || !root) return []
  const candidates = [
    path.join(root, 'build', 'Release', 'spawn-helper'),
    path.join(root, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper'),
  ]
  const failures: HelperRepairFailure[] = []
  for (const file of candidates) {
    let stat: fs.Stats
    try {
      stat = fs.statSync(file)
    } catch {
      continue
    }
    try {
      fs.accessSync(file, fs.constants.X_OK)
      continue
    } catch {
      // not executable for us: repair below
    }
    try {
      fs.chmodSync(file, (stat.mode & 0o7777) | 0o111)
    } catch (err) {
      const uid = process.getuid?.()
      failures.push({ path: file, error: (err as Error).message, ownedByOther: uid !== undefined && stat.uid !== uid })
    }
  }
  return failures
}

/** A shell command the user can paste to repair `failures`. */
export function spawnHelperFixCommand(failures: HelperRepairFailure[]): string {
  const sudo = failures.some((f) => f.ownedByOther) ? 'sudo ' : ''
  return `${sudo}chmod +x ${failures.map((f) => `"${f.path}"`).join(' ')}`
}
