import { execFile } from 'child_process'
import { promisify } from 'util'
import { execEnv } from './env'
import type { GitHubCliAuthStatus } from './github-auth'
import type { BoardState, Task } from './store'

const pexec = promisify(execFile)

/** Where a card came from: the Issue or PR it was converted from. */
export interface GithubRef {
  kind: 'issue' | 'pr'
  /** `owner/name` */
  repo: string
  number: number
  url: string
}

export interface GithubUser {
  login: string
  name?: string
}

export interface GithubLabel {
  name: string
  /** Hex without `#`, as GitHub returns it. */
  color: string
}

export interface GithubIssueType {
  name: string
  color?: string
}

export type GithubPrState = 'open' | 'draft' | 'merged' | 'closed'

interface GithubItemBase {
  repo: string
  number: number
  title: string
  url: string
  body: string
  author: GithubUser | null
  assignees: GithubUser[]
  labels: GithubLabel[]
  milestone: string | null
  /** ISO 8601 */
  createdAt: string
}

export interface GithubIssue extends GithubItemBase {
  kind: 'issue'
  issueType: GithubIssueType | null
}

export interface GithubPr extends GithubItemBase {
  kind: 'pr'
  state: GithubPrState
  /** APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED, or null when none applies. */
  reviewDecision: string | null
  headRefName: string
  baseRefName: string
}

export type GithubItem = GithubIssue | GithubPr

export interface GithubRepoInbox {
  repo: string
  /** The board project this repo was found through — where a converted card goes. */
  projectPath: string
  projectName: string
  issues: GithubIssue[]
  prs: GithubPr[]
  error?: string
}

export type GithubInboxStatus = 'ok' | 'gh-missing' | 'unauthenticated'

export interface GithubInbox {
  status: GithubInboxStatus
  /** The account `@me` resolves to. */
  login?: string
  /** When the oldest repo shown was fetched; 0 when nothing was. */
  fetchedAt: number
  repos: GithubRepoInbox[]
}

export interface GithubLink {
  kind: 'issue' | 'pr'
  number: number
  url: string
  state: GithubPrState
}

export interface GithubTaskLinks {
  issue?: GithubLink
  pr?: GithubLink
}

/** Runs `gh <args>` and returns stdout. Injectable so tests never touch the network. */
export type GhRunner = (args: string[]) => Promise<string>

export const defaultGhRunner: GhRunner = async (args) => {
  const { stdout } = await pexec('gh', args, {
    env: execEnv(),
    maxBuffer: 16 * 1024 * 1024,
    timeout: 30_000,
    windowsHide: true,
  })
  return stdout.toString()
}

/** `owner/name` for a github.com remote URL (SSH or HTTPS), else null. */
export function parseGithubRepo(remoteUrl: string | null | undefined): string | null {
  if (!remoteUrl) return null
  const url = remoteUrl.trim()
  const match =
    url.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/) ??
    url.match(/^ssh:\/\/git@github\.com(?::\d+)?\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/) ??
    url.match(/^https?:\/\/(?:[^@/\s]+@)?github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/)
  return match ? `${match[1]}/${match[2]}` : null
}

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

export function isGithubRef(value: unknown): value is GithubRef {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    (v.kind === 'issue' || v.kind === 'pr') &&
    typeof v.repo === 'string' &&
    REPO_RE.test(v.repo) &&
    typeof v.number === 'number' &&
    Number.isInteger(v.number) &&
    v.number > 0 &&
    typeof v.url === 'string' &&
    v.url.startsWith(`https://github.com/${v.repo}/`)
  )
}

const ITEM_FIELDS = 'number,title,url,body,author,assignees,labels,milestone,createdAt'
const ISSUE_FIELDS = `${ITEM_FIELDS},issueType`
const PR_FIELDS = `${ITEM_FIELDS},state,isDraft,reviewDecision,headRefName,baseRefName`
const PR_INDEX_FIELDS = 'number,url,state,isDraft,headRefName,closingIssuesReferences'
const LIST_LIMIT = '50'
const PR_INDEX_LIMIT = '100'

type Raw = Record<string, unknown>

async function runJson(run: GhRunner, args: string[]): Promise<Raw[]> {
  const out = await run(args)
  const parsed = JSON.parse(out || '[]') as unknown
  return Array.isArray(parsed) ? (parsed as Raw[]) : []
}

