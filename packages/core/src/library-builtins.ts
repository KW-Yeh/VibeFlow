import fs from 'fs'
import path from 'path'
import {
  annotate,
  ensureLibrary,
  entryKey,
  entryPath,
  hashSkillDir,
  indexIsCorrupt,
  libraryRoot,
  listLibrary,
  markBuiltinDeleted,
  readIndex,
  safeLibraryName,
  skillNamesIn,
  writeIndex,
  type LibraryEntry,
} from './library'
import { getPlatform } from './platform'

/**
 * Skills VibeFlow ships in every user's library. Each lands as an ordinary
 * library entry the user may edit, disable or delete; `builtinHash` in the
 * index remembers what was installed, so an untouched copy can follow new
 * releases and an edited one is never overwritten.
 */

/** The shipped skills of this install, or null when it carries none. */
export function builtinSkillsDir(): string | null {
  return getPlatform().builtinSkillsDir?.() ?? null
}

/**
 * Copy one shipped skill over the library's; returns the hash of what landed.
 * The copy goes to a dot-named sibling first (the listing skips dot names) and
 * replaces the old one only once complete, so a failed copy leaves the
 * previous version in place instead of a directory without SKILL.md — which
 * the next sync would read as "the user deleted it".
 */
function installBuiltin(root: string, builtinDir: string, name: string): string {
  const target = entryPath(root, 'skill', name)
  const staging = entryPath(root, 'skill', `.${name}.installing`)
  fs.rmSync(staging, { recursive: true, force: true })
  try {
    fs.cpSync(path.join(builtinDir, name), staging, {
      recursive: true,
      dereference: true,
      filter: (src) => path.basename(src) !== '__pycache__',
    })
    fs.rmSync(target, { recursive: true, force: true })
    fs.renameSync(staging, target)
  } finally {
    fs.rmSync(staging, { recursive: true, force: true })
  }
  return hashSkillDir(target)
}

/**
 * Bring the library in line with the shipped skills. Installs new ones,
 * updates the ones the user has not touched, and leaves everything else —
 * edited copies, deleted ones, and same-name entries the user made — alone.
 */
export function syncBuiltinSkills(
  root: string,
  builtinDir: string | null
): { installed: string[]; updated: string[] } {
  const result = { installed: [] as string[], updated: [] as string[] }
  if (!builtinDir) return result
  const names = skillNamesIn(builtinDir)
  if (names.length === 0) return result
  // Unreadable provenance would make every built-in look user-owned and bring
  // deleted ones back; leave the library as it is until a user write sets it aside.
  if (indexIsCorrupt(root)) {
    console.error('Library index.json is unreadable; skipping built-in skill sync')
    return result
  }
  ensureLibrary(root)

  for (const name of names) {
    try {
      syncOne(root, builtinDir, name, result)
    } catch (err) {
      // One broken skill must not hold back the rest.
      console.error(`Failed to sync built-in skill "${name}":`, err)
    }
  }
  return result
}

function syncOne(
  root: string,
  builtinDir: string,
  name: string,
  result: { installed: string[]; updated: string[] }
): void {
  const key = entryKey('skill', name)
  const record = readIndex(root).entries[key] ?? {}
  if (record.builtinDeleted) return
  const target = entryPath(root, 'skill', name)

  if (!record.builtinHash) {
    // Something already holds the name: the user's own entry, not ours to take.
    if (fs.existsSync(target)) return
    annotate(root, key, {
      builtinHash: installBuiltin(root, builtinDir, name),
      enabled: true,
      importedAt: Date.now(),
    })
    result.installed.push(name)
    return
  }

  if (!fs.existsSync(path.join(target, 'SKILL.md'))) {
    // Removed by hand rather than through the panel: same intent.
    markBuiltinDeleted(root, key)
    return
  }
  if (hashSkillDir(path.join(builtinDir, name)) === record.builtinHash) return
  if (hashSkillDir(target) !== record.builtinHash) return
  annotate(root, key, { builtinHash: installBuiltin(root, builtinDir, name) })
  result.updated.push(name)
}

/** Overwrite (or bring back) a built-in with the shipped version. */
export function restoreBuiltinSkill(
  root: string,
  builtinDir: string | null,
  name: string
): LibraryEntry {
  if (!builtinDir || safeLibraryName(name) !== name || !skillNamesIn(builtinDir).includes(name)) {
    throw new Error(`不是內建 skill：${name}`)
  }
  const key = entryKey('skill', name)
  // A panel opened before the user made their own same-name skill may still
  // offer this; the files are theirs now.
  if (fs.existsSync(entryPath(root, 'skill', name)) && !readIndex(root).entries[key]?.builtinHash) {
    throw new Error(`已有同名的自訂項目：${name}`)
  }
  ensureLibrary(root)
  const builtinHash = installBuiltin(root, builtinDir, name)
  const index = readIndex(root)
  const record = { ...index.entries[key], builtinHash, enabled: true, importedAt: Date.now() }
  delete record.builtinDeleted
  // Shipped, not imported: no source to re-import from.
  delete record.sourcePath
  index.entries[key] = record
  writeIndex(root, index)
  const entry = listLibrary(root, builtinDir).find((e) => e.key === key)
  if (!entry) throw new Error(`還原失敗：${name}`)
  return entry
}

/** Shipped skills the user deleted, unless they have since made their own. */
export function removedBuiltinSkills(root: string, builtinDir: string | null): string[] {
  if (!builtinDir) return []
  const index = readIndex(root)
  return skillNamesIn(builtinDir).filter(
    (name) =>
      index.entries[entryKey('skill', name)]?.builtinDeleted === true &&
      !fs.existsSync(entryPath(root, 'skill', name))
  )
}

/** Host startup hook: never lets a library problem stop the host. */
export async function syncBuiltinsAtStartup(): Promise<void> {
  try {
    const { installed, updated } = syncBuiltinSkills(await libraryRoot(), builtinSkillsDir())
    if (installed.length || updated.length) {
      console.log(`Built-in skills — installed: ${installed.join(', ') || '-'}; updated: ${updated.join(', ') || '-'}`)
    }
  } catch (err) {
    console.error('Failed to sync built-in skills:', err)
  }
}
