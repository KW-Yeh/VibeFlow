import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createGithubService,
  findRelatedRepos,
  fetchPrIndex,
  fetchRepoItems,
  GITHUB_CACHE_TTL_MS,
  isGithubRef,
  mergeItems,
  parseGithubRepo,
  resolveTaskLinks,
} from '../packages/core/src/github.ts'

const issue = (number, extra = {}) => ({
  number,
  title: `Issue ${number}`,
  url: `https://github.com/acme/demo/issues/${number}`,
  body: 'body',
  author: { login: 'me', name: '' },
  assignees: [{ login: 'me', name: 'Me' }],
  labels: [{ name: 'bug', color: 'd73a4a', id: 'x' }],
  milestone: { title: 'v1' },
  createdAt: `2026-10-0${number % 9}T00:00:00Z`,
  issueType: { name: 'Bug', color: 'RED' },
  ...extra,
})

const pr = (number, extra = {}) => ({
  number,
  title: `PR ${number}`,
  url: `https://github.com/acme/demo/pull/${number}`,
  body: '',
  author: { login: 'me' },
  assignees: [],
  labels: [],
  milestone: null,
  createdAt: `2026-10-0${number % 9}T00:00:00Z`,
  state: 'OPEN',
  isDraft: false,
  reviewDecision: '',
  headRefName: `feat/${number}`,
  baseRefName: 'main',
  ...extra,
})

/** A `gh` stand-in: answers by the filter flag in the args, records every call. */
function fakeGh(answers) {
  const calls = []
  const run = async (args) => {
    calls.push(args)
    for (const [match, answer] of answers) {
      if (match(args)) {
        if (answer instanceof Error) throw answer
        return JSON.stringify(typeof answer === 'function' ? answer(args) : answer)
      }
    }
    return '[]'
  }
  return { run, calls }
}

const has = (...parts) => (args) => parts.every((p) => args.includes(p))

test('parseGithubRepo reads ssh, https and ssh:// remotes and rejects the rest', () => {
  assert.equal(parseGithubRepo('git@github.com:KW-Yeh/VibeFlow.git'), 'KW-Yeh/VibeFlow')
  assert.equal(parseGithubRepo('https://github.com/KW-Yeh/VibeFlow.git'), 'KW-Yeh/VibeFlow')
  assert.equal(parseGithubRepo('https://github.com/KW-Yeh/VibeFlow'), 'KW-Yeh/VibeFlow')
  assert.equal(parseGithubRepo('https://token@github.com/a/b.git'), 'a/b')
  assert.equal(parseGithubRepo('ssh://git@github.com/a/b.git'), 'a/b')
  assert.equal(parseGithubRepo('https://gitlab.com/a/b.git'), null)
  assert.equal(parseGithubRepo('/tmp/remote.git'), null)
  assert.equal(parseGithubRepo(null), null)
})

test('isGithubRef accepts only issue/pr refs that point into their own repo', () => {
  const ok = { kind: 'issue', repo: 'acme/demo', number: 3, url: 'https://github.com/acme/demo/issues/3' }
  assert.equal(isGithubRef(ok), true)
  assert.equal(isGithubRef({ ...ok, kind: 'discussion' }), false)
  assert.equal(isGithubRef({ ...ok, number: 0 }), false)
  assert.equal(isGithubRef({ ...ok, number: 1.5 }), false)
  assert.equal(isGithubRef({ ...ok, url: 'https://evil.example/acme/demo/issues/3' }), false)
  assert.equal(isGithubRef({ ...ok, url: 'https://github.com/other/repo/issues/3' }), false)
  assert.equal(isGithubRef({ ...ok, repo: '../x' }), false)
  assert.equal(isGithubRef({ ...ok, repo: 'acme/..' }), false)
})

