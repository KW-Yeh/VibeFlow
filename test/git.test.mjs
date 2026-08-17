import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import {
  getGitInfo,
  assertBranchAvailable,
  ensureLocalExclude,
  provisionWorktree,
  removeWorktree,
  deleteBranch,
  syncBaseBranch,
  getWorktreeDiff,
  getWorktreeDiffEntries,
  getWorktreeDiffFile,
  commitAndPush,
  dropCoveredEntries,
} from '../main/helpers/git.ts'
import { PROGRESS_FILE } from '../main/helpers/progress.ts'
import { ATTACHMENTS_DIR } from '../main/helpers/attachments.ts'
import {
  makeRepo,
  git,
  writeFile,
  exists,
} from './support/repo.mjs'

async function provision(projectPath, taskId, baseBranch, preferredBranch, opts) {
  const workspacePath = path.join(path.dirname(projectPath), 'workspace')
  await fs.mkdir(workspacePath, { recursive: true })
  return provisionWorktree(
    projectPath,
    workspacePath,
    taskId,
    baseBranch,
    preferredBranch,
    opts
  )
}

/** Workspace dir the `provision` helper provisions into. */
function workspaceOf(projectPath) {
  return path.join(path.dirname(projectPath), 'workspace')
}

/** Publish `branch` on origin and drop it locally, leaving a remote-only branch. */
async function pushRemoteOnlyBranch(projectPath, branch, file) {
  await git(projectPath, 'checkout', '-b', branch)
  await writeFile(projectPath, file, 'from the remote branch')
  await git(projectPath, 'add', '-A')
  await git(projectPath, 'commit', '-m', `feat: ${branch}`)
  await git(projectPath, 'push', '-u', 'origin', branch)
  await git(projectPath, 'checkout', 'main')
  await git(projectPath, 'branch', '-D', branch)
  await git(projectPath, 'update-ref', '-d', `refs/remotes/origin/${branch}`)
}

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

// --- ensureLocalExclude ---

test('ensureLocalExclude — adds the progress file to .git/info/exclude (idempotent)', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: false })
  try {
    await ensureLocalExclude(projectPath)
    const excludePath = path.join(projectPath, '.git', 'info', 'exclude')
    let content = await fs.readFile(excludePath, 'utf8')
    assert.ok(content.includes(PROGRESS_FILE))
    assert.ok(content.includes(`${ATTACHMENTS_DIR}/`))

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
    const res = await provision(projectPath, 'abc12345', 'main', 'feature/my-test')
    assert.equal(res.branch, 'feature/my-test')
    assert.equal(
      res.worktreePath,
      path.join(path.dirname(projectPath), 'workspace', 'feature-my-test')
    )
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
    const res = await provision(projectPath, 'abc12345', 'main', 'feature/local-only')
    assert.equal(res.pushed, false)
    assert.ok(await exists(res.worktreePath))
  } finally {
    await cleanup()
  }
})

test('provisionWorktree — suffixes the task id when the branch is taken', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: true })
  try {
    await provision(projectPath, 'abc12345', 'main', 'feature/dup')
    const second = await provision(projectPath, 'def67890', 'main', 'feature/dup')
    assert.equal(second.branch, 'feature/dup-def67890')
    assert.equal(
      second.worktreePath,
      path.join(path.dirname(projectPath), 'workspace', 'feature-dup-def67890')
    )
  } finally {
    await cleanup()
  }
})

test('provisionWorktree — falls back to vf-<id> when no name is given', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: true })
  try {
    const res = await provision(projectPath, 'abc12345', 'main', null)
    assert.equal(res.branch, 'vf-abc12345')
  } finally {
    await cleanup()
  }
})

test('provisionWorktree — falls back to vf-<id> for an invalid ref name', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: true })
  try {
    const res = await provision(projectPath, 'abc12345', 'main', 'bad branch name')
    assert.equal(res.branch, 'vf-abc12345')
  } finally {
    await cleanup()
  }
})

