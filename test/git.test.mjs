import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import {
  getGitInfo,
  ensureGitignore,
  ensureLocalExclude,
  provisionWorktree,
  removeWorktree,
  deleteBranch,
  syncBaseBranch,
  getWorktreeDiff,
  commitAndPush,
} from '../main/helpers/git.ts'
import { PROGRESS_FILE } from '../main/helpers/progress.ts'
import {
  makeRepo,
  git,
  writeFile,
  readFileOrNull,
  exists,
} from './support/repo.mjs'

// --- getGitInfo ---

test('getGitInfo — empty path yields the empty info', async () => {
  const info = await getGitInfo('')
  assert.equal(info.isRepo, false)
  assert.equal(info.hasRemote, false)
})

test('getGitInfo — a non-repo directory is reported as not a repo', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-nonrepo-'))
  try {
    const info = await getGitInfo(dir)
    assert.equal(info.isRepo, false)
    assert.equal(info.defaultBase, null)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('getGitInfo — repo with a remote reports remote + branches', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: true })
  try {
    const info = await getGitInfo(projectPath)
    assert.equal(info.isRepo, true)
    assert.equal(info.hasRemote, true)
    assert.ok(info.remoteUrl && info.remoteUrl.length > 0)
    assert.equal(info.currentBranch, 'main')
    assert.ok(info.branches.includes('main'))
    assert.equal(info.defaultBase, 'main')
  } finally {
    await cleanup()
  }
})

test('getGitInfo — repo without a remote has no remote info', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: false })
  try {
    const info = await getGitInfo(projectPath)
    assert.equal(info.isRepo, true)
    assert.equal(info.hasRemote, false)
    assert.equal(info.remoteUrl, null)
    assert.equal(info.defaultBase, 'main')
  } finally {
    await cleanup()
  }
})

test('getGitInfo — defaultBase prefers main over the current branch', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: false })
  try {
    await git(projectPath, 'checkout', '-b', 'develop')
    const info = await getGitInfo(projectPath)
    assert.equal(info.currentBranch, 'develop')
    assert.equal(info.defaultBase, 'main', 'main is preferred even when not current')
  } finally {
    await cleanup()
  }
})

// --- ensureGitignore ---

test('ensureGitignore — adds .vibeflow/ and is idempotent', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: false })
  try {
    await ensureGitignore(projectPath)
    let content = await readFileOrNull(projectPath, '.gitignore')
    assert.ok(content.includes('.vibeflow/'))

    await ensureGitignore(projectPath)
    content = await readFileOrNull(projectPath, '.gitignore')
    const occurrences = content.split('.vibeflow/').length - 1
    assert.equal(occurrences, 1, 'must not duplicate the entry')
  } finally {
    await cleanup()
  }
})

test('ensureGitignore — preserves existing content', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: false })
  try {
    await writeFile(projectPath, '.gitignore', 'node_modules\n')
    await ensureGitignore(projectPath)
    const content = await readFileOrNull(projectPath, '.gitignore')
    assert.ok(content.includes('node_modules'))
    assert.ok(content.includes('.vibeflow/'))
  } finally {
    await cleanup()
  }
})

test('ensureGitignore — respects an existing .vibeflow (no slash) entry', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: false })
  try {
    await writeFile(projectPath, '.gitignore', '.vibeflow\n')
    await ensureGitignore(projectPath)
    const content = await readFileOrNull(projectPath, '.gitignore')
    assert.ok(!content.includes('.vibeflow/'), 'must not add a redundant slashed entry')
  } finally {
    await cleanup()
  }
})

// --- ensureLocalExclude ---

test('ensureLocalExclude — adds the progress file to .git/info/exclude (idempotent)', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: false })
  try {
    await ensureLocalExclude(projectPath)
    const excludePath = path.join(projectPath, '.git', 'info', 'exclude')
    let content = await fs.readFile(excludePath, 'utf8')
    assert.ok(content.includes(PROGRESS_FILE))

    await ensureLocalExclude(projectPath)
    content = await fs.readFile(excludePath, 'utf8')
    const occurrences = content.split(PROGRESS_FILE).length - 1
    assert.equal(occurrences, 1)
  } finally {
    await cleanup()
  }
})

// --- provisionWorktree ---

test('provisionWorktree — creates a flattened worktree and pushes', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: true })
  try {
    const res = await provisionWorktree(projectPath, 'abc12345', 'main', 'feature/my-test')
    assert.equal(res.branch, 'feature/my-test')
    assert.equal(res.relativePath, path.join('.vibeflow', 'feature-my-test'))
    assert.equal(res.baseBranch, 'main')
    assert.equal(res.pushed, true)
    assert.ok(await exists(res.worktreePath))
    // The branch exists on origin after the push.
    const remoteBranches = await git(projectPath, 'branch', '-r')
    assert.ok(remoteBranches.includes('origin/feature/my-test'))
  } finally {
    await cleanup()
  }
})

