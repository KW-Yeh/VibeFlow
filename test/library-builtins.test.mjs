import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import {
  annotate,
  createEntry,
  deleteEntry,
  ensureLibrary,
  hashSkillDir,
  listLibrary,
  setEntryEnabled,
  updateEntry,
  readSkillDescription,
  skillNamesIn,
} from '../packages/core/src/library.ts'
import {
  removedBuiltinSkills,
  restoreBuiltinSkill,
  syncBuiltinSkills,
} from '../packages/core/src/library-builtins.ts'

const skillMd = (name, extra = '') => `---\nname: ${name}\ndescription: ${name} skill\n---\n${extra}`

async function setup(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-builtins-'))
  t.after(() => fs.rm(base, { recursive: true, force: true }))
  const root = path.join(base, 'library')
  const shipped = path.join(base, 'builtin-skills')
  for (const name of ['probe', 'other']) {
    await fs.mkdir(path.join(shipped, name, 'scripts'), { recursive: true })
    await fs.writeFile(path.join(shipped, name, 'SKILL.md'), skillMd(name))
    await fs.writeFile(path.join(shipped, name, 'scripts', 'run.py'), 'print(1)\n')
  }
  return { root, shipped }
}

const read = (root, name) => fsSync.readFileSync(path.join(root, 'skills', name, 'SKILL.md'), 'utf8')
const index = (root) => JSON.parse(fsSync.readFileSync(path.join(root, 'index.json'), 'utf8'))
const release = (shipped, name, text) =>
  fs.writeFile(path.join(shipped, name, 'SKILL.md'), skillMd(name, text))

test('first sync installs every shipped skill, with its files, enabled', async (t) => {
  const { root, shipped } = await setup(t)
  assert.deepEqual(syncBuiltinSkills(root, shipped), { installed: ['other', 'probe'], updated: [] })
  assert.ok(fsSync.existsSync(path.join(root, 'skills', 'probe', 'scripts', 'run.py')))
  const probe = listLibrary(root, shipped).find((e) => e.name === 'probe')
  assert.equal(probe.enabled, true)
  assert.deepEqual(probe.builtin, { modified: false, updateAvailable: false })
  assert.deepEqual(syncBuiltinSkills(root, shipped), { installed: [], updated: [] }, 'idempotent')
})

test('an unmodified built-in follows the shipped version and keeps its enabled flag', async (t) => {
  const { root, shipped } = await setup(t)
  syncBuiltinSkills(root, shipped)
  setEntryEnabled(root, 'skill', 'probe', false)
  await release(shipped, 'probe', 'v2\n')

  assert.deepEqual(syncBuiltinSkills(root, shipped), { installed: [], updated: ['probe'] })
  assert.match(read(root, 'probe'), /v2/)
  const probe = listLibrary(root, shipped).find((e) => e.name === 'probe')
  assert.equal(probe.enabled, false)
  assert.deepEqual(probe.builtin, { modified: false, updateAvailable: false })
})

test('a modified built-in is left alone and flagged updateAvailable', async (t) => {
  const { root, shipped } = await setup(t)
  syncBuiltinSkills(root, shipped)
  updateEntry(root, 'skill', 'probe', skillMd('probe', 'mine\n'))
  await release(shipped, 'probe', 'v2\n')

  assert.deepEqual(syncBuiltinSkills(root, shipped).updated, [])
  assert.match(read(root, 'probe'), /mine/)
  const probe = listLibrary(root, shipped).find((e) => e.name === 'probe')
  assert.deepEqual(probe.builtin, { modified: true, updateAvailable: true })
})

test('a deleted built-in stays deleted and is listed as removed', async (t) => {
  const { root, shipped } = await setup(t)
  syncBuiltinSkills(root, shipped)
  deleteEntry(root, 'skill', 'probe')
  await release(shipped, 'probe', 'v2\n')

  assert.deepEqual(syncBuiltinSkills(root, shipped), { installed: [], updated: [] })
  assert.equal(fsSync.existsSync(path.join(root, 'skills', 'probe')), false)
  assert.deepEqual(removedBuiltinSkills(root, shipped), ['probe'])
})

test('a built-in directory removed by hand counts as deleted', async (t) => {
  const { root, shipped } = await setup(t)
  syncBuiltinSkills(root, shipped)
  await fs.rm(path.join(root, 'skills', 'probe'), { recursive: true })

  syncBuiltinSkills(root, shipped)
  assert.equal(fsSync.existsSync(path.join(root, 'skills', 'probe')), false)
  assert.deepEqual(index(root).entries['skill/probe'], { builtinDeleted: true })
})

