import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import {
  buildCodexHome,
  buildPluginDir,
  createEntry,
  deleteEntry,
  ensureLibrary,
  entryPath,
  importEntry,
  libraryLaunchInfoAt,
  libraryPaths,
  listLibrary,
  readEntryContent,
  readSkillDescription,
  safeLibraryName,
  setEntryEnabled,
  skillNamesIn,
  updateEntry,
} from '../main/helpers/library.ts'

async function tmpDir(prefix = 'vf-library-') {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

const SKILL_MD = `---
name: probe
description: A probe skill used in tests.
---
body
`

async function makeSkillDir(root, name = 'probe', body = SKILL_MD) {
  const dir = path.join(root, name)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'SKILL.md'), body)
  return dir
}

// --- safeLibraryName ---

test('safeLibraryName — keeps hyphens and strips path separators', () => {
  // A mangled character class here once silently turned visual-parity into
  // visualparity, which would break every path derived from the name.
  assert.equal(safeLibraryName('visual-parity'), 'visual-parity')
  assert.equal(safeLibraryName('/abs/path/my-skill'), 'my-skill')
  assert.equal(safeLibraryName('a\\b\\win-skill'), 'win-skill')
  assert.equal(safeLibraryName('..'), 'untitled')
  assert.equal(safeLibraryName(''), 'untitled')
})

// --- readSkillDescription ---

test('readSkillDescription — reads the frontmatter field, tolerates junk', async () => {
  const dir = await tmpDir()
  const good = path.join(dir, 'SKILL.md')
  await fs.writeFile(good, SKILL_MD)
  assert.equal(readSkillDescription(good), 'A probe skill used in tests.')

  const quoted = path.join(dir, 'quoted.md')
  await fs.writeFile(quoted, '---\nname: x\ndescription: "quoted value"\n---\n')
  assert.equal(readSkillDescription(quoted), 'quoted value')

  const noFrontmatter = path.join(dir, 'plain.md')
  await fs.writeFile(noFrontmatter, 'description: not in frontmatter\n')
  assert.equal(readSkillDescription(noFrontmatter), undefined)

  assert.equal(readSkillDescription(path.join(dir, 'missing.md')), undefined)
})

// --- create / list / update / delete ---

test('createEntry — writes each kind to its own directory and lists it back', async () => {
  const root = await tmpDir()
  createEntry(root, 'skill', 'my-skill', SKILL_MD)
  createEntry(root, 'prompt', 'my-prompt.md', 'prompt body', 'a prompt')
  createEntry(root, 'script', 'run.sh', '#!/bin/sh\necho hi\n', 'a script')

  const paths = libraryPaths(root)
  assert.ok(fsSync.existsSync(path.join(paths.skills, 'my-skill', 'SKILL.md')))
  assert.ok(fsSync.existsSync(path.join(paths.prompts, 'my-prompt.md')))
  assert.ok(fsSync.existsSync(path.join(paths.scripts, 'run.sh')))

  const entries = listLibrary(root)
  assert.deepEqual(
    entries.map((e) => e.key),
    ['prompt/my-prompt.md', 'script/run.sh', 'skill/my-skill']
  )
  assert.ok(entries.every((e) => e.enabled), 'new entries default to enabled')

  const skill = entries.find((e) => e.kind === 'skill')
  assert.equal(skill.description, 'A probe skill used in tests.', 'skill description comes from frontmatter')
  const prompt = entries.find((e) => e.kind === 'prompt')
  assert.equal(prompt.description, 'a prompt', 'other kinds carry the typed description')
})

test('createEntry — a script is executable, so an agent can run it as a tool', async () => {
  const root = await tmpDir()
  createEntry(root, 'script', 'run.sh', '#!/bin/sh\n')
  const mode = fsSync.statSync(entryPath(root, 'script', 'run.sh')).mode
  assert.ok(mode & 0o100, 'owner execute bit must be set')
})

test('createEntry — refuses to clobber an existing entry', async () => {
  const root = await tmpDir()
  createEntry(root, 'prompt', 'dup.md', 'first')
  assert.throws(() => createEntry(root, 'prompt', 'dup.md', 'second'), /已存在/)
  assert.equal(readEntryContent(root, 'prompt', 'dup.md'), 'first')
})