test('provisionWorktree — base null resolves to the default base', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: true })
  try {
    const res = await provision(projectPath, 'abc12345', null, 'feature/auto-base')
    assert.equal(res.baseBranch, 'main')
  } finally {
    await cleanup()
  }
})

// --- removeWorktree + deleteBranch ---

test('removeWorktree + deleteBranch — tear down a provisioned worktree', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: true })
  try {
    const res = await provision(projectPath, 'abc12345', 'main', 'feature/teardown')
    assert.ok(await exists(res.worktreePath))

    await removeWorktree(projectPath, res.worktreePath)
    assert.equal(await exists(res.worktreePath), false)

    await deleteBranch(projectPath, res.branch)
    const locals = await git(projectPath, 'branch', '--format=%(refname:short)')
    assert.ok(!locals.split('\n').includes('feature/teardown'))
  } finally {
    await cleanup()
  }
})

test('removeWorktree — is a no-op for an unknown path', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: false })
  try {
    await removeWorktree(
      projectPath,
      path.join(path.dirname(projectPath), 'workspace', 'never-existed')
    )
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
    const res = await provision(projectPath, 'abc12345', 'main', 'feature/diff')
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
    const res = await provision(projectPath, 'abc12345', 'main', 'feature/committed')
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
    const res = await provision(projectPath, 'abc12345', 'main', 'feature/no-progress')
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
    const res = await provision(projectPath, 'abc12345', 'main', 'feature/big')
    const wt = res.worktreePath
    await writeFile(wt, 'big.txt', 'x'.repeat(1024 * 1024 + 1))

    const diff = await getWorktreeDiff(wt, 'main')
    const big = diff.find((d) => d.path === 'big.txt')
    assert.ok(big)
    assert.equal(big.truncated, true)
    assert.ok(big.newValue.endsWith('… (truncated)'))
  } finally {
    await cleanup()
  }
})

// --- getWorktreeDiffEntries / getWorktreeDiffFile ---

test('getWorktreeDiffEntries — lists changed files without any content', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: true })
  try {
    const res = await provision(projectPath, 'abc12345', 'main', 'feature/entries')
    const wt = res.worktreePath
    await writeFile(wt, 'added.txt', 'brand new\n')
    await writeFile(wt, 'README.md', '# sandbox\nline a\nline b\n')

    const entries = await getWorktreeDiffEntries(wt, 'main')
    const byPath = Object.fromEntries(entries.map((e) => [e.path, e]))

    assert.equal(byPath['added.txt'].status, '?')
    assert.equal(byPath['README.md'].status, 'M')
    // The entry shape must not carry file bodies — that is the whole point.
    for (const entry of entries) {
      assert.equal(entry.oldValue, undefined)
      assert.equal(entry.newValue, undefined)
    }
  } finally {
    await cleanup()
  }
})

test('getWorktreeDiffEntries — reports numstat line counts for tracked files', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: true })
  try {
    const res = await provision(projectPath, 'abc12345', 'main', 'feature/numstat')
    const wt = res.worktreePath
    // README.md starts as '# sandbox\n', so this is exactly two added lines.
    await writeFile(wt, 'README.md', '# sandbox\nline a\nline b\n')

    const entries = await getWorktreeDiffEntries(wt, 'main')
    const readme = entries.find((e) => e.path === 'README.md')
    assert.equal(readme.additions, 2)
    assert.equal(readme.deletions, 0)
  } finally {
    await cleanup()
  }
})

test('getWorktreeDiffEntries — untracked files report zero line counts', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: true })
  try {
    const res = await provision(projectPath, 'abc12345', 'main', 'feature/untracked-numstat')
    const wt = res.worktreePath
    await writeFile(wt, 'fresh.txt', 'a\nb\nc\n')

    const entries = await getWorktreeDiffEntries(wt, 'main')
    const fresh = entries.find((e) => e.path === 'fresh.txt')
    assert.equal(fresh.status, '?')
    assert.equal(fresh.additions, 0)
    assert.equal(fresh.deletions, 0)
    assert.notEqual(fresh.revision, '')
  } finally {
    await cleanup()
  }
})

