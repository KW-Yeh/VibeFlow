import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs/promises'
import { readBranchSpecs, readWorktreeSpecs } from '../packages/core/src/specs.ts'
import { makeRepo, git, writeFile } from './support/repo.mjs'

const SPEC_A = 'docs/features/login/spec.md'
const SPEC_B = 'docs/features/export/spec.md'

/** A repo whose base already carries one unrelated spec, plus a task worktree. */
async function setup(t) {
  const repo = await makeRepo({ withRemote: false })
  t.after(repo.cleanup)
  await writeFile(repo.projectPath, 'docs/features/old/spec.md', '# old\n')
  await git(repo.projectPath, 'add', '-A')
  await git(repo.projectPath, 'commit', '-m', 'old spec')
  const worktreePath = path.join(repo.root, 'wt')
  await git(repo.projectPath, 'worktree', 'add', '-b', 'vf-task', worktreePath, 'main')
  return { ...repo, worktreePath }
}

test('readWorktreeSpecs — no spec on the branch means none, even if the base has one', async (t) => {
  const { worktreePath } = await setup(t)
  assert.deepEqual(await readWorktreeSpecs(worktreePath, 'main'), [])
})

test('readWorktreeSpecs — picks up uncommitted and committed specs, sorted by path', async (t) => {
  const { worktreePath } = await setup(t)
  await writeFile(worktreePath, SPEC_A, '# login\n')
  await git(worktreePath, 'add', '-A')
  await git(worktreePath, 'commit', '-m', 'spec a')
  await writeFile(worktreePath, SPEC_B, '# export\n')
  await writeFile(worktreePath, 'docs/features/export/plan.md', '# plan\n')

  const specs = await readWorktreeSpecs(worktreePath, 'main')
  assert.deepEqual(specs.map((s) => s.path), [SPEC_B, SPEC_A])
  assert.equal(specs[1].markdown, '# login\n')
  assert.equal(typeof specs[0].updatedAt, 'number')
})

test('readWorktreeSpecs — an edited base spec counts, a deleted one does not', async (t) => {
  const { worktreePath } = await setup(t)
  await writeFile(worktreePath, 'docs/features/old/spec.md', '# old, revised\n')
  assert.deepEqual(
    (await readWorktreeSpecs(worktreePath, 'main')).map((s) => s.markdown),
    ['# old, revised\n']
  )
  await fs.rm(path.join(worktreePath, 'docs/features/old/spec.md'))
  assert.deepEqual(await readWorktreeSpecs(worktreePath, 'main'), [])
})

test('readBranchSpecs — reads committed specs off the branch once the worktree is gone', async (t) => {
  const { projectPath, worktreePath } = await setup(t)
  await writeFile(worktreePath, SPEC_A, '# login\n')
  await git(worktreePath, 'add', '-A')
  await git(worktreePath, 'commit', '-m', 'spec a')
  await git(projectPath, 'worktree', 'remove', '--force', worktreePath)

  const specs = await readBranchSpecs(projectPath, 'vf-task', 'main')
  assert.deepEqual(specs.map((s) => s.path), [SPEC_A])
  assert.equal(specs[0].markdown.trim(), '# login')
  assert.equal(typeof specs[0].updatedAt, 'number')
})

test('readBranchSpecs — the captured file list survives the branch being merged', async (t) => {
  const { projectPath, worktreePath } = await setup(t)
  await writeFile(worktreePath, SPEC_A, '# login\n')
  await git(worktreePath, 'add', '-A')
  await git(worktreePath, 'commit', '-m', 'spec a')
  await git(projectPath, 'worktree', 'remove', '--force', worktreePath)
  await git(projectPath, 'merge', '--no-ff', '-m', 'merge', 'vf-task')

  assert.deepEqual(await readBranchSpecs(projectPath, 'vf-task', 'main'), [])
  const specs = await readBranchSpecs(projectPath, 'vf-task', 'main', [SPEC_A, 'src/x.ts'])
  assert.deepEqual(specs.map((s) => s.path), [SPEC_A])
})

test('readBranchSpecs — a deleted branch or an uncommitted spec yields nothing', async (t) => {
  const { projectPath } = await setup(t)
  assert.deepEqual(await readBranchSpecs(projectPath, 'vf-gone', 'main'), [])
  assert.deepEqual(await readBranchSpecs(projectPath, 'vf-task', 'main', [SPEC_A]), [])
})

/**
 * A task completed the way the app completes one: the branch is pushed,
 * merged on the remote as a GitHub PR merge commit, and deleted both locally
 * and on origin, leaving only the merge commit behind.
 */
async function mergedAndDeleted(t, { subject } = {}) {
  const repo = await makeRepo({ withRemote: true })
  t.after(repo.cleanup)
  const { projectPath } = repo
  await git(projectPath, 'checkout', '-b', 'feature/login')
  await writeFile(projectPath, SPEC_A, '# login, as merged\n')
  await git(projectPath, 'add', '-A')
  await git(projectPath, 'commit', '-m', 'spec a')
  await git(projectPath, 'push', '-u', 'origin', 'feature/login')
  await git(projectPath, 'checkout', 'main')
  await git(
    projectPath,
    'merge',
    '--no-ff',
    '-m',
    subject ?? 'Merge pull request #12 from acme/feature/login',
    'feature/login'
  )
  await writeFile(projectPath, SPEC_A, '# login, edited later on main\n')
  await git(projectPath, 'commit', '-am', 'later edit')
  await git(projectPath, 'push', 'origin', 'main')
  await git(projectPath, 'push', 'origin', '--delete', 'feature/login')
  await git(projectPath, 'branch', '-D', 'feature/login')
  await git(projectPath, 'fetch', '--prune', 'origin')
  return repo
}

test('readBranchSpecs — falls back to origin/<branch> once the local branch is deleted', async (t) => {
  const repo = await makeRepo({ withRemote: true })
  t.after(repo.cleanup)
  const { projectPath } = repo
  await git(projectPath, 'checkout', '-b', 'feature/login')
  await writeFile(projectPath, SPEC_A, '# login\n')
  await git(projectPath, 'add', '-A')
  await git(projectPath, 'commit', '-m', 'spec a')
  await git(projectPath, 'push', '-u', 'origin', 'feature/login')
  await git(projectPath, 'checkout', 'main')
  await git(projectPath, 'branch', '-D', 'feature/login')

  const specs = await readBranchSpecs(projectPath, 'feature/login', 'main')
  assert.deepEqual(specs.map((s) => s.path), [SPEC_A])
})

test('readBranchSpecs — recovers the spec as merged from the PR merge commit', async (t) => {
  const { projectPath } = await mergedAndDeleted(t)
  const specs = await readBranchSpecs(projectPath, 'feature/login', 'main')
  assert.deepEqual(specs.map((s) => s.path), [SPEC_A])
  assert.equal(specs[0].markdown.trim(), '# login, as merged')
})

test('readBranchSpecs — a merge from another branch or before the launch is not this task', async (t) => {
  const { projectPath } = await mergedAndDeleted(t, {
    subject: 'Merge pull request #12 from acme/feature/login-v2',
  })
  assert.deepEqual(await readBranchSpecs(projectPath, 'feature/login', 'main'), [])
  assert.deepEqual(await readBranchSpecs(projectPath, 'feature/login-v2', 'main', undefined, Date.now() + 3600_000), [])
  assert.equal((await readBranchSpecs(projectPath, 'feature/login-v2', 'main', undefined, Date.now() - 3600_000)).length, 1)
})