test('updateEntry / readEntryContent — round-trip both shapes', async () => {
  const root = await tmpDir()
  createEntry(root, 'skill', 'my-skill', SKILL_MD)
  createEntry(root, 'prompt', 'p.md', 'v1')

  updateEntry(root, 'skill', 'my-skill', '---\nname: x\ndescription: updated\n---\n')
  updateEntry(root, 'prompt', 'p.md', 'v2')

  assert.match(readEntryContent(root, 'skill', 'my-skill'), /description: updated/)
  assert.equal(readEntryContent(root, 'prompt', 'p.md'), 'v2')
  assert.equal(listLibrary(root).find((e) => e.kind === 'skill').description, 'updated')

  assert.throws(() => updateEntry(root, 'prompt', 'nope.md', 'x'), /找不到/)
})

test('deleteEntry — removes the files and the index record', async () => {
  const root = await tmpDir()
  createEntry(root, 'skill', 'gone', SKILL_MD)
  deleteEntry(root, 'skill', 'gone')
  assert.equal(listLibrary(root).length, 0)
  assert.ok(!fsSync.existsSync(entryPath(root, 'skill', 'gone')))
})

// --- enablement ---

test('setEntryEnabled — survives a re-read and only affects the named entry', async () => {
  const root = await tmpDir()
  createEntry(root, 'skill', 'on', SKILL_MD)
  createEntry(root, 'skill', 'off', SKILL_MD)
  setEntryEnabled(root, 'skill', 'off', false)

  const byName = Object.fromEntries(listLibrary(root).map((e) => [e.name, e.enabled]))
  assert.deepEqual(byName, { on: true, off: false })
})

// --- import (snapshot semantics) ---

test('importEntry — copies a skill directory and records provenance', async () => {
  const root = await tmpDir()
  const src = await tmpDir('vf-src-')
  const sourceDir = await makeSkillDir(src, 'imported')

  const entry = importEntry(root, 'skill', sourceDir)
  assert.equal(entry.name, 'imported')
  assert.equal(entry.sourcePath, sourceDir)
  assert.ok(entry.importedAt > 0)
  assert.equal(entry.description, 'A probe skill used in tests.')
})

test('importEntry — is a snapshot: later edits to the source do not propagate', async () => {
  const root = await tmpDir()
  const src = await tmpDir('vf-src-')
  const sourceDir = await makeSkillDir(src, 'snap')
  importEntry(root, 'skill', sourceDir)

  await fs.writeFile(path.join(sourceDir, 'SKILL.md'), '---\nname: snap\ndescription: CHANGED\n---\n')

  assert.equal(
    listLibrary(root).find((e) => e.name === 'snap').description,
    'A probe skill used in tests.',
    'the library keeps the copy taken at import time'
  )
})

test('importEntry — rejects a skill without SKILL.md and a directory given as a file', async () => {
  const root = await tmpDir()
  const src = await tmpDir('vf-src-')
  const bare = path.join(src, 'bare')
  await fs.mkdir(bare, { recursive: true })

  assert.throws(() => importEntry(root, 'skill', bare), /SKILL\.md/)
  assert.throws(() => importEntry(root, 'prompt', bare), /單一檔案/)

  const file = path.join(src, 'note.md')
  await fs.writeFile(file, 'x')
  assert.throws(() => importEntry(root, 'skill', file), /目錄/)
})

test('importEntry — re-import replaces the snapshot in place', async () => {
  const root = await tmpDir()
  const src = await tmpDir('vf-src-')
  const sourceDir = await makeSkillDir(src, 'again')
  importEntry(root, 'skill', sourceDir)

  await fs.writeFile(path.join(sourceDir, 'SKILL.md'), '---\nname: again\ndescription: v2\n---\n')
  importEntry(root, 'skill', sourceDir)

  const entries = listLibrary(root).filter((e) => e.name === 'again')
  assert.equal(entries.length, 1, 're-import must not create a duplicate')
  assert.equal(entries[0].description, 'v2')
})

// --- disk is authoritative ---