function user(raw: unknown): GithubUser | null {
  const u = raw as Raw | null
  if (!u || typeof u.login !== 'string') return null
  return typeof u.name === 'string' && u.name ? { login: u.login, name: u.name } : { login: u.login }
}

function base(raw: Raw, repo: string): GithubItemBase {
  const milestone = raw.milestone as Raw | null
  return {
    repo,
    number: Number(raw.number),
    title: String(raw.title ?? ''),
    url: String(raw.url ?? ''),
    body: typeof raw.body === 'string' ? raw.body : '',
    author: user(raw.author),
    assignees: Array.isArray(raw.assignees)
      ? (raw.assignees.map(user).filter(Boolean) as GithubUser[])
      : [],
    labels: Array.isArray(raw.labels)
      ? (raw.labels as Raw[]).map((l) => ({ name: String(l.name ?? ''), color: String(l.color ?? '') }))
      : [],
    milestone: milestone && typeof milestone.title === 'string' ? milestone.title : null,
    createdAt: String(raw.createdAt ?? ''),
  }
}

export function prStateOf(raw: { state?: unknown; isDraft?: unknown }): GithubPrState {
  if (raw.state === 'MERGED') return 'merged'
  if (raw.state === 'CLOSED') return 'closed'
  return raw.isDraft ? 'draft' : 'open'
}

export function toIssue(raw: Raw, repo: string): GithubIssue {
  const type = raw.issueType as Raw | null | undefined
  return {
    ...base(raw, repo),
    kind: 'issue',
    issueType:
      type && typeof type.name === 'string'
        ? { name: type.name, ...(typeof type.color === 'string' ? { color: type.color } : {}) }
        : null,
  }
}

export function toPr(raw: Raw, repo: string): GithubPr {
  return {
    ...base(raw, repo),
    kind: 'pr',
    state: prStateOf(raw),
    reviewDecision: typeof raw.reviewDecision === 'string' && raw.reviewDecision ? raw.reviewDecision : null,
    headRefName: String(raw.headRefName ?? ''),
    baseRefName: String(raw.baseRefName ?? ''),
  }
}

/** One entry per number, newest first. */
export function mergeItems<T extends { number: number; createdAt: string }>(lists: T[][]): T[] {
  const byNumber = new Map<number, T>()
  for (const list of lists) for (const item of list) if (!byNumber.has(item.number)) byNumber.set(item.number, item)
  return Array.from(byNumber.values()).sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || b.number - a.number
  )
}

async function listIssues(run: GhRunner, repo: string, filter: string[]): Promise<GithubIssue[]> {
  const args = ['issue', 'list', '-R', repo, '--state', 'open', '--limit', LIST_LIMIT, ...filter]
  let rows: Raw[]
  try {
    rows = await runJson(run, [...args, '--json', ISSUE_FIELDS])
  } catch (err) {
    // `issueType` is newer than some gh installs; the rest of the card is still worth showing.
    if (!/issueType/.test(errorText(err))) throw err
    rows = await runJson(run, [...args, '--json', ITEM_FIELDS])
  }
  return rows.map((r) => toIssue(r, repo))
}

async function listPrs(run: GhRunner, repo: string, filter: string[]): Promise<GithubPr[]> {
  const rows = await runJson(run, [
    'pr', 'list', '-R', repo, '--state', 'open', '--limit', LIST_LIMIT, ...filter, '--json', PR_FIELDS,
  ])
  return rows.map((r) => toPr(r, repo))
}

/** Open Issues assigned to or opened by me; open PRs assigned to, opened by or awaiting review from me. */
export async function fetchRepoItems(
  run: GhRunner,
  repo: string
): Promise<{ issues: GithubIssue[]; prs: GithubPr[] }> {
  const [assignedIssues, authoredIssues, assignedPrs, authoredPrs, reviewPrs] = await Promise.all([
    listIssues(run, repo, ['--assignee', '@me']),
    listIssues(run, repo, ['--author', '@me']),
    listPrs(run, repo, ['--assignee', '@me']),
    listPrs(run, repo, ['--author', '@me']),
    listPrs(run, repo, ['--search', 'review-requested:@me']),
  ])
  return {
    issues: mergeItems([assignedIssues, authoredIssues]),
    prs: mergeItems([assignedPrs, authoredPrs, reviewPrs]),
  }
}

export interface PrIndexEntry {
  number: number
  url: string
  state: GithubPrState
  headRefName: string
  /** Issues in the same repo this PR closes when merged. */
  closingIssues: { number: number; url: string }[]
}

