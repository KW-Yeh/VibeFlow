import fs from 'fs'
import path from 'path'
import { randomBytes } from 'crypto'
import { isDeepStrictEqual } from 'util'
import { getPlatform } from './platform'

export interface JsonStoreOptions<T> {
  /** File name without extension: `<cwd>/<name>.json`. */
  name: string
  defaults: T
  /** Directory of the file. Absent = the platform's userData directory. */
  cwd?: string
}

/** Windows reports a rename over a file another process has open as one of these. */
const RENAME_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])
const RENAME_ATTEMPTS = 10
const RENAME_BACKOFF_MS = 20

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * A JSON file of top-level keys, drop-in for the subset of electron-store
 * VibeFlow used — and reading the same file, so state written by earlier
 * versions is picked up with no migration step.
 *
 * Like electron-store, every read goes to disk: the board CLI writes the same
 * file while the app runs, and a cached copy would overwrite its changes.
 * Writes go to a temp file that is then renamed over the original, so a crash
 * mid-write never leaves half a JSON document behind.
 */
export class JsonStore<T extends object> {
  readonly path: string
  private readonly defaults: T

  constructor(options: JsonStoreOptions<T>) {
    const dir = options.cwd ?? getPlatform().userDataDir()
    this.path = path.join(dir, `${options.name}.json`)
    this.defaults = options.defaults
    // electron-store persisted missing defaults at construction; keep doing so,
    // since `has()` callers rely on a key being absent until something sets it.
    const current = this.read()
    const merged = { ...this.defaults, ...current }
    if (!isDeepStrictEqual(current, merged)) this.write(merged)
  }

  /** The whole document, with defaults filled in for missing keys. */
  get store(): T {
    return { ...this.defaults, ...this.read() } as T
  }

  get<K extends keyof T>(key: K): T[K]
  get<K extends keyof T>(key: K, fallback: NonNullable<T[K]>): NonNullable<T[K]>
  get<K extends keyof T>(key: K, fallback?: T[K]): T[K] | undefined {
    const value = this.store[key]
    return value === undefined ? fallback : value
  }

  set<K extends keyof T>(key: K, value: T[K]): void {
    const data = this.read()
    data[key as string] = value
    this.write(data)
  }

  has(key: keyof T): boolean {
    return Object.prototype.hasOwnProperty.call(this.read(), key)
  }

  delete(key: keyof T): void {
    const data = this.read()
    if (!Object.prototype.hasOwnProperty.call(data, key)) return
    delete data[key as string]
    this.write(data)
  }

  private read(): Record<string, unknown> {
    let text: string
    try {
      text = fs.readFileSync(this.path, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw err
    }
    // A corrupt file throws rather than reading as empty: the next write would
    // otherwise replace the user's board with defaults.
    const parsed: unknown = text.trim() === '' ? {} : JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${this.path} does not hold a JSON object`)
    }
    return parsed as Record<string, unknown>
  }

  private write(data: Record<string, unknown>): void {
    fs.mkdirSync(path.dirname(this.path), { recursive: true })
    const tmp = `${this.path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
    // Tab-indented, as electron-store wrote it, so diffs of the file stay small.
    fs.writeFileSync(tmp, JSON.stringify(data, null, '\t'))
    for (let attempt = 1; ; attempt++) {
      try {
        fs.renameSync(tmp, this.path)
        return
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code ?? ''
        if (attempt < RENAME_ATTEMPTS && RENAME_RETRY_CODES.has(code)) {
          sleepSync(RENAME_BACKOFF_MS * attempt)
          continue
        }
        fs.rmSync(tmp, { force: true })
        throw err
      }
    }
  }
}