test('provisionWorktree — without a remote, still creates worktree (pushed=false)', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: false })
  try {
    const res = await provisionWorktree(projectPath, 'abc12345', 'main', 'feature/local-only')
    assert.equal(res.pushed, false)
    assert.ok(await exists(res.worktreePath))
  } finally {
    await cleanup()
  }
})

test('provisionWorktree — suffixes the task id when the branch is taken', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: true })
  try {
    await provisionWorktree(projectPath, 'abc12345', 'main', 'feature/dup')
    const second = await provisionWorktree(projectPath, 'def67890', 'main', 'feature/dup')
    assert.equal(second.branch, 'feature/dup-def67890')
    assert.equal(second.relativePath, path.join('.vibeflow', 'feature-dup-def67890'))
  } finally {
    await cleanup()
  }
})

test('provisionWorktree — falls back to vf-<id> when no name is given', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: true })
  try {
    const res = await provisionWorktree(projectPath, 'abc12345', 'main', null)
    assert.equal(res.branch, 'vf-abc12345')
  } finally {
    await cleanup()
  }
})

test('provisionWorktree — falls back to vf-<id> for an invalid ref name', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: true })
  try {
    const res = await provisionWorktree(projectPath, 'abc12345', 'main', 'bad branch name')
    assert.equal(res.branch, 'vf-abc12345')
  } finally {
    await cleanup()
  }
})

test('provisionWorktree — base null resolves to the default base', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: true })
  try {
    const res = await provisionWorktree(projectPath, 'abc12345', null, 'feature/auto-base')
    assert.equal(res.baseBranch, 'main')
  } finally {
    await cleanup()
  }
})

// --- removeWorktree + deleteBranch ---

test('removeWorktree + deleteBranch — tear down a provisioned worktree', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: true })
  try {
    const res = await provisionWorktree(projectPath, 'abc12345', 'main', 'feature/teardown')
    assert.ok(await exists(res.worktreePath))

    await removeWorktree(projectPath, res.branch)
    assert.equal(await exists(res.worktreePath), false)

    await deleteBranch(projectPath, res.branch)
    const locals = await git(projectPath, 'branch', '--format=%(refname:short)')
    assert.ok(!locals.split('\n').includes('feature/teardown'))
  } finally {
    await cleanup()
  }
})

test('removeWorktree — is a no-op for an unknown branch', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: false })
  try {
    await removeWorktree(projectPath, 'feature/never-existed') // must not throw
  } finally {
    await cleanup()
  }
})

// --- syncBaseBranch ---

test('syncBaseBranch — switches and fast-forwards with a remote', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: true })
  try {
    await git(projectPath, 'checkout', '-b', 'side')
    const res = await syncBaseBranch(projectPath, 'main')
    assert.equal(res.baseBranch, 'main')
    assert.equal(res.switched, true)
    assert.equal(res.pulled, true)
    assert.equal(await git(projectPath, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main')
  } finally {
    await cleanup()
  }
})

test('syncBaseBranch — without an upstream, pulled is false', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: false })
  try {
    await git(projectPath, 'checkout', '-b', 'side')
    const res = await syncBaseBranch(projectPath, 'main')
    assert.equal(res.switched, true)
    assert.equal(res.pulled, false)
  } finally {
    await cleanup()
  }
})

// --- getWorktreeDiff ---

test('getWorktreeDiff — reports untracked, modified, and deleted files', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: true })
  try {
    const res = await provisionWorktree(projectPath, 'abc12345', 'main', 'feature/diff')
    const wt = res.worktreePath

    await writeFile(wt, 'added.txt', 'brand new\n')
    await writeFile(wt, 'README.md', '# changed\n')

    const diff = await getWorktreeDiff(wt, 'main')
    const byPath = Object.fromEntries(diff.map((d) => [d.path, d]))

    assert.ok(byPath['added.txt'])
    assert.equal(byPath['added.txt'].status, '?')
    assert.equal(byPath['added.txt'].oldValue, '')
    assert.equal(byPath['added.txt'].newValue, 'brand new\n')

    assert.ok(byPath['README.md'])
    assert.equal(byPath['README.md'].status, 'M')
    // NOTE: oldValue is sourced from `git show` via the shared git() helper,
    // which trims stdout — so the trailing newline is gone. newValue comes from
    // a raw fs.readFile and keeps it. (See the trim-asymmetry note in the bug
    // report: an otherwise-unchanged trailing newline can render as a diff.)
    assert.equal(byPath['README.md'].oldValue, '# sandbox')
    assert.equal(byPath['README.md'].newValue, '# changed\n')
  } finally {
    await cleanup()
  }
})

