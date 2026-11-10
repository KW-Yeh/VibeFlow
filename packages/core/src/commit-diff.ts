import fs from 'fs'
import { PROGRESS_EVENTS_DIR } from './launch'
import { SUBAGENTS_DIR } from './subagents'
import { defaultGhRunner, type GhRunner } from './github'
import {
  MAX_DIFF_FILES,
  MAX_OUTCOME_COMMITS,
  clip,
  collectCommitEntries,
  collectWorkingEntries,
  fetchBase,
  firstParent,
  readEntryFile,
  resolveBaseRef,
  runGit as git,
  type DiffEntry,
  type DiffFile,
} from './git'

/** The "commit" that stands for changes not committed yet. */
export const WORKING_CHANGES = 'working'

const SHA_RE = /^[0-9a-f]{4,40}$/i

/** A commit id the diff handlers accept: hex only, so it can never be a ref name, range or option. */
export function isCommitSha(value: unknown): value is string {
  return typeof value === 'string' && SHA_RE.test(value)
}

export interface CommitSummary {
  sha: string
  shortSha: string
  subject: string
  /** Epoch ms. */
  authoredAt: number
  isMerge: boolean
  /** Against the first parent, so a merge counts what it brought in. */
  additions: number
  deletions: number
  fileCount: number
}

export interface WorkingSummary {
  fileCount: number
  additions: number
  deletions: number
}

export interface BranchCommits {
  /** `base..HEAD`, newest first, capped at MAX_OUTCOME_COMMITS. */
  commits: CommitSummary[]
  /** Null when nothing is uncommitted. */
  working: WorkingSummary | null
  truncated: boolean
}

/** One file of a commit as GitHub reports it: a unified patch, no full contents. */
export interface PatchFile {
  path: string
  /** Single-letter status, as in DiffEntry. */
  status: string
  additions: number
  deletions: number
  /** Absent when GitHub sends none (binary or too large). */
  patch?: string
  truncated?: boolean
}

export type CommitDiff =
  | { source: 'git'; sha: string; files: DiffEntry[]; truncated: boolean }
  | { source: 'github'; sha: string; files: PatchFile[]; truncated: boolean }
  | { source: 'none'; reason: string }

const isMetadataPath = (p: string): boolean =>
  [SUBAGENTS_DIR, PROGRESS_EVENTS_DIR].some((dir) => p === dir || p.startsWith(`${dir}/`))

/** NUL-separated fields after a \x01 record mark, so subjects cannot split a record. */
const COMMIT_LOG_FORMAT = '%x01%H%x00%h%x00%s%x00%at%x00%P'

export async function listBranchCommits(
  worktreePath: string,
  baseRef: string
): Promise<{ commits: CommitSummary[]; truncated: boolean }> {
  const out = await git(worktreePath, [
    'log',
    `--format=${COMMIT_LOG_FORMAT}`,
    '--numstat',
    '--diff-merges=first-parent',
    `--max-count=${MAX_OUTCOME_COMMITS + 1}`,
    `${baseRef}..HEAD`,
  ]).catch(() => '')

  const commits: CommitSummary[] = []
  for (const record of out.split('\x01')) {
    const lines = record.split('\n')
    const header = lines[0]?.split('\0')
    if (!header || header.length < 5) continue
    const [sha, shortSha, subject, at, parents] = header
    let additions = 0
    let deletions = 0
    let fileCount = 0
    for (const line of lines.slice(1)) {
      const parts = line.split('\t')
      if (parts.length < 3 || isMetadataPath(parts[parts.length - 1])) continue
      fileCount++
      additions += Number.parseInt(parts[0], 10) || 0
      deletions += Number.parseInt(parts[1], 10) || 0
    }
    commits.push({
      sha,
      shortSha,
      subject,
      authoredAt: (Number.parseInt(at, 10) || 0) * 1000,
      isMerge: parents.trim().split(/\s+/).filter(Boolean).length > 1,
      additions,
      deletions,
      fileCount,
    })
  }
  return {
    commits: commits.slice(0, MAX_OUTCOME_COMMITS),
    truncated: commits.length > MAX_OUTCOME_COMMITS,
  }
}

function summarize(entries: DiffEntry[]): WorkingSummary | null {
  if (entries.length === 0) return null
  return {
    fileCount: entries.length,
    additions: entries.reduce((sum, e) => sum + e.additions, 0),
    deletions: entries.reduce((sum, e) => sum + e.deletions, 0),
  }
}