test('getWorktreeDiffEntries — revision changes for same-line-count edits', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: true })
  try {
    const res = await provision(projectPath, 'abc12345', 'main', 'feature/revision')
    const wt = res.worktreePath
    const filePath = path.join(wt, 'README.md')
    await writeFile(wt, 'README.md', '# first\n')
    const before = (await getWorktreeDiffEntries(wt, 'main')).find(
      (entry) => entry.path === 'README.md'
    )

    await writeFile(wt, 'README.md', '# later\n')
    const future = new Date(Date.now() + 2_000)
    await fs.utimes(filePath, future, future)
    const after = (await getWorktreeDiffEntries(wt, 'main')).find(
      (entry) => entry.path === 'README.md'
    )

    assert.equal(before.additions, after.additions)
    assert.equal(before.deletions, after.deletions)
    assert.notEqual(before.revision, after.revision)
  } finally {
    await cleanup()
  }
})

test('getWorktreeDiffEntries — { fetch: false } works with no remote at all', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: false })
  try {
    const res = await provision(projectPath, 'abc12345', 'main', 'feature/no-fetch')
    const wt = res.worktreePath
    await writeFile(wt, 'local.txt', 'local only\n')

    const entries = await getWorktreeDiffEntries(wt, 'main', { fetch: false })
    assert.ok(entries.some((e) => e.path === 'local.txt'))
  } finally {
    await cleanup()
  }
})

test('getWorktreeDiffEntries — excludes the agent progress file', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: true })
  try {
    const res = await provision(projectPath, 'abc12345', 'main', 'feature/entries-hidden')
    const wt = res.worktreePath
    await writeFile(wt, PROGRESS_FILE, '{"summary":"x","steps":[]}')
    await writeFile(wt, 'real.txt', 'real\n')

    const entries = await getWorktreeDiffEntries(wt, 'main')
    assert.ok(!entries.some((e) => e.path === PROGRESS_FILE))
    assert.ok(entries.some((e) => e.path === 'real.txt'))
  } finally {
    await cleanup()
  }
})

test('getWorktreeDiffFile — returns the same body getWorktreeDiff would', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: true })
  try {
    const res = await provision(projectPath, 'abc12345', 'main', 'feature/single')
    const wt = res.worktreePath
    await writeFile(wt, 'README.md', '# changed\n')

    const single = await getWorktreeDiffFile(wt, 'main', 'README.md')
    const fromFull = (await getWorktreeDiff(wt, 'main')).find(
      (d) => d.path === 'README.md'
    )
    assert.deepEqual(single, fromFull)
  } finally {
    await cleanup()
  }
})

test('getWorktreeDiffFile — null for a path that is not part of the diff', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: true })
  try {
    const res = await provision(projectPath, 'abc12345', 'main', 'feature/not-in-diff')
    const wt = res.worktreePath
    await writeFile(wt, 'changed.txt', 'yes\n')

    // Unchanged tracked file, an absent path, and an escape attempt must all be
    // refused — the renderer can only read what the diff already lists.
    for (const p of ['README.md', 'nope.txt', '../../../etc/hosts']) {
      assert.equal(await getWorktreeDiffFile(wt, 'main', p), null, `must refuse ${p}`)
    }
  } finally {
    await cleanup()
  }
})

// --- commitAndPush ---

test('commitAndPush — stages, commits, and pushes the worktree branch', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: true })
  try {
    const res = await provision(projectPath, 'abc12345', 'main', 'feature/finalize')
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
      const res = await provision(
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
    const res = await provision(projectPath, 'abc12345', 'main', 'feature/clean')
    const fin = await commitAndPush(res.worktreePath, 'noop')
    assert.equal(fin.committed, false)
  } finally {
    await cleanup()
  }
})

// --- explicit (user-typed) branch names ---

test('assertBranchAvailable — accepts a free, well-formed name', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: true })
  try {
    const workspacePath = workspaceOf(projectPath)
    await fs.mkdir(workspacePath, { recursive: true })
    await assertBranchAvailable(projectPath, workspacePath, 'feature/typed-by-hand')
  } finally {
    await cleanup()
  }
})

