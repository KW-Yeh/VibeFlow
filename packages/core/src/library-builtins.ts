import fs from 'fs'
import path from 'path'
import {
  annotate,
  ensureLibrary,
  entryKey,
  entryPath,
  hashSkillDir,
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

/** Copy one shipped skill over the library's; returns the hash of what landed. */
function installBuiltin(root: string, builtinDir: string, name: string): string {
  const target = entryPath(root, 'skill', name)
  fs.rmSync(target, { recursive: true, force: true })
  fs.cpSync(path.join(builtinDir, name), target, {
    recursive: true,
    dereference: true,
    filter: (src) => path.basename(src) !== '__pycache__',
  })
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
  ensureLibrary(root)

  for (const name of names) {
    const key = entryKey('skill', name)
    const record = readIndex(root).entries[key] ?? {}
    if (record.builtinDeleted) continue
    const target = entryPath(root, 'skill', name)

    if (!record.builtinHash) {
      // Something already holds the name: the user's own entry, not ours to take.
      if (fs.existsSync(target)) continue
      annotate(root, key, {
        builtinHash: installBuiltin(root, builtinDir, name),
        enabled: true,
        importedAt: Date.now(),
      })
      result.installed.push(name)
      continue
    }

    if (!fs.existsSync(path.join(target, 'SKILL.md'))) {
      // Removed by hand rather than through the panel: same intent.
      markBuiltinDeleted(root, key)
      continue
    }
    if (hashSkillDir(path.join(builtinDir, name)) === record.builtinHash) continue
    if (hashSkillDir(target) !== record.builtinHash) continue
    annotate(root, key, { builtinHash: installBuiltin(root, builtinDir, name) })
    result.updated.push(name)
  }
  return result
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
  ensureLibrary(root)
  const key = entryKey('skill', name)
  const builtinHash = installBuiltin(root, builtinDir, name)
  const index = readIndex(root)
  const record = { ...index.entries[key], builtinHash, enabled: true, importedAt: Date.now() }
  delete record.builtinDeleted
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