test('mergeItems keeps one entry per number, newest first', () => {
  const merged = mergeItems([
    [{ number: 1, createdAt: '2026-10-01' }, { number: 2, createdAt: '2026-10-03' }],
    [{ number: 2, createdAt: '2026-10-03' }, { number: 3, createdAt: '2026-10-02' }],
  ])
  assert.deepEqual(merged.map((i) => i.number), [2, 3, 1])
})

test('fetchRepoItems asks for assigned + authored issues and assigned + authored + review-requested + reviewed PRs, and normalises them', async () => {
  const { run, calls } = fakeGh([
    [has('issue', '--assignee'), [issue(1), issue(2)]],
    [has('issue', '--author'), [issue(2), issue(3)]],
    [has('pr', '--assignee'), [pr(10)]],
    [has('pr', '--author'), [pr(11, { isDraft: true })]],
    [has('pr', 'review-requested:@me'), [pr(10), pr(12, { reviewDecision: 'REVIEW_REQUIRED' })]],
    // Approved by me: the review request is gone, but the PR is still open.
    [has('pr', 'reviewed-by:@me'), [pr(12), pr(13, { reviewDecision: 'APPROVED' })]],
  ])
  const { issues, prs } = await fetchRepoItems(run, 'acme/demo')
  assert.equal(calls.length, 6)
  assert.ok(calls.every((c) => c.includes('-R') && c.includes('acme/demo') && c.includes('open')))
  assert.deepEqual(issues.map((i) => i.number).sort(), [1, 2, 3])
  assert.deepEqual(prs.map((p) => p.number).sort(), [10, 11, 12, 13])

  const one = issues.find((i) => i.number === 1)
  assert.deepEqual(one, {
    repo: 'acme/demo',
    number: 1,
    title: 'Issue 1',
    url: 'https://github.com/acme/demo/issues/1',
    body: 'body',
    author: { login: 'me' },
    assignees: [{ login: 'me', name: 'Me' }],
    labels: [{ name: 'bug', color: 'd73a4a' }],
    milestone: 'v1',
    createdAt: '2026-10-01T00:00:00Z',
    kind: 'issue',
    issueType: { name: 'Bug', color: 'RED' },
  })
  assert.equal(prs.find((p) => p.number === 11).state, 'draft')
  assert.equal(prs.find((p) => p.number === 12).reviewDecision, 'REVIEW_REQUIRED')
  assert.equal(prs.find((p) => p.number === 10).reviewDecision, null)
  assert.equal(prs.find((p) => p.number === 13).reviewDecision, 'APPROVED')
})

test('global search discovers relevant repositories without board projects', async () => {
  const { run, calls } = fakeGh([
    [has('search', 'issues', '--assignee'), [
      { repository: { nameWithOwner: 'acme/demo' } },
      { repository: { nameWithOwner: 'other/repo' } },
      { repository: { nameWithOwner: '../invalid' } },
    ]],
    [has('search', 'prs', '--reviewed-by'), [{ repository: { nameWithOwner: 'other/repo' } }]],
  ])
  assert.deepEqual(await findRelatedRepos(run), ['acme/demo', 'other/repo'])
  assert.equal(calls.length, 6)
  assert.ok(calls.every((args) => args.includes('--state') && args.includes('open') && args.includes('--limit')))
})

test('an older gh without issueType still lists issues, just without the type', async () => {
  const { run, calls } = fakeGh([
    [(a) => a.includes('issue') && a.at(-1).includes('issueType'), new Error('Unknown JSON field: "issueType"')],
    [has('issue'), [issue(1, { issueType: undefined })]],
  ])
  const { issues } = await fetchRepoItems(run, 'acme/demo')
  assert.equal(issues.length, 1)
  assert.equal(issues[0].issueType, null)
  assert.ok(calls.some((c) => c.includes('issue') && !c.at(-1).includes('issueType')))
})

test('any other gh failure is not swallowed', async () => {
  const { run } = fakeGh([[has('issue'), new Error('HTTP 404: Not Found')]])
  await assert.rejects(fetchRepoItems(run, 'acme/demo'), /404/)
})