/** The repo's most recent PRs in any state: what lets a card find its PR by branch. */
export async function fetchPrIndex(run: GhRunner, repo: string): Promise<PrIndexEntry[]> {
  const rows = await runJson(run, [
    'pr', 'list', '-R', repo, '--state', 'all', '--limit', PR_INDEX_LIMIT, '--json', PR_INDEX_FIELDS,
  ])
  const [owner, name] = repo.split('/')
  return rows.map((r) => ({
    number: Number(r.number),
    url: String(r.url ?? ''),
    state: prStateOf(r),
    headRefName: String(r.headRefName ?? ''),
    closingIssues: (Array.isArray(r.closingIssuesReferences) ? (r.closingIssuesReferences as Raw[]) : [])
      .filter((ref) => {
        const repository = ref.repository as Raw | undefined
        const refOwner = (repository?.owner as Raw | undefined)?.login
        return !repository || (repository.name === name && refOwner === owner)
      })
      .map((ref) => ({
        number: Number(ref.number),
        url: typeof ref.url === 'string' ? ref.url : `https://github.com/${repo}/issues/${ref.number}`,
      })),
  }))
}

function linkFromRef(ref: GithubRef, state: GithubPrState): GithubLink {
  return { kind: ref.kind, number: ref.number, url: ref.url, state }
}

/** A card past Backlog has (or had) a real branch; an unstarted one only has a name that may collide. */
function hasRealBranch(task: Task): boolean {
  return Boolean(task.provisionedAt || task.worktreePath || task.outcome)
}

/**
 * Which Issue and PR each card belongs to. A card's own `github` source wins;
 * otherwise its PR is the newest one whose head is the card's branch, or the PR
 * captured at completion, and its Issue is the one that PR closes. An Issue's
 * state is only known through its PR, so it reads as closed once that PR merged.
 */
export function resolveTaskLinks(
  tasks: Task[],
  repoOfProject: Map<string, string>,
  prIndex: Map<string, PrIndexEntry[]>
): Record<string, GithubTaskLinks> {
  const links: Record<string, GithubTaskLinks> = {}
  for (const task of tasks) {
    const source = task.github
    const repo = source?.repo ?? (task.projectPath ? repoOfProject.get(task.projectPath) : undefined)
    const index = repo ? prIndex.get(repo) ?? [] : []

    let pr: GithubLink | undefined
    let prEntry: PrIndexEntry | undefined
    if (source?.kind === 'pr') {
      prEntry = index.find((e) => e.number === source.number)
      pr = linkFromRef(source, prEntry?.state ?? 'open')
    } else {
      if (hasRealBranch(task)) {
        prEntry = index
          .filter((e) => e.headRefName === task.branch)
          .sort((a, b) => b.number - a.number)[0]
      }
      if (prEntry) {
        pr = { kind: 'pr', number: prEntry.number, url: prEntry.url, state: prEntry.state }
      } else if (task.outcome?.pr) {
        const o = task.outcome.pr
        pr = { kind: 'pr', number: o.number, url: o.url, state: prStateOf({ state: o.state }) }
      }
    }

    const issueState: GithubPrState = pr?.state === 'merged' ? 'closed' : 'open'
    let issue: GithubLink | undefined
    if (source?.kind === 'issue') {
      issue = linkFromRef(source, issueState)
    } else if (prEntry?.closingIssues[0]) {
      const ref = prEntry.closingIssues[0]
      issue = { kind: 'issue', number: ref.number, url: ref.url, state: issueState }
    }

    if (pr || issue) links[task.id] = { ...(issue ? { issue } : {}), ...(pr ? { pr } : {}) }
  }
  return links
}

function errorText(err: unknown): string {
  const e = err as { stderr?: Buffer | string; message?: string }
  const stderr = e?.stderr ? e.stderr.toString().trim() : ''
  return stderr || e?.message || String(err)
}

export const GITHUB_CACHE_TTL_MS = 5 * 60 * 1000

interface CacheEntry<T> {
  at: number
  value: Promise<T>
}

export interface GithubServiceOptions {
  run?: GhRunner
  authStatus: () => Promise<GitHubCliAuthStatus>
  /** `owner/name` of a project's origin, or null when it is not on github.com. */
  repoOf: (projectPath: string) => Promise<string | null>
  now?: () => number
}

