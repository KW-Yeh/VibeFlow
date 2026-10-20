import { createHash } from 'crypto'
import fs from 'fs'
import path from 'path'
import { getPlatform } from './platform'

/**
 * VibeFlow's own store of reusable skills, prompt snippets and scripts. Nothing
 * here reaches an agent launch: the prompt carries only the user's system
 * prompt and the card. Lives under `<userData>/library/`.
 */
export const LIBRARY_DIR = 'library'

export type LibraryKind = 'skill' | 'prompt' | 'script'

export const LIBRARY_KINDS: LibraryKind[] = ['skill', 'prompt', 'script']

/** Directory each kind is stored in, relative to the library root. */
const KIND_DIR: Record<LibraryKind, string> = {
  skill: 'skills',
  prompt: 'prompts',
  script: 'scripts',
}

export interface LibraryEntry {
  /** `<kind>/<name>` — stable across renames of nothing, so it needs no uuid. */
  key: string
  kind: LibraryKind
  name: string
  /** Absolute path of the entry: a directory for skills, a file otherwise. */
  path: string
  /** Skills read it from SKILL.md frontmatter; others carry what the user typed. */
  description?: string
  /** Where an imported entry came from, for display and re-import. */
  sourcePath?: string
  importedAt?: number
  /** Whether this entry is delivered to agents. */
  enabled: boolean
  /** Set for skills VibeFlow ships; see syncBuiltinSkills. */
  builtin?: {
    /** The files no longer match what VibeFlow installed. */
    modified: boolean
    /** Modified, and the shipped version moved on since — "restore" would update it. */
    updateAvailable: boolean
  }
}

/** Provenance + enablement. Disk decides what exists; this only annotates it. */
export interface IndexRecord {
  sourcePath?: string
  importedAt?: number
  enabled?: boolean
  description?: string
  /** Hash of the built-in version VibeFlow last installed. Present = built-in. */
  builtinHash?: string
  /** The user deleted this built-in; sync must not bring it back. */
  builtinDeleted?: boolean
}

export interface LibraryIndex {
  version: 1
  entries: Record<string, IndexRecord>
}

const INDEX_FILE = 'index.json'
const MAX_NAME_BYTES = 100

export interface LibraryPaths {
  root: string
  skills: string
  prompts: string
  scripts: string
  /** CODEX_HOME earlier launches used; still read for those runs' rollouts. */
  codexHome: string
}

export function libraryPaths(root: string): LibraryPaths {
  return {
    root,
    skills: path.join(root, KIND_DIR.skill),
    prompts: path.join(root, KIND_DIR.prompt),
    scripts: path.join(root, KIND_DIR.script),
    codexHome: path.join(root, 'codex-home'),
  }
}

/**
 * The library root for the running app. The host registers its platform (and
 * so its data directory) at startup, so this must never be captured at import time.
 */
export async function libraryRoot(): Promise<string> {
  return path.join(getPlatform().userDataDir(), LIBRARY_DIR)
}

function truncateUtf8(value: string, maxBytes: number): string {
  let result = ''
  for (const character of value) {
    if (Buffer.byteLength(result + character) > maxBytes) break
    result += character
  }
  return result
}

/**
 * A name safe to use as a single path segment; the same filter applies to
 * every kind.
 */
export function safeLibraryName(name: string): string {
  const basename = name.replace(/\\/g, '/').split('/').pop() ?? ''
  const cleaned = truncateUtf8(
    basename.replace(/[\u0000-\u001f\u007f]/g, '').trim(),
    MAX_NAME_BYTES
  )
  return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : 'untitled'
}

export function entryKey(kind: LibraryKind, name: string): string {
  return `${kind}/${name}`
}

function indexPath(root: string): string {
  return path.join(root, INDEX_FILE)
}

/** The index as stored; `null` when the file exists but cannot be understood. */
function readIndexFile(root: string): LibraryIndex | null {
  let raw: string
  try {
    raw = fs.readFileSync(indexPath(root), 'utf8')
  } catch {
    return { version: 1, entries: {} }
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && 'entries' in parsed) {
      const entries = (parsed as LibraryIndex).entries
      if (entries && typeof entries === 'object') return { version: 1, entries }
    }
  } catch {
    // Falls through to null.
  }
  return null
}

/** A corrupt index is read as empty, so the library still lists from disk. */
export function readIndex(root: string): LibraryIndex {
  return readIndexFile(root) ?? { version: 1, entries: {} }
}

/** True when an index file exists but cannot be parsed. */
export function indexIsCorrupt(root: string): boolean {
  return readIndexFile(root) === null
}

/**
 * Atomic (temp file + rename), so a crash mid-write cannot corrupt it. A
 * corrupt index is moved aside first rather than overwritten: it may hold
 * the user's disabled flags, and it is the only copy.
 */
