import fs from 'fs'
import os from 'os'
import path from 'path'

/**
 * VibeFlow's own store of reusable skills / prompts / scripts, so a task's
 * instructions do not depend on how the machine happens to lay out
 * `~/.claude`, `~/.codex` and `~/.agents` — and so both agent CLIs receive the
 * same set. Lives under `<userData>/library/`.
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
}

/** Provenance + enablement. Disk decides what exists; this only annotates it. */
interface LibraryIndex {
  version: 1
  entries: Record<
    string,
    { sourcePath?: string; importedAt?: number; enabled?: boolean; description?: string }
  >
}

const INDEX_FILE = 'index.json'
const MAX_NAME_BYTES = 100

export interface LibraryPaths {
  root: string
  skills: string
  prompts: string
  scripts: string
  /** Generated claude plugin, passed to `--plugin-dir`. */
  plugin: string
  /** Generated CODEX_HOME, whose `skills/` is codex's only discovery root. */
  codexHome: string
}

export function libraryPaths(root: string): LibraryPaths {
  return {
    root,
    skills: path.join(root, KIND_DIR.skill),
    prompts: path.join(root, KIND_DIR.prompt),
    scripts: path.join(root, KIND_DIR.script),
    plugin: path.join(root, 'plugin'),
    codexHome: path.join(root, 'codex-home'),
  }
}

/**
 * The library root for the running app. Electron redirects `userData` in dev,
 * so this must never be captured at import time.
 */
export async function libraryRoot(): Promise<string> {
  const { app } = await import('electron')
  return path.join(app.getPath('userData'), LIBRARY_DIR)
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
 * A name safe to use as a single path segment. Skill names also have to survive
 * being a directory name inside a generated plugin and a CODEX_HOME, so the
 * same filter applies to every kind.
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

function readIndex(root: string): LibraryIndex {
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath(root), 'utf8')) as unknown
    if (parsed && typeof parsed === 'object' && 'entries' in parsed) {
      const entries = (parsed as LibraryIndex).entries
      if (entries && typeof entries === 'object') return { version: 1, entries }
    }
  } catch {
    // Absent or corrupt index just means no provenance is known yet.
  }
  return { version: 1, entries: {} }
}

function writeIndex(root: string, index: LibraryIndex): void {
  fs.mkdirSync(root, { recursive: true })
  fs.writeFileSync(indexPath(root), `${JSON.stringify(index, null, 2)}\n`)
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

/**
 * Every entry present on disk, annotated from the index. Disk is authoritative:
 * an index record whose files are gone is ignored, so deleting a directory by
 * hand cannot leave a phantom entry in the UI.
 */
export function listLibrary(root: string): LibraryEntry[] {
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
      })
    }
  }

  return entries.sort((a, b) => a.key.localeCompare(b.key))
}

