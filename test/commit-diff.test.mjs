import test from 'node:test'
import assert from 'node:assert/strict'
import {
  WORKING_CHANGES,
  getBranchCommits,
  getCommitEntries,
  getCommitFile,
  getDoneCommitDiff,
  getDoneCommitFile,
  isCommitSha,
  parseGithubCommitFiles,
  parsePrUrl,
} from '../packages/core/src/commit-diff.ts'
import { makeRepo, git, writeFile } from './support/repo.mjs'

/** A feature branch with two commits, one uncommitted edit and one untracked file. */
async function featureRepo(t) {
  const repo = await makeRepo()
  t.after(repo.cleanup)
  const cwd = repo.projectPath
  await git(cwd, 'checkout', '-b', 'feature')
  await writeFile(cwd, 'a.txt', 'one\n')
  await git(cwd, 'add', '-A')
  await git(cwd, 'commit', '-m', 'add a')
  const c1 = await git(cwd, 'rev-parse', 'HEAD')
  await writeFile(cwd, 'a.txt', 'one\ntwo\n')
  await writeFile(cwd, 'b.txt', 'bee\n')
  await git(cwd, 'add', '-A')
  await git(cwd, 'commit', '-m', 'grow a, add b')
  const c2 = await git(cwd, 'rev-parse', 'HEAD')
  await writeFile(cwd, 'b.txt', 'bee\nbuzz\n')
  await writeFile(cwd, 'c.txt', 'sea\n')
  return { ...repo, cwd, c1, c2 }
}

test('isCommitSha accepts hex ids only', () => {
  assert.equal(isCommitSha('a91c3e2'), true)
  assert.equal(isCommitSha('A91C3E2'), true)
  assert.equal(isCommitSha('abc'), false)
  assert.equal(isCommitSha('HEAD'), false)
  assert.equal(isCommitSha('main..HEAD'), false)
  assert.equal(isCommitSha('--output=x'), false)
  assert.equal(isCommitSha(42), false)
})

test('parsePrUrl reads github.com PR urls only', () => {
  assert.deepEqual(parsePrUrl('https://github.com/acme/app/pull/12'), { repo: 'acme/app', number: 12 })
  assert.deepEqual(parsePrUrl('https://github.com/acme/app/pull/12/files'), { repo: 'acme/app', number: 12 })
  assert.equal(parsePrUrl('https://example.com/acme/app/pull/12'), null)
  assert.equal(parsePrUrl('https://github.com/acme/app/issues/12'), null)
  assert.equal(parsePrUrl('https://github.com/../app/pull/1'), null)
})

test('getBranchCommits lists the branch newest first, with uncommitted changes apart', async (t) => {
  const { cwd, c1, c2 } = await featureRepo(t)
  const { commits, working, truncated } = await getBranchCommits(cwd, 'main')
  assert.equal(truncated, false)
  assert.deepEqual(commits.map((c) => c.sha), [c2, c1])
  assert.deepEqual(
    commits.map((c) => [c.subject, c.fileCount, c.additions, c.deletions, c.isMerge]),
    [
      ['grow a, add b', 2, 2, 0, false],
      ['add a', 1, 1, 0, false],
    ]
  )
  assert.equal(commits[0].shortSha, c2.slice(0, commits[0].shortSha.length))
  assert.ok(commits[0].authoredAt > 0)
  assert.deepEqual(working, { fileCount: 2, additions: 1, deletions: 0 })
})

test('getBranchCommits reports no working changes on a clean tree', async (t) => {
  const { cwd } = await featureRepo(t)
  await git(cwd, 'add', '-A')
  await git(cwd, 'commit', '-m', 'rest')
  assert.equal((await getBranchCommits(cwd, 'main')).working, null)
})

