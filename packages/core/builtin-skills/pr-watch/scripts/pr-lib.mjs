// Shared by the address-review and pr-watch skills; each ships an identical
// copy because a skill directory must stand on its own. Keep both copies equal
// (test/builtin-pr-skills.test.mjs fails otherwise).
import { execFileSync } from 'node:child_process'

/** Appended to every reply address-review posts; marks what came before it as handled. */
export const HANDLED_MARKER = '<!-- vibeflow:address-review -->'

/** `gh` argv prefix; VIBEFLOW_GH_CMD (a JSON array) replaces it in tests. */
function ghCommand() {
  const raw = process.env.VIBEFLOW_GH_CMD
  if (!raw) return ['gh']
  const parsed = JSON.parse(raw)
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('VIBEFLOW_GH_CMD must be a JSON array')
  return parsed.map(String)
}

export function gh(args, input) {
  const [cmd, ...prefix] = ghCommand()
  return execFileSync(cmd, [...prefix, ...args], {
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  })
}

export function ghJson(args, input) {
  return JSON.parse(gh(args, input))
}

/** `owner/name` of the repository in the current directory. */
export function repoNwo() {
  return gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']).trim()
}

/** `36`, `#36`, or nothing (the current branch's PR). */
export function resolvePrNumber(arg) {
  if (arg && /^#?\d+$/.test(arg)) return Number(arg.replace('#', ''))
  if (arg) throw new Error(`not a PR number: ${arg}`)
  return Number(gh(['pr', 'view', '--json', 'number', '-q', '.number']).trim())
}

const PR_QUERY = `query($owner:String!,$repo:String!,$number:Int!){
  viewer{login}
  repository(owner:$owner,name:$repo){
    pullRequest(number:$number){
      number title state merged headRefName headRefOid baseRefName
      mergeable mergeStateStatus
      isCrossRepository
      reviews(last:50){nodes{databaseId author{login} state body createdAt}}
      comments(last:100){nodes{databaseId author{login} body createdAt}}
      reviewThreads(last:100){nodes{
        isResolved
        comments(last:50){nodes{databaseId author{login} body path line diffHunk createdAt}}
      }}
      commits(last:1){nodes{commit{oid statusCheckRollup{contexts(first:100){nodes{
        __typename
        ... on CheckRun{name status conclusion detailsUrl}
        ... on StatusContext{context state targetUrl}
      }}}}}}
    }
  }
}`

const COMPARE_QUERY = `query($owner:String!,$repo:String!,$base:String!,$head:String!){
  repository(owner:$owner,name:$repo){
    ref(qualifiedName:$base){ target{oid} compare(headRef:$head){ behindBy } }
  }
}`

/** One GraphQL call: the PR with its reviews, conversation and review threads. */
export function fetchPr(nwo, number) {
  const [owner, repo] = nwo.split('/')
  const data = ghJson([
    'api', 'graphql',
    '-f', `query=${PR_QUERY}`,
    '-F', `owner=${owner}`, '-F', `repo=${repo}`, '-F', `number=${number}`,
  ])
  const pr = data?.data?.repository?.pullRequest
  if (!pr) throw new Error(`PR #${number} not found in ${nwo}`)
  return { ...pr, viewerLogin: data.data.viewer?.login ?? null }
}

/**
 * Where the base branch is and how many of its commits the PR head lacks.
 * Null for a PR from a fork, whose head branch this repository cannot name.
 */
export function fetchBaseStatus(nwo, pr) {
  if (pr.isCrossRepository) return null
  const [owner, repo] = nwo.split('/')
  const data = ghJson([
    'api', 'graphql',
    '-f', `query=${COMPARE_QUERY}`,
    '-F', `owner=${owner}`, '-F', `repo=${repo}`,
    '-f', `base=refs/heads/${pr.baseRefName}`, '-f', `head=refs/heads/${pr.headRefName}`,
  ])
  const ref = data?.data?.repository?.ref
  if (!ref?.target?.oid || !ref.compare) return null
  return { oid: ref.target.oid, behindBy: ref.compare.behindBy }
}

const nodes = (conn) => conn?.nodes ?? []
const isMarked = (c) => (c.body ?? '').includes(HANDLED_MARKER)
const login = (c) => c.author?.login ?? 'ghost'

/**
 * The review items nobody has answered yet. An inline comment counts as
 * answered once a marked reply follows it in its thread; a review summary or
 * conversation comment once any marked reply was posted after it, since every
 * address-review round answers everything pending at once. Resolved threads,
 * empty bodies and the marked replies themselves never count.
 */
export function pendingItems(pr) {
  const items = []
  let lastMarked = ''
  for (const c of nodes(pr.comments)) if (isMarked(c) && c.createdAt > lastMarked) lastMarked = c.createdAt
  for (const thread of nodes(pr.reviewThreads)) {
    for (const c of nodes(thread.comments)) if (isMarked(c) && c.createdAt > lastMarked) lastMarked = c.createdAt
  }

  for (const r of nodes(pr.reviews)) {
    if (!(r.body ?? '').trim() || isMarked(r) || r.createdAt <= lastMarked) continue
    items.push({ kind: 'review', id: r.databaseId, author: login(r), state: r.state, body: r.body, createdAt: r.createdAt })
  }
  for (const thread of nodes(pr.reviewThreads)) {
    if (thread.isResolved) continue
    const comments = nodes(thread.comments)
    let start = 0
    comments.forEach((c, i) => { if (isMarked(c)) start = i + 1 })
    for (const c of comments.slice(start)) {
      if (!(c.body ?? '').trim()) continue
      items.push({
        kind: 'inline', id: c.databaseId, author: login(c), body: c.body,
        path: c.path, line: c.line, diffHunk: c.diffHunk, createdAt: c.createdAt,
      })
    }
  }
  for (const c of nodes(pr.comments)) {
    if (!(c.body ?? '').trim() || isMarked(c) || c.createdAt <= lastMarked) continue
    items.push({ kind: 'conversation', id: c.databaseId, author: login(c), body: c.body, createdAt: c.createdAt })
  }
  return items
}

const FAILED_CHECK = new Set(['FAILURE', 'TIMED_OUT', 'STARTUP_FAILURE', 'ACTION_REQUIRED'])
const FAILED_STATUS = new Set(['FAILURE', 'ERROR'])

/** Checks and commit statuses on the PR head that failed, each `{ name, url }`. */
export function failedChecks(pr) {
  const commit = nodes(pr.commits)[0]?.commit
  const failed = []
  for (const c of nodes(commit?.statusCheckRollup?.contexts)) {
    if (c.__typename === 'CheckRun' && FAILED_CHECK.has(c.conclusion)) {
      failed.push({ name: c.name, url: c.detailsUrl ?? '' })
    } else if (c.__typename === 'StatusContext' && FAILED_STATUS.has(c.state)) {
      failed.push({ name: c.context, url: c.targetUrl ?? '' })
    }
  }
  return failed.sort((a, b) => a.name.localeCompare(b.name))
}

/** The commit the checks ran on: the PR head as GitHub last saw it. */
export function checkedOid(pr) {
  return nodes(pr.commits)[0]?.commit?.oid ?? pr.headRefOid
}

/** A stable key per item, since review, inline and conversation ids are separate sequences. */
export function itemKey(item) {
  return `${item.kind}:${item.id}`
}