function annotate(
  root: string,
  key: string,
  patch: { sourcePath?: string; importedAt?: number; enabled?: boolean; description?: string }
): void {
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

  annotate(root, entryKey(kind, name), {
    sourcePath: resolved,
    importedAt: Date.now(),
    enabled: true,
  })
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

export function deleteEntry(root: string, kind: LibraryKind, name: string): void {
  fs.rmSync(entryPath(root, kind, name), { recursive: true, force: true })
  const index = readIndex(root)
  delete index.entries[entryKey(kind, name)]
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

/** Skills the user's own codex install discovers, so codex can be given parity. */
export function userCodexSkillsDir(home = os.homedir()): string {
  return path.join(home, '.codex', 'skills')
}

/** Skills committed to the project, discovered by claude and mirrored to codex. */
export function projectSkillsDir(worktreePath: string): string {
  return path.join(worktreePath, '.claude', 'skills')
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

/** Rebuilt from `skills/` on every launch, so it is never hand-edited. */
const PLUGIN_MANIFEST_DIR = '.claude-plugin'

/**
 * Regenerate the claude plugin that `--plugin-dir` loads. Only the plugin's own
 * `skills/` tree is replaced: claude discovers the project's and the user's
 * skills by itself, so the plugin carries the library and nothing else.
 */
export function buildPluginDir(root: string): { pluginDir: string; skills: string[] } {
  const paths = libraryPaths(root)
  const enabled = listLibrary(root).filter((e) => e.kind === 'skill' && e.enabled)

  fs.rmSync(path.join(paths.plugin, 'skills'), { recursive: true, force: true })
  fs.mkdirSync(path.join(paths.plugin, PLUGIN_MANIFEST_DIR), { recursive: true })
  fs.mkdirSync(path.join(paths.plugin, 'skills'), { recursive: true })
  fs.writeFileSync(
    path.join(paths.plugin, PLUGIN_MANIFEST_DIR, 'plugin.json'),
    `${JSON.stringify(
      {
        name: 'vibeflow-library',
        version: '1.0.0',
        description: 'Skills delivered by VibeFlow for this task.',
      },
      null,
      2
    )}\n`
  )
  for (const entry of enabled) {
    fs.cpSync(entry.path, path.join(paths.plugin, 'skills', entry.name), {
      recursive: true,
      dereference: true,
    })
  }
  return { pluginDir: paths.plugin, skills: enabled.map((e) => e.name) }
}

function linkOrSkip(target: string, linkPath: string): boolean {
  if (!fs.existsSync(target)) return false
  try {
    fs.rmSync(linkPath, { recursive: true, force: true })
    fs.symlinkSync(target, linkPath)
    return true
  } catch {
    return false
  }
}

export interface CodexHomeResult {
  codexHome: string
  /** Skill names actually exposed, by the source that won. */
  project: string[]
  user: string[]
  library: string[]
  /** Names dropped because a higher-priority source already claimed them. */
  shadowed: { name: string; keptFrom: 'project' | 'user'; dropped: 'user' | 'library' }[]
}

/**
 * Regenerate the CODEX_HOME whose `skills/` is codex's only discovery root, so
 * codex ends up with the same skills claude discovers on its own: the project's
 * `.claude/skills`, the user's `~/.codex/skills`, and the library.
 *
 * Only `skills/` is rebuilt. `auth.json` and `config.toml` are linked back to
 * the real codex home — the first keeps the user logged in, the second keeps
 * their MCP servers, and dropping either silently degrades every codex task.
 * Everything else codex writes here (sessions, history) is left alone so
 * `codex resume` still finds prior work.
 *
 * On a name collision the closer source wins: project over user over library.
 */
export function buildCodexHome(
  root: string,
  worktreePath?: string,
  userCodexHome = path.join(os.homedir(), '.codex')
): CodexHomeResult {
  const paths = libraryPaths(root)
  const skillsDir = path.join(paths.codexHome, 'skills')
  fs.rmSync(skillsDir, { recursive: true, force: true })
  fs.mkdirSync(skillsDir, { recursive: true })

  for (const file of ['auth.json', 'config.toml']) {
    linkOrSkip(path.join(userCodexHome, file), path.join(paths.codexHome, file))
  }

  const result: CodexHomeResult = {
    codexHome: paths.codexHome,
    project: [],
    user: [],
    library: [],
    shadowed: [],
  }
  const claimed = new Map<string, 'project' | 'user'>()

  const projectDir = worktreePath ? projectSkillsDir(worktreePath) : undefined
  if (projectDir) {
    for (const name of skillNamesIn(projectDir)) {
      if (linkOrSkip(path.join(projectDir, name), path.join(skillsDir, name))) {
        result.project.push(name)
        claimed.set(name, 'project')
      }
    }
  }

  const userDir = path.join(userCodexHome, 'skills')
  for (const name of skillNamesIn(userDir)) {
    const owner = claimed.get(name)
    if (owner) {
      result.shadowed.push({ name, keptFrom: owner, dropped: 'user' })
      continue
    }
    if (linkOrSkip(path.join(userDir, name), path.join(skillsDir, name))) {
      result.user.push(name)
      claimed.set(name, 'user')
    }
  }

  for (const entry of listLibrary(root)) {
    if (entry.kind !== 'skill' || !entry.enabled) continue
    const owner = claimed.get(entry.name)
    if (owner) {
      result.shadowed.push({ name: entry.name, keptFrom: owner, dropped: 'library' })
      continue
    }
    fs.cpSync(entry.path, path.join(skillsDir, entry.name), {
      recursive: true,
      dereference: true,
    })
    result.library.push(entry.name)
  }

  return result
}

export interface LibraryScript {
  name: string
  path: string
  description?: string
}

export interface LibraryLaunchInfo {
  /** Passed to claude's `--plugin-dir`. */
  pluginDir: string
  /** Exported as CODEX_HOME for codex launches. */
  codexHome: string
  /** Granted to claude via `--add-dir` so scripts here are readable/runnable. */
  libraryDir: string
  scripts: LibraryScript[]
  /** Enabled prompt bodies, joined — folded into the launch's system prompt. */
  promptText: string
}

/**
 * Everything a launch needs from the library, with both delivery trees rebuilt
 * so an entry enabled a moment ago is present. Returns null when nothing is
 * enabled, letting callers skip every library flag entirely.
 */
export function libraryLaunchInfoAt(
  root: string,
  worktreePath?: string,
  userCodexHome?: string
): LibraryLaunchInfo | null {
  const entries = listLibrary(root).filter((e) => e.enabled)
  if (entries.length === 0) return null

  const { pluginDir } = buildPluginDir(root)
  const { codexHome } = buildCodexHome(root, worktreePath, userCodexHome)

  const scripts = entries
    .filter((e) => e.kind === 'script')
    .map((e) => ({ name: e.name, path: e.path, description: e.description }))

  const promptBodies = entries
    .filter((e) => e.kind === 'prompt')
    .map((e) => readEntryContent(root, 'prompt', e.name).trim())
    .filter(Boolean)

  const lines = [...promptBodies]
  if (scripts.length > 0) {
    lines.push(
      '可用的工具腳本（需要時自行執行，不需要就別跑）：',
      ...scripts.map((s) => `- ${s.path}${s.description ? ` — ${s.description}` : ''}`)
    )
  }

  return {
    pluginDir,
    codexHome,
    libraryDir: root,
    scripts,
    promptText: lines.join('\n\n'),
  }
}

/** `libraryLaunchInfoAt` against the running app's library root. */
export async function libraryLaunchInfo(
  worktreePath?: string
): Promise<LibraryLaunchInfo | null> {
  return libraryLaunchInfoAt(await libraryRoot(), worktreePath)
}