test('getCommitEntries returns one commit\'s files, or the uncommitted ones', async (t) => {
  const { cwd, c1, c2 } = await featureRepo(t)
  const first = await getCommitEntries(cwd, 'main', c1.slice(0, 7))
  assert.deepEqual(first.map((e) => [e.path, e.status, e.additions]), [['a.txt', 'A', 1]])
  const second = await getCommitEntries(cwd, 'main', c2)
  assert.deepEqual(
    second.map((e) => [e.path, e.status]).sort(),
    [['a.txt', 'M'], ['b.txt', 'A']]
  )
  const working = await getCommitEntries(cwd, 'main', WORKING_CHANGES)
  assert.deepEqual(
    working.map((e) => [e.path, e.status]).sort(),
    [['b.txt', 'M'], ['c.txt', '?']]
  )
})

test('getCommitEntries refuses commits outside base..HEAD', async (t) => {
  const { cwd } = await featureRepo(t)
  const init = await git(cwd, 'rev-parse', 'main')
  assert.equal(await getCommitEntries(cwd, 'main', init), null)
  assert.equal(await getCommitEntries(cwd, 'main', 'deadbeef'), null)
})

test('getCommitFile reads a commit against its first parent, and the working tree', async (t) => {
  const { cwd, c2 } = await featureRepo(t)
  // `git show` output is trimmed, like the existing base-side reads.
  const file = await getCommitFile(cwd, 'main', c2, 'a.txt')
  assert.equal(file.oldValue, 'one')
  assert.equal(file.newValue, 'one\ntwo')
  const added = await getCommitFile(cwd, 'main', c2, 'b.txt')
  assert.equal(added.oldValue, '')
  assert.equal(added.newValue, 'bee')
  const live = await getCommitFile(cwd, 'main', WORKING_CHANGES, 'b.txt')
  assert.equal(live.oldValue, 'bee')
  assert.equal(live.newValue, 'bee\nbuzz\n')
  assert.equal(await getCommitFile(cwd, 'main', c2, 'README.md'), null)
})

test('a merge of the base into the branch is listed and counted against its first parent', async (t) => {
  const { cwd, root } = await featureRepo(t)
  await git(cwd, 'add', '-A')
  await git(cwd, 'commit', '-m', 'rest')
  // Someone else lands a change on main.
  await git(root, 'clone', `${root}/remote.git`, `${root}/other`)
  const other = `${root}/other`
  await git(other, 'config', 'user.email', 'qa@vibeflow.test')
  await git(other, 'config', 'user.name', 'VibeFlow QA')
  await writeFile(other, 'upstream.txt', 'u1\nu2\n')
  await git(other, 'add', '-A')
  await git(other, 'commit', '-m', 'upstream')
  await git(other, 'push', 'origin', 'main')
  await git(cwd, 'fetch', 'origin')
  await git(cwd, 'merge', '--no-ff', '-m', 'merge main', 'origin/main')

  const { commits } = await getBranchCommits(cwd, 'main')
  assert.equal(commits[0].subject, 'merge main')
  assert.equal(commits[0].isMerge, true)
  assert.equal(commits[0].fileCount, 1)
  assert.equal(commits[0].additions, 2)
  const entries = await getCommitEntries(cwd, 'main', commits[0].sha)
  assert.deepEqual(entries.map((e) => e.path), ['upstream.txt'])
})

/** Land the feature branch on origin/main the given way, then drop the branch like completion does. */
async function landFeature(repo, how) {
  const { cwd } = repo
  await git(cwd, 'add', '-A')
  await git(cwd, 'commit', '-m', 'rest')
  await git(cwd, 'checkout', 'main')
  if (how === 'merge') await git(cwd, 'merge', '--no-ff', '-m', 'Merge feature', 'feature')
  else {
    await git(cwd, 'merge', '--squash', 'feature')
    await git(cwd, 'commit', '-m', 'Squashed feature')
  }
  await git(cwd, 'push', 'origin', 'main')
  await git(cwd, 'branch', '-D', 'feature')
  // gc would drop the now-unreachable commits; prune so the test does not
  // depend on them lingering in the object store.
  await git(cwd, 'reflog', 'expire', '--expire=now', '--all')
  await git(cwd, 'gc', '--prune=now', '--quiet')
}

