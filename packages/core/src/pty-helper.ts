import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'

export interface HelperRepairFailure {
  path: string
  error: string
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
    let mode: number
    try {
      mode = fs.statSync(file).mode
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
      fs.chmodSync(file, (mode & 0o7777) | 0o111)
    } catch (err) {
      failures.push({ path: file, error: (err as Error).message })
    }
  }
  return failures
}