test('fetchPrIndex keeps only closing issues of the same repo', async () => {
  const { run } = fakeGh([
    [has('pr', 'all'), [{
      number: 7,
      url: 'https://github.com/acme/demo/pull/7',
      state: 'MERGED',
      isDraft: false,
      headRefName: 'fix/x',
      closingIssuesReferences: [
        { number: 3, url: 'https://github.com/acme/demo/issues/3', repository: { name: 'demo', owner: { login: 'acme' } } },
        { number: 9, url: 'https://github.com/other/lib/issues/9', repository: { name: 'lib', owner: { login: 'other' } } },
      ],
    }]],
  ])
  const [entry] = await fetchPrIndex(run, 'acme/demo')
  assert.deepEqual(entry, {
    number: 7,
    url: 'https://github.com/acme/demo/pull/7',
    state: 'merged',
    headRefName: 'fix/x',
    closingIssues: [{ number: 3, url: 'https://github.com/acme/demo/issues/3' }],
  })
})

const task = (id, extra = {}) => ({
  id,
  title: id,
  branch: `vf-${id}`,
  projectPath: '/p/demo',
  provisionedAt: 1,
  ...extra,
})

test('resolveTaskLinks: source ref, PR by branch with its closing issue, outcome fallback', () => {
  const repoOf = new Map([['/p/demo', 'acme/demo']])
  const index = new Map([['acme/demo', [
    { number: 5, url: 'u5', state: 'open', headRefName: 'vf-a', closingIssues: [{ number: 2, url: 'i2' }] },
    { number: 8, url: 'u8', state: 'merged', headRefName: 'vf-a', closingIssues: [{ number: 4, url: 'i4' }] },
    { number: 6, url: 'u6', state: 'draft', headRefName: 'feat/pr', closingIssues: [] },
  ]]])
  const links = resolveTaskLinks([
    task('a'),
    task('b', { github: { kind: 'issue', repo: 'acme/demo', number: 12, url: 'https://github.com/acme/demo/issues/12' } }),
    task('c', { branch: 'feat/pr', github: { kind: 'pr', repo: 'acme/demo', number: 6, url: 'https://github.com/acme/demo/pull/6' } }),
    task('d', { branch: 'gone', outcome: { commits: [], files: [], additions: 0, deletions: 0, capturedAt: 1, pr: { number: 3, state: 'MERGED', url: 'u3', title: 't' } } }),
    task('e', { branch: 'vf-a', provisionedAt: undefined }),
    task('f', { projectPath: '/p/elsewhere' }),
  ], repoOf, index)

  // Newest PR on the branch wins; its merge closes the issue it references.
  assert.deepEqual(links.a, {
    issue: { kind: 'issue', number: 4, url: 'i4', state: 'closed' },
    pr: { kind: 'pr', number: 8, url: 'u8', state: 'merged' },
  })
  assert.deepEqual(links.b, {
    issue: { kind: 'issue', number: 12, url: 'https://github.com/acme/demo/issues/12', state: 'open' },
  })
  assert.deepEqual(links.c, {
    pr: { kind: 'pr', number: 6, url: 'https://github.com/acme/demo/pull/6', state: 'draft' },
  })
  assert.deepEqual(links.d, { pr: { kind: 'pr', number: 3, url: 'u3', state: 'merged' } })
  // An unstarted card only has a branch name, which may belong to someone else's PR.
  assert.equal(links.e, undefined)
  assert.equal(links.f, undefined)
})

function board(tasks) {
  return { backlog: tasks, in_progress: [], done: [] }
}

const authed = async () => ({ installed: true, authenticated: true, login: 'me' })