test('a done card whose branch was merged reads the commit from the base', async (t) => {
  const repo = await featureRepo(t)
  await landFeature(repo, 'merge')
  const short = repo.c2.slice(0, 7)
  const diff = await getDoneCommitDiff({ projectPath: repo.cwd, baseBranch: 'main', sha: short })
  assert.equal(diff.source, 'git')
  assert.equal(diff.sha, repo.c2)
  assert.deepEqual(diff.files.map((f) => f.path).sort(), ['a.txt', 'b.txt'])
  const file = await getDoneCommitFile(repo.cwd, 'main', short, 'a.txt')
  assert.equal(file.newValue, 'one\ntwo')
})

test('a done card without a PR whose commit the base lacks gets a reason', async (t) => {
  const repo = await featureRepo(t)
  await landFeature(repo, 'squash')
  const diff = await getDoneCommitDiff({ projectPath: repo.cwd, baseBranch: 'main', sha: repo.c2.slice(0, 7) })
  assert.equal(diff.source, 'none')
  assert.match(diff.reason, /沒有 PR/)
  assert.equal(await getDoneCommitFile(repo.cwd, 'main', repo.c2.slice(0, 7), 'a.txt'), null)
})

test('a squash-merged done card falls back to the PR through gh', async (t) => {
  const repo = await featureRepo(t)
  await landFeature(repo, 'squash')
  const calls = []
  const runGh = async (args) => {
    calls.push(args)
    if (args[1].endsWith('/commits?per_page=100')) return `${repo.c1}\n${repo.c2}\n`
    return JSON.stringify({
      files: [
        { filename: 'a.txt', status: 'modified', additions: 1, deletions: 0, patch: '@@ -1 +1,2 @@\n one\n+two' },
        { filename: 'logo.png', status: 'added', additions: 0, deletions: 0 },
        { filename: '.vibeflow-events/x.json', status: 'added', additions: 1, deletions: 0, patch: '+{}' },
      ],
    })
  }
  const diff = await getDoneCommitDiff({
    projectPath: repo.cwd,
    baseBranch: 'main',
    sha: repo.c2.slice(0, 7),
    prUrl: 'https://github.com/acme/app/pull/7',
    runGh,
  })
  assert.equal(diff.source, 'github')
  assert.equal(diff.sha, repo.c2)
  assert.deepEqual(diff.files.map((f) => [f.path, f.status, f.patch !== undefined]), [
    ['a.txt', 'M', true],
    ['logo.png', 'A', false],
  ])
  assert.deepEqual(calls[0].slice(0, 2), ['api', 'repos/acme/app/pulls/7/commits?per_page=100'])
  assert.deepEqual(calls[1], ['api', `repos/acme/app/commits/${repo.c2}`])
})

test('gh fallback reports a commit the PR does not have, an ambiguous one, and gh failures', async (t) => {
  const base = { baseBranch: 'main', prUrl: 'https://github.com/acme/app/pull/7' }
  const missing = await getDoneCommitDiff({ ...base, sha: 'abcdef1', runGh: async () => 'deadbeef00\n' })
  assert.equal(missing.source, 'none')
  assert.match(missing.reason, /PR #7 的 commit 中也沒有它/)

  const ambiguous = await getDoneCommitDiff({
    ...base,
    sha: 'abcd',
    runGh: async () => 'abcd0000\nabcd1111\n',
  })
  assert.equal(ambiguous.source, 'none')
  assert.match(ambiguous.reason, /多個 commit/)

  const noGh = await getDoneCommitDiff({
    ...base,
    sha: 'abcdef1',
    runGh: async () => {
      throw Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' })
    },
  })
  assert.equal(noGh.source, 'none')
  assert.match(noGh.reason, /找不到 gh 指令/)
})

test('parseGithubCommitFiles maps statuses and caps the file count', () => {
  const files = Array.from({ length: 85 }, (_, i) => ({ filename: `f${i}`, status: 'removed', additions: 0, deletions: 1, patch: '-x' }))
  const parsed = parseGithubCommitFiles(JSON.stringify({ files }))
  assert.equal(parsed.files.length, 80)
  assert.equal(parsed.truncated, true)
  assert.equal(parsed.files[0].status, 'D')
})