test('assertBranchAvailable — rejects a malformed name and a local collision', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: true })
  try {
    const workspacePath = workspaceOf(projectPath)
    await fs.mkdir(workspacePath, { recursive: true })

    await assert.rejects(
      () => assertBranchAvailable(projectPath, workspacePath, 'bad branch name'),
      (err) => err.code === 'INVALID_BRANCH_NAME'
    )

    await git(projectPath, 'branch', 'feature/taken')
    await assert.rejects(
      () => assertBranchAvailable(projectPath, workspacePath, 'feature/taken'),
      (err) => err.code === 'BRANCH_ALREADY_EXISTS'
    )
  } finally {
    await cleanup()
  }
})

test('assertBranchAvailable — rejects a name whose worktree dir is occupied', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: true })
  try {
    const workspacePath = workspaceOf(projectPath)
    await fs.mkdir(path.join(workspacePath, 'feature-occupied'), { recursive: true })
    await assert.rejects(
      () => assertBranchAvailable(projectPath, workspacePath, 'feature/occupied'),
      (err) => err.code === 'WORKTREE_DIR_EXISTS'
    )
  } finally {
    await cleanup()
  }
})

test('assertBranchAvailable — a branch that exists only on origin is not a collision', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: true })
  try {
    const workspacePath = workspaceOf(projectPath)
    await fs.mkdir(workspacePath, { recursive: true })
    await pushRemoteOnlyBranch(projectPath, 'feature/published', 'remote-only.txt')

    // It is adopted rather than recreated, so provisioning must not be blocked.
    await assertBranchAvailable(projectPath, workspacePath, 'feature/published')
  } finally {
    await cleanup()
  }
})

test('provisionWorktree — an explicit name is used verbatim, never suffixed', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: false })
  try {
    await provision(projectPath, 'abc12345', 'main', 'feature/exact')
    // The auto path would suffix the second card; the explicit path must not.
    const second = await provision(projectPath, 'def67890', 'main', 'feature/exact-2', {
      explicitBranch: true,
    })
    assert.equal(second.branch, 'feature/exact-2')
  } finally {
    await cleanup()
  }
})

test('provisionWorktree — an explicit name matching an origin branch checks it out', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: true })
  try {
    await pushRemoteOnlyBranch(projectPath, 'feature/published', 'remote-only.txt')

    const res = await provision(projectPath, 'abc12345', 'main', 'feature/published', {
      explicitBranch: true,
    })

    assert.equal(res.branch, 'feature/published')
    assert.equal(res.pushed, true)
    // The remote branch's work is present — nothing was branched off main.
    assert.ok(await exists(path.join(res.worktreePath, 'remote-only.txt')))
    const head = await git(res.worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD')
    assert.equal(head, 'feature/published')
    const upstream = await git(
      res.worktreePath, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'
    )
    assert.equal(upstream, 'origin/feature/published')
  } finally {
    await cleanup()
  }
})

test('dropCoveredEntries — a directory entry absorbs the files inside it', () => {
  // What `git ls-files --others --ignored --exclude-standard --directory`
  // actually returns for a repo with an ignored `certificates/` folder.
  assert.deepEqual(
    dropCoveredEntries([
      '.next',
      'certificates',
      'certificates/localhost-key.pem',
      'certificates/localhost.pem',
      'next-env.d.ts',
      'node_modules',
    ]),
    ['.next', 'certificates', 'next-env.d.ts', 'node_modules']
  )
})

test('dropCoveredEntries — matches whole path segments, not string prefixes', () => {
  assert.deepEqual(
    dropCoveredEntries(['cert', 'certificates/localhost.pem']),
    ['cert', 'certificates/localhost.pem']
  )
})

test('dropCoveredEntries — drops a descendant nested several levels down', () => {
  assert.deepEqual(
    dropCoveredEntries(['a', 'a/b/c/d.txt', 'a2/b.txt']),
    ['a', 'a2/b.txt']
  )
})