/** Commit list for a running card's worktree. Local only — the diff poll never hits the network. */
export async function getBranchCommits(
  worktreePath: string,
  baseBranch: string
): Promise<BranchCommits> {
  const baseRef = await resolveBaseRef(worktreePath, baseBranch)
  const [{ commits, truncated }, working] = await Promise.all([
    listBranchCommits(worktreePath, baseRef),
    collectWorkingEntries(worktreePath),
  ])
  return { commits, working: summarize(working), truncated }
}

async function resolveCommit(cwd: string, sha: string): Promise<string | null> {
  return git(cwd, ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`]).catch(() => null)
}

async function isAncestor(cwd: string, sha: string, ref: string): Promise<boolean> {
  return git(cwd, ['merge-base', '--is-ancestor', sha, ref]).then(
    () => true,
    () => false
  )
}

/** Full sha of `sha` when it is one of the branch's own commits (`base..HEAD`), else null. */
async function resolveBranchCommit(
  worktreePath: string,
  baseBranch: string,
  sha: string
): Promise<string | null> {
  const full = await resolveCommit(worktreePath, sha)
  if (!full) return null
  const baseRef = await resolveBaseRef(worktreePath, baseBranch)
  if (!(await isAncestor(worktreePath, full, 'HEAD'))) return null
  if (await isAncestor(worktreePath, full, baseRef)) return null
  return full
}

/**
 * Files of one of the branch's commits, or of the uncommitted changes. Null
 * when `ref` is not a commit of this branch, so a stale or forged id reads nothing.
 */
export async function getCommitEntries(
  worktreePath: string,
  baseBranch: string,
  ref: string
): Promise<DiffEntry[] | null> {
  if (ref === WORKING_CHANGES) {
    return (await collectWorkingEntries(worktreePath)).slice(0, MAX_DIFF_FILES)
  }
  const full = await resolveBranchCommit(worktreePath, baseBranch, ref)
  if (!full) return null
  return (await collectCommitEntries(worktreePath, full)).slice(0, MAX_DIFF_FILES)
}

/** Old/new content of one file of a branch commit (or the uncommitted changes). */
export async function getCommitFile(
  worktreePath: string,
  baseBranch: string,
  ref: string,
  filePath: string
): Promise<DiffFile | null> {
  if (ref === WORKING_CHANGES) {
    const entry = (await collectWorkingEntries(worktreePath)).find((e) => e.path === filePath)
    return entry ? readEntryFile(worktreePath, 'HEAD', null, entry) : null
  }
  const full = await resolveBranchCommit(worktreePath, baseBranch, ref)
  if (!full) return null
  const entry = (await collectCommitEntries(worktreePath, full)).find((e) => e.path === filePath)
  if (!entry) return null
  return readEntryFile(worktreePath, await firstParent(worktreePath, full), full, entry)
}

// --- Done cards ---------------------------------------------------------------

/**
 * Full sha of `sha` when the project's base already contains it — the case for
 * a branch merged with a merge commit or fast-forward. Squash and rebase merges
 * rewrite the commits, so theirs are not found here.
 */
export async function resolveCommitInBase(
  projectPath: string,
  baseBranch: string,
  sha: string,
  opts?: { fetch?: boolean }
): Promise<string | null> {
  if (!fs.existsSync(projectPath)) return null
  if (opts?.fetch) await fetchBase(projectPath, baseBranch)
  const full = await resolveCommit(projectPath, sha)
  if (!full) return null
  const baseRef = await resolveBaseRef(projectPath, baseBranch)
  return (await isAncestor(projectPath, full, baseRef)) ? full : null
}

const PR_URL_RE = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pull\/(\d+)(?:[/?#].*)?$/

/** `{ repo, number }` from a github.com PR url, else null. */
export function parsePrUrl(url: string): { repo: string; number: number } | null {
  const match = PR_URL_RE.exec(url)
  if (!match || match[1].split('/').some((part) => part === '.' || part === '..')) return null
  return { repo: match[1], number: Number(match[2]) }
}

const GITHUB_STATUS: Record<string, string> = {
  added: 'A',
  removed: 'D',
  modified: 'M',
  renamed: 'R',
  copied: 'C',
  changed: 'M',
  unchanged: 'M',
}

interface GithubCommitFile {
  filename?: unknown
  status?: unknown
  additions?: unknown
  deletions?: unknown
  patch?: unknown
}

/** GitHub's commit-files answer, reduced to what the patch viewer reads. */
export function parseGithubCommitFiles(json: string): { files: PatchFile[]; truncated: boolean } {
  const parsed = JSON.parse(json) as { files?: GithubCommitFile[] }
  const raw = Array.isArray(parsed?.files) ? parsed.files : []
  const files: PatchFile[] = []
  for (const f of raw) {
    if (typeof f?.filename !== 'string' || isMetadataPath(f.filename)) continue
    const file: PatchFile = {
      path: f.filename,
      status: GITHUB_STATUS[String(f.status)] ?? 'M',
      additions: typeof f.additions === 'number' ? f.additions : 0,
      deletions: typeof f.deletions === 'number' ? f.deletions : 0,
    }
    if (typeof f.patch === 'string') {
      const clipped = clip(f.patch)
      file.patch = clipped.value
      if (clipped.truncated) file.truncated = true
    }
    files.push(file)
  }
  return { files: files.slice(0, MAX_DIFF_FILES), truncated: files.length > MAX_DIFF_FILES }
}

function ghError(err: unknown): string {
  const e = err as { code?: unknown; stderr?: unknown; message?: unknown }
  if (e?.code === 'ENOENT') return '找不到 gh 指令'
  const text = String(e?.stderr || e?.message || err).trim()
  return text.split('\n')[0] || 'gh 執行失敗'
}

async function readGithubCommit(
  pr: { repo: string; number: number },
  sha: string,
  runGh: GhRunner
): Promise<CommitDiff> {
  let shas: string[]
  try {
    const out = await runGh([
      'api',
      `repos/${pr.repo}/pulls/${pr.number}/commits?per_page=100`,
      '--paginate',
      '--jq',
      '.[].sha',
    ])
    shas = out.split('\n').map((l) => l.trim().toLowerCase()).filter(Boolean)
  } catch (err) {
    return { source: 'none', reason: `base 中找不到這個 commit，透過 gh 讀取 PR #${pr.number} 也失敗：${ghError(err)}` }
  }
  const matches = [...new Set(shas.filter((s) => s.startsWith(sha.toLowerCase())))]
  if (matches.length !== 1) {
    return {
      source: 'none',
      reason:
        matches.length === 0
          ? `base 中找不到這個 commit，PR #${pr.number} 的 commit 中也沒有它。`
          : `PR #${pr.number} 中有多個 commit 符合 ${sha}，無法判斷是哪一個。`,
    }
  }
  try {
    const json = await runGh(['api', `repos/${pr.repo}/commits/${matches[0]}`])
    const { files, truncated } = parseGithubCommitFiles(json)
    return { source: 'github', sha: matches[0], files, truncated }
  } catch (err) {
    return { source: 'none', reason: `透過 gh 讀取這個 commit 失敗：${ghError(err)}` }
  }
}

