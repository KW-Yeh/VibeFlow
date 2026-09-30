import fs from 'fs'
import path from 'path'

/**
 * `<userData>/core.lock`: which process is this machine's core host, and how
 * to reach it. Every `vibeflow` command reads it. The one that creates it
 * becomes the host, and the others connect to `port` with `token`.
 */
export interface LockInfo {
  pid: number
  /** 0 while the host is still starting its server. */
  port: number
  token: string
  version: string
  startedAt: number
}

export function lockPath(userDataDir: string): string {
  return path.join(userDataDir, 'core.lock')
}

/** True while `pid` runs. EPERM means it runs as another user, which still counts. */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export function readLock(userDataDir: string): LockInfo | null {
  try {
    const info = JSON.parse(fs.readFileSync(lockPath(userDataDir), 'utf8')) as LockInfo
    return typeof info.pid === 'number' && typeof info.token === 'string' ? info : null
  } catch {
    return null
  }
}

/** The running host, or null when there is none (no lock, or a stale one). */
export function liveHost(userDataDir: string): LockInfo | null {
  const info = readLock(userDataDir)
  return info && isProcessAlive(info.pid) ? info : null
}

export type AcquireResult = { acquired: true } | { acquired: false; holder: LockInfo }

/**
 * Become the host. The file is created with `wx`, so of two processes starting
 * at once exactly one wins. A lock whose pid is gone is stale: removed and
 * retried once. Mode 0600 keeps the token readable by this user only. Windows
 * ignores the mode, but `%APPDATA%` is already private to the user there.
 */
export function acquireLock(userDataDir: string, info: LockInfo): AcquireResult {
  fs.mkdirSync(userDataDir, { recursive: true })
  const file = lockPath(userDataDir)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, JSON.stringify(info), { flag: 'wx', mode: 0o600 })
      return { acquired: true }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
    const holder = readLock(userDataDir)
    if (holder && holder.pid !== info.pid && isProcessAlive(holder.pid)) {
      return { acquired: false, holder }
    }
    fs.rmSync(file, { force: true })
  }
  const holder = readLock(userDataDir)
  if (holder) return { acquired: false, holder }
  throw new Error(`could not acquire ${file}`)
}

/** Record the server port once it is listening. Only the holder may call this. */
export function updateLock(userDataDir: string, info: LockInfo): void {
  const file = lockPath(userDataDir)
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(info), { mode: 0o600 })
  fs.renameSync(tmp, file)
}

/** Remove the lock if this process holds it. */
export function releaseLock(userDataDir: string): void {
  if (readLock(userDataDir)?.pid === process.pid) {
    fs.rmSync(lockPath(userDataDir), { force: true })
  }
}