test('getWorktreeDiff — includes committed changes vs the base', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: true })
  try {
    const res = await provisionWorktree(projectPath, 'abc12345', 'main', 'feature/committed')
    const wt = res.worktreePath
    await writeFile(wt, 'feature.txt', 'shipped\n')
    await git(wt, 'add', '-A')
    await git(wt, 'commit', '-m', 'add feature.txt')

    const diff = await getWorktreeDiff(wt, 'main')
    assert.ok(diff.some((d) => d.path === 'feature.txt' && d.status === 'A'))
  } finally {
    await cleanup()
  }
})

test('getWorktreeDiff — excludes the agent progress file', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: true })
  try {
    const res = await provisionWorktree(projectPath, 'abc12345', 'main', 'feature/no-progress')
    const wt = res.worktreePath
    await writeFile(wt, PROGRESS_FILE, '{"summary":"x","steps":[]}')
    await writeFile(wt, 'real.txt', 'real\n')

    const diff = await getWorktreeDiff(wt, 'main')
    assert.ok(!diff.some((d) => d.path === PROGRESS_FILE), 'progress file must be hidden')
    assert.ok(diff.some((d) => d.path === 'real.txt'))
  } finally {
    await cleanup()
  }
})

test('getWorktreeDiff — truncates oversized file content', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: true })
  try {
    const res = await provisionWorktree(projectPath, 'abc12345', 'main', 'feature/big')
    const wt = res.worktreePath
    await writeFile(wt, 'big.txt', 'x'.repeat(210 * 1024))

    const diff = await getWorktreeDiff(wt, 'main')
    const big = diff.find((d) => d.path === 'big.txt')
    assert.ok(big)
    assert.equal(big.truncated, true)
    assert.ok(big.newValue.endsWith('… (truncated)'))
  } finally {
    await cleanup()
  }
})

// --- commitAndPush ---

test('commitAndPush — stages, commits, and pushes the worktree branch', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: true })
  try {
    const res = await provisionWorktree(projectPath, 'abc12345', 'main', 'feature/finalize')
    const wt = res.worktreePath
    await writeFile(wt, 'shipit.txt', 'done\n')

    const fin = await commitAndPush(wt, 'feat: ship it')
    assert.equal(fin.committed, true)
    assert.equal(fin.pushed, true)

    const log = await git(wt, 'log', '-1', '--pretty=%s')
    assert.equal(log, 'feat: ship it')
  } finally {
    await cleanup()
  }
})

// REGRESSION — see test/BUG-REPORT.md #1 (fixed).
// commitAndPush used to run `git add -A -- . :(exclude).vibeflow-progress.json`.
// On git >= 2.x, when the excluded file is ALSO ignored (provisionWorktree adds
// it to .git/info/exclude) and present on disk — i.e. every real task finalize —
// git treated the :(exclude) pathspec as "explicitly naming an ignored path" and
// exited 1, so the un-try/caught `git add` threw and the whole finalize rejected.
// The fix drops the redundant pathspec — `.git/info/exclude` already hides the
// file from `git add -A`. This test now guards that behavior.
test(
  'commitAndPush — never commits the agent progress file',
  async () => {
    const { projectPath, cleanup } = await makeRepo({ withRemote: true })
    try {
      const res = await provisionWorktree(
        projectPath,
        'abc12345',
        'main',
        'feature/exclude-progress'
      )
      const wt = res.worktreePath
      await writeFile(wt, PROGRESS_FILE, '{"summary":"x","steps":[]}')
      await writeFile(wt, 'tracked.txt', 'keep me\n')

      const fin = await commitAndPush(wt, 'feat: add tracked file')
      assert.equal(fin.committed, true)
      const committed = (await git(wt, 'ls-tree', '-r', '--name-only', 'HEAD')).split('\n')
      assert.ok(committed.includes('tracked.txt'))
      assert.ok(!committed.includes(PROGRESS_FILE), 'progress file must stay uncommitted')
    } finally {
      await cleanup()
    }
  }
)

test('commitAndPush — clean tree commits nothing', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: true })
  try {
    const res = await provisionWorktree(projectPath, 'abc12345', 'main', 'feature/clean')
    const fin = await commitAndPush(res.worktreePath, 'noop')
    assert.equal(fin.committed, false)
  } finally {
    await cleanup()
  }
})