export function writeIndex(root: string, index: LibraryIndex): void {
  fs.mkdirSync(root, { recursive: true })
  const file = indexPath(root)
  if (indexIsCorrupt(root)) fs.renameSync(file, `${file}.corrupt-${Date.now()}`)
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(index, null, 2)}\n`)
  fs.renameSync(tmp, file)
}

/** Ensure the three kind directories exist so the UI has somewhere to write. */
export function ensureLibrary(root: string): LibraryPaths {
  const paths = libraryPaths(root)
  for (const kind of LIBRARY_KINDS) {
    fs.mkdirSync(path.join(root, KIND_DIR[kind]), { recursive: true })
  }
  return paths
}

/**
 * `description` from a SKILL.md's YAML frontmatter. Deliberately a line scan
 * rather than a YAML parse: the field is a single line in every skill both CLIs
 * accept, and a malformed file must degrade to "no description", never throw.
 */
export function readSkillDescription(skillMdPath: string): string | undefined {
  let content: string
  try {
    content = fs.readFileSync(skillMdPath, 'utf8')
  } catch {
    return undefined
  }
  const lines = content.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return undefined
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.trim() === '---') break
    const match = /^description:\s*(.+)$/.exec(line)
    if (match) return match[1].trim().replace(/^["']|["']$/g, '')
  }
  return undefined
}

/** Path of an entry on disk: a directory for skills, a file for the rest. */
export function entryPath(root: string, kind: LibraryKind, name: string): string {
  return path.join(root, KIND_DIR[kind], name)
}

/** Files a runtime drops into a skill that say nothing about its content. */
const HASH_IGNORED = new Set(['__pycache__', '.DS_Store'])

/**
 * Content hash of a skill directory: every file's relative path and bytes, in
 * path order. Line endings are not normalized — both sides of a comparison
 * are always on the same machine.
 */
export function hashSkillDir(dir: string): string {
  const files: string[] = []
  const walk = (rel: string) => {
    for (const dirent of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      if (HASH_IGNORED.has(dirent.name)) continue
      const child = rel ? `${rel}/${dirent.name}` : dirent.name
      if (fs.statSync(path.join(dir, child)).isDirectory()) walk(child)
      else files.push(child)
    }
  }
  walk('')
  const hash = createHash('sha256')
  for (const rel of files.sort()) {
    hash.update(rel).update('\0').update(fs.readFileSync(path.join(dir, rel))).update('\0')
  }
  return hash.digest('hex')
}

function builtinStatus(
  full: string,
  name: string,
  recorded: string,
  builtinDir: string | null
): NonNullable<LibraryEntry['builtin']> {
  try {
    const modified = hashSkillDir(full) !== recorded
    let updateAvailable = false
    if (modified && builtinDir) {
      const shipped = path.join(builtinDir, name)
      if (fs.existsSync(path.join(shipped, 'SKILL.md'))) {
        updateAvailable = hashSkillDir(shipped) !== recorded
      }
    }
    return { modified, updateAvailable }
  } catch {
    // An unreadable file or a dangling link the user added: it is no longer
    // what VibeFlow installed, and must not take the listing down with it.
    return { modified: true, updateAvailable: false }
  }
}

/**
 * Every entry present on disk, annotated from the index. Disk is authoritative:
 * an index record whose files are gone is ignored, so deleting a directory by
 * hand cannot leave a phantom entry in the UI.
 *
 * Built-in status is computed only when `builtinDir` is passed (null = this
 * install ships nothing), since it hashes every built-in.
 */
export function listLibrary(root: string, builtinDir?: string | null): LibraryEntry[] {
  const index = readIndex(root)
  const entries: LibraryEntry[] = []

  for (const kind of LIBRARY_KINDS) {
    const dir = path.join(root, KIND_DIR[kind])
    let dirents: fs.Dirent[]
    try {
      dirents = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const dirent of dirents) {
      if (dirent.name.startsWith('.')) continue
      const wantsDirectory = kind === 'skill'
      // A skill is a directory holding SKILL.md; prompts and scripts are files.
      // Symlinks resolve, so an imported-by-reference entry still lists.
      let stat: fs.Stats
      try {
        stat = fs.statSync(path.join(dir, dirent.name))
      } catch {
        continue
      }
      if (stat.isDirectory() !== wantsDirectory) continue

      const name = dirent.name
      const full = path.join(dir, name)
      if (wantsDirectory && !fs.existsSync(path.join(full, 'SKILL.md'))) continue

      const key = entryKey(kind, name)
      const record = index.entries[key] ?? {}
      entries.push({
        key,
        kind,
        name,
        path: full,
        description: wantsDirectory
          ? readSkillDescription(path.join(full, 'SKILL.md'))
          : record.description,
        sourcePath: record.sourcePath,
        importedAt: record.importedAt,
        enabled: record.enabled !== false,
        builtin:
          wantsDirectory && record.builtinHash && builtinDir !== undefined
            ? builtinStatus(full, name, record.builtinHash, builtinDir)
            : undefined,
      })
    }
  }

  return entries.sort((a, b) => a.key.localeCompare(b.key))
}

export function annotate(root: string, key: string, patch: Partial<IndexRecord>): void {
  const index = readIndex(root)
  index.entries[key] = { ...index.entries[key], ...patch }
  writeIndex(root, index)
}

/**
 * Copy an entry into the library. Import is a **snapshot**: later edits to the
 * source on disk do not propagate, which is what makes a task reproducible on
 * a machine laid out differently. `sourcePath` is kept only so the UI can offer
 * a re-import.
 */
export function importEntry(
  root: string,
  kind: LibraryKind,
  sourcePath: string
): LibraryEntry {
  ensureLibrary(root)
  const resolved = path.resolve(sourcePath)
  const stat = fs.statSync(resolved)

  if (kind === 'skill') {
    if (!stat.isDirectory()) throw new Error('skill 必須是含 SKILL.md 的目錄')
    if (!fs.existsSync(path.join(resolved, 'SKILL.md'))) {
      throw new Error('目錄內找不到 SKILL.md')
    }
  } else if (!stat.isFile()) {
    throw new Error(`${kind} 必須是單一檔案`)
  }

  const name = safeLibraryName(path.basename(resolved))
  const target = entryPath(root, kind, name)
  fs.rmSync(target, { recursive: true, force: true })
  fs.cpSync(resolved, target, { recursive: kind === 'skill', dereference: true })
  if (kind === 'script') fs.chmodSync(target, 0o755)

  // Imported files are the user's own: a built-in of the same name stops
  // being tracked, so sync never updates over the import.
  const key = entryKey(kind, name)
  const index = readIndex(root)
  const { builtinHash: _hash, builtinDeleted: _deleted, ...kept } = index.entries[key] ?? {}
  index.entries[key] = { ...kept, sourcePath: resolved, importedAt: Date.now(), enabled: true }
  writeIndex(root, index)
  return requireEntry(root, kind, name)
}

/** Create an entry from text typed in the UI rather than imported from disk. */
export function createEntry(
  root: string,
  kind: LibraryKind,
  rawName: string,
  content: string,
  description?: string
): LibraryEntry {
  ensureLibrary(root)
  const name = safeLibraryName(rawName)
  const target = entryPath(root, kind, name)
  if (fs.existsSync(target)) throw new Error(`已存在同名項目：${name}`)

  if (kind === 'skill') {
    fs.mkdirSync(target, { recursive: true })
    fs.writeFileSync(path.join(target, 'SKILL.md'), content)
  } else {
    fs.writeFileSync(target, content)
    if (kind === 'script') fs.chmodSync(target, 0o755)
  }
  annotate(root, entryKey(kind, name), {
    importedAt: Date.now(),
    enabled: true,
    description,
  })
  return requireEntry(root, kind, name)
}

export function setEntryDescription(
  root: string,
  kind: LibraryKind,
  name: string,
  description: string
): void {
  annotate(root, entryKey(kind, name), { description })
}

/** Overwrite an entry's text. Skills write SKILL.md; other kinds the file. */
export function updateEntry(
  root: string,
  kind: LibraryKind,
  name: string,
  content: string
): LibraryEntry {
  const target = entryPath(root, kind, name)
  if (!fs.existsSync(target)) throw new Error(`找不到項目：${name}`)
  fs.writeFileSync(kind === 'skill' ? path.join(target, 'SKILL.md') : target, content)
  return requireEntry(root, kind, name)
}

export function readEntryContent(
  root: string,
  kind: LibraryKind,
  name: string
): string {
  const target = entryPath(root, kind, name)
  return fs.readFileSync(kind === 'skill' ? path.join(target, 'SKILL.md') : target, 'utf8')
}

/** Forget a built-in's provenance but remember the user removed it. */
export function markBuiltinDeleted(root: string, key: string): void {
  const index = readIndex(root)
  index.entries[key] = { builtinDeleted: true }
  writeIndex(root, index)
}

export function deleteEntry(root: string, kind: LibraryKind, name: string): void {
  fs.rmSync(entryPath(root, kind, name), { recursive: true, force: true })
  const key = entryKey(kind, name)
  const record = readIndex(root).entries[key]
  if (record?.builtinHash || record?.builtinDeleted) {
    markBuiltinDeleted(root, key)
    return
  }
  const index = readIndex(root)
  delete index.entries[key]
  writeIndex(root, index)
}

export function setEntryEnabled(
  root: string,
  kind: LibraryKind,
  name: string,
  enabled: boolean
): void {
  annotate(root, entryKey(kind, name), { enabled })
}

function requireEntry(root: string, kind: LibraryKind, name: string): LibraryEntry {
  const found = listLibrary(root).find((e) => e.key === entryKey(kind, name))
  if (!found) throw new Error(`項目寫入後讀不回來：${kind}/${name}`)
  return found
}

/** Directory names holding a SKILL.md, or [] when the directory is absent. */
export function skillNamesIn(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => !d.name.startsWith('.'))
      .map((d) => d.name)
      .filter((name) => fs.existsSync(path.join(dir, name, 'SKILL.md')))
      .sort()
  } catch {
    return []
  }
}