export interface GithubService {
  inbox(board: BoardState, opts?: { force?: boolean }): Promise<GithubInbox>
  taskLinks(board: BoardState, opts?: { force?: boolean }): Promise<Record<string, GithubTaskLinks>>
}

function boardTasks(board: BoardState): Task[] {
  return [...board.in_progress, ...board.backlog, ...board.done]
}

/** Board projects, most recently used first, so a repo maps to the project last worked in. */
function boardProjects(board: BoardState): string[] {
  const latest = new Map<string, number>()
  for (const t of boardTasks(board)) {
    if (!t.projectPath) continue
    latest.set(t.projectPath, Math.max(latest.get(t.projectPath) ?? 0, t.createdAt ?? 0))
  }
  return Array.from(latest.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([p]) => p)
}

function basename(p: string): string {
  return p.split(/[/\\]/).filter(Boolean).pop() ?? p
}

/**
 * Fetches are per repo and cached for GITHUB_CACHE_TTL_MS; `force` refetches.
 * A failed fetch is cached too, so one broken repo is not retried on every board
 * change — the refresh button is how the user asks again.
 */
export function createGithubService(options: GithubServiceOptions): GithubService {
  const run = options.run ?? defaultGhRunner
  const authStatus = options.authStatus
  const now = options.now ?? Date.now
  const items = new Map<string, CacheEntry<{ issues: GithubIssue[]; prs: GithubPr[] }>>()
  const indexes = new Map<string, CacheEntry<PrIndexEntry[]>>()
  const repos = new Map<string, CacheEntry<string | null>>()

  function cached<T>(map: Map<string, CacheEntry<T>>, key: string, force: boolean, load: () => Promise<T>): CacheEntry<T> {
    const hit = map.get(key)
    if (hit && !force && now() - hit.at < GITHUB_CACHE_TTL_MS) return hit
    const entry = { at: now(), value: load() }
    entry.value.catch(() => {})
    map.set(key, entry)
    return entry
  }

  async function projectRepos(board: BoardState, force: boolean): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    const projects = boardProjects(board)
    const resolved = await Promise.all(
      projects.map((p) => cached(repos, p, force, () => options.repoOf(p)).value.catch(() => null))
    )
    projects.forEach((p, i) => {
      const repo = resolved[i]
      if (repo) out.set(p, repo)
    })
    return out
  }

  return {
    async inbox(board, opts = {}) {
      const force = opts.force === true
      const auth = await authStatus()
      if (!auth.installed) return { status: 'gh-missing', fetchedAt: 0, repos: [] }
      if (!auth.authenticated) return { status: 'unauthenticated', fetchedAt: 0, repos: [] }

      const byProject = await projectRepos(board, force)
      const repoProject = new Map<string, string>()
      for (const [project, repo] of byProject) if (!repoProject.has(repo)) repoProject.set(repo, project)

      const entries = Array.from(repoProject.entries())
      const results = await Promise.all(
        entries.map(async ([repo, projectPath]): Promise<{ at: number; inbox: GithubRepoInbox }> => {
          const entry = cached(items, repo, force, () => fetchRepoItems(run, repo))
          const head = { repo, projectPath, projectName: basename(projectPath) }
          try {
            return { at: entry.at, inbox: { ...head, ...(await entry.value) } }
          } catch (err) {
            return { at: entry.at, inbox: { ...head, issues: [], prs: [], error: errorText(err) } }
          }
        })
      )
      return {
        status: 'ok',
        ...(auth.login ? { login: auth.login } : {}),
        fetchedAt: results.length ? Math.min(...results.map((r) => r.at)) : 0,
        repos: results.map((r) => r.inbox).sort((a, b) => a.repo.localeCompare(b.repo)),
      }
    },

    async taskLinks(board, opts = {}) {
      const force = opts.force === true
      const tasks = boardTasks(board)
      const byProject = await projectRepos(board, force)
      const wanted = new Set<string>(byProject.values())
      for (const t of tasks) if (t.github) wanted.add(t.github.repo)
      const prIndex = new Map<string, PrIndexEntry[]>()
      await Promise.all(
        Array.from(wanted).map(async (repo) => {
          try {
            prIndex.set(repo, await cached(indexes, repo, force, () => fetchPrIndex(run, repo)).value)
          } catch {
            // No index for this repo: its cards fall back to their own source and outcome.
          }
        })
      )
      return resolveTaskLinks(tasks, byProject, prIndex)
    },
  }
}