test('inbox reports a missing or signed-out gh without calling it', async () => {
  const { run, calls } = fakeGh([])
  const repoOf = async () => 'acme/demo'
  const missing = createGithubService({ run, repoOf, authStatus: async () => ({ installed: false, authenticated: false }) })
  assert.equal((await missing.inbox(board([task('a')]))).status, 'gh-missing')
  const signedOut = createGithubService({ run, repoOf, authStatus: async () => ({ installed: true, authenticated: false }) })
  assert.equal((await signedOut.inbox(board([task('a')]))).status, 'unauthenticated')
  assert.equal(calls.length, 0)
})

test('inbox lists relevant repos when the board has no projects', async () => {
  const { run } = fakeGh([
    [has('search', 'issues', '--assignee'), [{ repository: { nameWithOwner: 'acme/demo' } }]],
    [has('issue', 'acme/demo', '--assignee'), [issue(7)]],
  ])
  const svc = createGithubService({ run, authStatus: authed, repoOf: async () => null })
  const result = await svc.inbox(board([]))
  assert.equal(result.status, 'ok')
  assert.deepEqual(result.repos.map((repo) => [repo.repo, repo.projectPath, repo.issues.map((item) => item.number)]), [
    ['acme/demo', null, [7]],
  ])
})

test('inbox: one entry per repo, mapped to its most recent project; failures stay per repo; non-GitHub projects skipped', async () => {
  const { run } = fakeGh([
    [has('search', 'issues', '--assignee'), [
      { repository: { nameWithOwner: 'acme/demo' } },
      { repository: { nameWithOwner: 'broken/repo' } },
      { repository: { nameWithOwner: 'external/repo' } },
    ]],
    [has('broken/repo'), new Error('HTTP 403: rate limited')],
    [has('issue', 'acme/demo', '--assignee'), [issue(1)]],
  ])
  const repos = { '/p/demo': 'acme/demo', '/p/demo-copy': 'acme/demo', '/p/broken': 'broken/repo', '/p/local': null }
  const svc = createGithubService({ run, authStatus: authed, repoOf: async (p) => repos[p] })
  const result = await svc.inbox(board([
    task('a', { projectPath: '/p/demo', createdAt: 1 }),
    task('b', { projectPath: '/p/demo-copy', createdAt: 5 }),
    task('c', { projectPath: '/p/broken', createdAt: 2 }),
    task('d', { projectPath: '/p/local', createdAt: 3 }),
  ]))
  assert.equal(result.status, 'ok')
  assert.equal(result.login, 'me')
  assert.deepEqual(result.repos.map((r) => [r.repo, r.projectPath, r.projectName]), [
    ['acme/demo', '/p/demo-copy', 'demo-copy'],
    ['broken/repo', '/p/broken', 'broken'],
    ['external/repo', null, 'external/repo'],
  ])
  assert.deepEqual(result.repos[0].issues.map((i) => i.number), [1])
  assert.match(result.repos[1].error, /rate limited/)
  assert.deepEqual(result.repos[1].issues, [])
})

test('inbox and taskLinks are cached per repo until the TTL or a forced refresh', async () => {
  let clock = 1000
  const { run, calls } = fakeGh([
    [has('search', 'issues', '--assignee'), [{ repository: { nameWithOwner: 'acme/demo' } }]],
  ])
  const svc = createGithubService({ run, authStatus: authed, repoOf: async () => 'acme/demo', now: () => clock })
  const b = board([task('a')])

  const first = await svc.inbox(b)
  assert.equal(first.fetchedAt, 1000)
  await svc.inbox(b)
  assert.equal(calls.length, 12)

  clock += 1000
  const forced = await svc.inbox(b, { force: true })
  assert.equal(calls.length, 24)
  assert.equal(forced.fetchedAt, 2000)

  clock += GITHUB_CACHE_TTL_MS
  await svc.inbox(b)
  assert.equal(calls.length, 36)

  await svc.taskLinks(b)
  await svc.taskLinks(b)
  assert.equal(calls.length, 37)
})
