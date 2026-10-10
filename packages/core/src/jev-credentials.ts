import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { getPlatform } from './platform'

export interface JevKeyStatus {
  configured: boolean
  source: 'saved' | 'environment' | 'none'
}

function keyPath(dir: string): string {
  return path.join(dir, 'jev-api-key')
}

function dataDir(): string {
  return getPlatform().userDataDir()
}

/** Saved key takes precedence over the host's environment variable. */
export function readJevApiKey(dir = dataDir()): string | undefined {
  try {
    const file = keyPath(dir)
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Jev key file must not be a symlink')
    const saved = fs.readFileSync(file, 'utf8').trim()
    if (saved) return saved
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  return process.env.TYPESAFE_API_KEY?.trim() || undefined
}

export function jevKeyStatus(dir = dataDir()): JevKeyStatus {
  try {
    const file = keyPath(dir)
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Jev key file must not be a symlink')
    if (fs.readFileSync(file, 'utf8').trim()) return { configured: true, source: 'saved' }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  return process.env.TYPESAFE_API_KEY?.trim()
    ? { configured: true, source: 'environment' }
    : { configured: false, source: 'none' }
}

/** Store separately from vibeflow-state.json, which is sent to frontends. */
export function saveJevApiKey(value: string, dir = dataDir()): JevKeyStatus {
  const key = value.trim()
  if (!key || key.length > 4096 || !/^[\x21-\x7e]+$/.test(key)) {
    throw new Error('Jev API key 格式無效')
  }
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = keyPath(dir)
  const tmp = `${file}.${randomUUID()}.tmp`
  try {
    fs.writeFileSync(tmp, key, { mode: 0o600, flag: 'wx' })
    fs.renameSync(tmp, file)
    if (process.platform !== 'win32') fs.chmodSync(file, 0o600)
  } finally {
    fs.rmSync(tmp, { force: true })
  }
  return { configured: true, source: 'saved' }
}

export function removeJevApiKey(dir = dataDir()): JevKeyStatus {
  fs.rmSync(keyPath(dir), { force: true })
  return jevKeyStatus(dir)
}