test('listLibrary — ignores index records whose files are gone, and stray shapes', async () => {
  const root = await tmpDir()
  createEntry(root, 'skill', 'real', SKILL_MD)
  createEntry(root, 'prompt', 'real.md', 'x')
  const paths = ensureLibrary(root)

  // Hand-deleted entry: the index still names it, the listing must not.
  await fs.rm(path.join(paths.prompts, 'real.md'))
  // A skill directory with no SKILL.md is not a skill.
  await fs.mkdir(path.join(paths.skills, 'not-a-skill'), { recursive: true })
  // A loose file in skills/, and a directory in prompts/ — both wrong shape.
  await fs.writeFile(path.join(paths.skills, 'loose.md'), 'x')
  await fs.mkdir(path.join(paths.prompts, 'a-dir'), { recursive: true })

  assert.deepEqual(listLibrary(root).map((e) => e.key), ['skill/real'])
})

test('listLibrary — an absent or corrupt index still lists what is on disk', async () => {
  const root = await tmpDir()
  createEntry(root, 'skill', 'kept', SKILL_MD)
  await fs.writeFile(path.join(root, 'index.json'), '{ not json')

  const entries = listLibrary(root)
  assert.deepEqual(entries.map((e) => e.key), ['skill/kept'])
  assert.equal(entries[0].enabled, true, 'unknown enablement defaults to enabled')
})

// --- skill discovery helpers used by the delivery layer ---

test('skillNamesIn — lists only directories holding a SKILL.md', async () => {
  const dir = await tmpDir('vf-skills-')
  await makeSkillDir(dir, 'beta')
  await makeSkillDir(dir, 'alpha')
  await fs.mkdir(path.join(dir, 'no-manifest'), { recursive: true })
  await fs.writeFile(path.join(dir, 'loose.md'), 'x')
  await fs.mkdir(path.join(dir, '.hidden'), { recursive: true })

  assert.deepEqual(skillNamesIn(dir), ['alpha', 'beta'])
  assert.deepEqual(skillNamesIn(path.join(dir, 'missing')), [], 'absent dir is empty, not an error')
})

// --- delivery layer ---

test('buildPluginDir — carries only enabled library skills, with a manifest', async () => {
  const root = await tmpDir()
  createEntry(root, 'skill', 'on-a', SKILL_MD)
  createEntry(root, 'skill', 'on-b', SKILL_MD)
  createEntry(root, 'skill', 'off', SKILL_MD)
  setEntryEnabled(root, 'skill', 'off', false)

  const { pluginDir, skills } = buildPluginDir(root)
  assert.deepEqual(skills, ['on-a', 'on-b'])

  const manifest = JSON.parse(
    fsSync.readFileSync(path.join(pluginDir, '.claude-plugin', 'plugin.json'), 'utf8')
  )
  assert.equal(manifest.name, 'vibeflow-library')
  assert.ok(fsSync.existsSync(path.join(pluginDir, 'skills', 'on-a', 'SKILL.md')))
  assert.ok(!fsSync.existsSync(path.join(pluginDir, 'skills', 'off')))
})

test('buildPluginDir — a disabled skill disappears on the next rebuild', async () => {
  const root = await tmpDir()
  createEntry(root, 'skill', 'temp', SKILL_MD)
  buildPluginDir(root)
  setEntryEnabled(root, 'skill', 'temp', false)
  const { pluginDir, skills } = buildPluginDir(root)
  assert.deepEqual(skills, [])
  assert.ok(!fsSync.existsSync(path.join(pluginDir, 'skills', 'temp')))
})

async function makeFakeCodexHome() {
  const home = await tmpDir('vf-codexhome-')
  await fs.writeFile(path.join(home, 'auth.json'), '{"token":"x"}')
  await fs.writeFile(path.join(home, 'config.toml'), '[mcp_servers.x]\n')
  await fs.mkdir(path.join(home, 'skills'), { recursive: true })
  await fs.mkdir(path.join(home, 'sessions'), { recursive: true })
  return home
}

test('buildCodexHome — unions project, user and library skills', async () => {
  const root = await tmpDir()
  const userHome = await makeFakeCodexHome()
  await makeSkillDir(path.join(userHome, 'skills'), 'user-only')

  const worktree = await tmpDir('vf-worktree-')
  await makeSkillDir(path.join(worktree, '.claude', 'skills'), 'project-only')

  createEntry(root, 'skill', 'library-only', SKILL_MD)

  const res = buildCodexHome(root, worktree, userHome)
  assert.deepEqual(res.project, ['project-only'])
  assert.deepEqual(res.user, ['user-only'])
  assert.deepEqual(res.library, ['library-only'])

  const skillsDir = path.join(res.codexHome, 'skills')
  for (const name of ['project-only', 'user-only', 'library-only']) {
    assert.ok(
      fsSync.existsSync(path.join(skillsDir, name, 'SKILL.md')),
      `${name} must be discoverable by codex`
    )
  }
})