test("a user's own same-name entry is never taken over", async (t) => {
  const { root, shipped } = await setup(t)
  ensureLibrary(root)
  createEntry(root, 'skill', 'probe', skillMd('probe', 'my own\n'))

  assert.deepEqual(syncBuiltinSkills(root, shipped).installed, ['other'])
  assert.match(read(root, 'probe'), /my own/)
  assert.equal(listLibrary(root, shipped).find((e) => e.name === 'probe').builtin, undefined)
})

test('a removed built-in recreated by the user is no longer offered for restore', async (t) => {
  const { root, shipped } = await setup(t)
  syncBuiltinSkills(root, shipped)
  deleteEntry(root, 'skill', 'probe')
  createEntry(root, 'skill', 'probe', skillMd('probe', 'my own\n'))

  assert.deepEqual(removedBuiltinSkills(root, shipped), [])
  syncBuiltinSkills(root, shipped)
  assert.match(read(root, 'probe'), /my own/)
})

test('restore brings back a deleted or modified built-in, enabled', async (t) => {
  const { root, shipped } = await setup(t)
  syncBuiltinSkills(root, shipped)
  updateEntry(root, 'skill', 'probe', skillMd('probe', 'mine\n'))
  setEntryEnabled(root, 'skill', 'probe', false)
  deleteEntry(root, 'skill', 'other')

  const probe = restoreBuiltinSkill(root, shipped, 'probe')
  assert.deepEqual(probe.builtin, { modified: false, updateAvailable: false })
  assert.equal(probe.enabled, true)
  assert.doesNotMatch(read(root, 'probe'), /mine/)

  restoreBuiltinSkill(root, shipped, 'other')
  assert.deepEqual(removedBuiltinSkills(root, shipped), [])
  assert.equal(index(root).entries['skill/other'].builtinDeleted, undefined)
  assert.equal(index(root).entries['skill/other'].builtinHash, hashSkillDir(path.join(shipped, 'other')))
})

test('restore refuses names that are not shipped, and a missing shipped dir', async (t) => {
  const { root, shipped } = await setup(t)
  assert.throws(() => restoreBuiltinSkill(root, shipped, 'nope'), /內建/)
  assert.throws(() => restoreBuiltinSkill(root, shipped, '../probe'), /內建/)
  assert.throws(() => restoreBuiltinSkill(root, null, 'probe'), /內建/)
  assert.equal(fsSync.existsSync(path.join(root, 'skills')), false, 'nothing written')
})

test('no shipped dir: sync and the removed list are no-ops', async (t) => {
  const { root } = await setup(t)
  assert.deepEqual(syncBuiltinSkills(root, null), { installed: [], updated: [] })
  assert.deepEqual(syncBuiltinSkills(root, path.join(root, 'missing')), { installed: [], updated: [] })
  assert.deepEqual(removedBuiltinSkills(root, null), [])
})

test('annotate keeps working for built-in records (smoke)', async (t) => {
  const { root, shipped } = await setup(t)
  syncBuiltinSkills(root, shipped)
  annotate(root, 'skill/probe', { description: 'x' })
  assert.ok(index(root).entries['skill/probe'].builtinHash)
})

test('the shipped skills are well-formed and do not depend on a checkout path', () => {
  const dir = path.resolve('packages/core/builtin-skills')
  assert.deepEqual(skillNamesIn(dir), ['pr', 'visual-parity'])
  for (const name of skillNamesIn(dir)) {
    const md = fsSync.readFileSync(path.join(dir, name, 'SKILL.md'), 'utf8')
    assert.match(md, new RegExp(`^---\\r?\\nname: ${name}\\r?\\n`), `${name}: frontmatter name`)
    assert.ok(readSkillDescription(path.join(dir, name, 'SKILL.md')), `${name}: description`)
    assert.doesNotMatch(md, /~\/\.claude|\.claude\/skills|~\/\.Codex|eBug|Jira/, `${name}: no machine paths`)
  }
  assert.ok(fsSync.existsSync(path.join(dir, 'visual-parity', 'scripts', 'parity.py')))
})

test('restore refuses to overwrite an entry the user owns (stale panel)', async (t) => {
  const { root, shipped } = await setup(t)
  syncBuiltinSkills(root, shipped)
  deleteEntry(root, 'skill', 'probe')
  createEntry(root, 'skill', 'probe', skillMd('probe', 'my own\n'))

  assert.throws(() => restoreBuiltinSkill(root, shipped, 'probe'), /已有同名/)
  assert.match(read(root, 'probe'), /my own/)
})

test('the shipped pr skill pushes unpushed commits and never edits another branch\'s PR', () => {
  const md = fsSync.readFileSync(path.resolve('packages/core/builtin-skills/pr/SKILL.md'), 'utf8')
  assert.match(md, /@\{upstream\}\.\.HEAD/, 'checks for commits the upstream lacks')
  assert.match(md, /headRefName/, 'update mode compares the PR head with the current branch')
})