/**
 * One commit of a finished card. The local branch is gone by now, so: the
 * project's base first (a merged branch's commits live there), then the card's
 * PR through `gh`, else a reason the UI can show.
 */
export async function getDoneCommitDiff(input: {
  projectPath?: string
  baseBranch: string
  sha: string
  prUrl?: string
  runGh?: GhRunner
}): Promise<CommitDiff> {
  if (input.projectPath) {
    const full = await resolveCommitInBase(input.projectPath, input.baseBranch, input.sha, {
      fetch: true,
    })
    if (full) {
      const entries = await collectCommitEntries(input.projectPath, full)
      return {
        source: 'git',
        sha: full,
        files: entries.slice(0, MAX_DIFF_FILES),
        truncated: entries.length > MAX_DIFF_FILES,
      }
    }
  }
  const pr = input.prUrl ? parsePrUrl(input.prUrl) : null
  if (!pr) return { source: 'none', reason: '此卡沒有 PR，且 base 中找不到這個 commit。' }
  return readGithubCommit(pr, input.sha, input.runGh ?? defaultGhRunner)
}

/** Old/new content of one file of a done card's commit that the base contains. */
export async function getDoneCommitFile(
  projectPath: string,
  baseBranch: string,
  sha: string,
  filePath: string
): Promise<DiffFile | null> {
  const full = await resolveCommitInBase(projectPath, baseBranch, sha)
  if (!full) return null
  const entry = (await collectCommitEntries(projectPath, full)).find((e) => e.path === filePath)
  if (!entry) return null
  return readEntryFile(projectPath, await firstParent(projectPath, full), full, entry)
}