test('buildCodexHome — links auth and config back, since dropping either breaks codex', async () => {
  const root = await tmpDir()
  const userHome = await makeFakeCodexHome()
  const res = buildCodexHome(root, undefined, userHome)

  for (const file of ['auth.json', 'config.toml']) {
    const link = path.join(res.codexHome, file)
    assert.equal(
      fsSync.realpathSync(link),
      fsSync.realpathSync(path.join(userHome, file)),
      `${file} must resolve to the real codex home`
    )
  }
})

test('buildCodexHome — closer source wins and the shadowed one is reported', async () => {
  const root = await tmpDir()
  const userHome = await makeFakeCodexHome()
  const worktree = await tmpDir('vf-worktree-')

  // Same name in all three sources, each with a distinguishable description.
  await makeSkillDir(
    path.join(worktree, '.claude', 'skills'),
    'clash',
    '---\nname: clash\ndescription: from-project\n---\n'
  )
  await makeSkillDir(
    path.join(userHome, 'skills'),
    'clash',
    '---\nname: clash\ndescription: from-user\n---\n'
  )
  createEntry(root, 'skill', 'clash', '---\nname: clash\ndescription: from-library\n---\n')

  const res = buildCodexHome(root, worktree, userHome)
  assert.deepEqual(res.project, ['clash'])
  assert.deepEqual(res.user, [])
  assert.deepEqual(res.library, [])
  assert.equal(
    readSkillDescription(path.join(res.codexHome, 'skills', 'clash', 'SKILL.md')),
    'from-project'
  )
  assert.deepEqual(
    res.shadowed.map((s) => `${s.dropped}<${s.keptFrom}`).sort(),
    ['library<project', 'user<project']
  )
})

test('buildCodexHome — rebuilding skills does not wipe what codex writes there', async () => {
  const root = await tmpDir()
  const userHome = await makeFakeCodexHome()
  const first = buildCodexHome(root, undefined, userHome)
  const marker = path.join(first.codexHome, 'sessions', 'keep.jsonl')
  await fs.mkdir(path.dirname(marker), { recursive: true })
  await fs.writeFile(marker, 'prior session')

  buildCodexHome(root, undefined, userHome)
  assert.ok(fsSync.existsSync(marker), 'codex resume must still find prior sessions')
})

test('libraryLaunchInfoAt — null when nothing is enabled, so callers add no flags', async () => {
  const root = await tmpDir()
  assert.equal(libraryLaunchInfoAt(root), null)

  createEntry(root, 'skill', 'only', SKILL_MD)
  setEntryEnabled(root, 'skill', 'only', false)
  assert.equal(libraryLaunchInfoAt(root), null, 'all-disabled counts as nothing enabled')
})

test('libraryLaunchInfoAt — folds prompts and scripts into promptText', async () => {
  const root = await tmpDir()
  const userHome = await makeFakeCodexHome()
  createEntry(root, 'prompt', 'house-rules.md', '一律用繁體中文回報。', 'house rules')
  createEntry(root, 'script', 'check.sh', '#!/bin/sh\n', 'runs the checks')

  const info = libraryLaunchInfoAt(root, undefined, userHome)
  assert.ok(info)
  assert.match(info.promptText, /一律用繁體中文回報。/)
  assert.match(info.promptText, /可用的工具腳本/)
  assert.match(info.promptText, /check\.sh — runs the checks/)
  assert.deepEqual(info.scripts.map((s) => s.name), ['check.sh'])
  assert.equal(info.libraryDir, root)
})

test('libraryLaunchInfoAt — omits the script section when there are no scripts', async () => {
  const root = await tmpDir()
  const userHome = await makeFakeCodexHome()
  createEntry(root, 'prompt', 'p.md', 'just a prompt')
  const info = libraryLaunchInfoAt(root, undefined, userHome)
  assert.ok(!info.promptText.includes('可用的工具腳本'))
})
