import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs/promises'
import { PROGRESS_FILE } from './progress'
import { SUBAGENTS_DIR } from './subagents'
import { execEnv } from './env'

const pexec = promisify(execFile)

/**
 * Run a git command in `cwd` and return trimmed stdout. Uses an augmented PATH
 * (see env.ts) so git hooks that shell out — notably the Git LFS
 * post-checkout/-commit hooks — can find `git-lfs` even when the app was
 * launched from Finder with a minimal PATH.
 */
async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await pexec('git', args, {
    cwd,
    maxBuffer: 32 * 1024 * 1024,
    env: execEnv(),
  })
  return stdout.toString().trim()
}

export interface GitInfo {
  isRepo: boolean
  hasRemote: boolean
  remoteUrl: string | null
  currentBranch: string | null
  /** Candidate base branches (local + remote, de-duped). */
  branches: string[]
  /** Suggested default base branch (main/master/current). */
  defaultBase: string | null
}

const EMPTY_INFO: GitInfo = {
  isRepo: false,
  hasRemote: false,
  remoteUrl: null,
  currentBranch: null,
  branches: [],
  defaultBase: null,
}

export async function getGitInfo(projectPath: string): Promise<GitInfo> {
  if (!projectPath) return EMPTY_INFO
  try {
    await git(projectPath, ['rev-parse', '--is-inside-work-tree'])
  } catch {
    return EMPTY_INFO
  }

  let remoteUrl: string | null = null
  try {
    remoteUrl = await git(projectPath, ['remote', 'get-url', 'origin'])
  } catch {
    remoteUrl = null
  }
  const hasRemote = Boolean(remoteUrl)

  let currentBranch: string | null = null
  try {
    currentBranch = await git(projectPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
  } catch {
    currentBranch = null
  }

  const localOut = await git(projectPath, [
    'branch',
    '--format=%(refname:short)',
  ]).catch(() => '')
  const local = localOut
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)

  let remote: string[] = []
  if (hasRemote) {
    const remoteOut = await git(projectPath, [
      'branch',
      '-r',
      '--format=%(refname:short)',
    ]).catch(() => '')
    remote = remoteOut
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((b) => !b.includes('->')) // skip "origin/HEAD -> origin/main"
      .map((b) => b.replace(/^origin\//, ''))
  }

  const branches = Array.from(new Set([...local, ...remote])).sort()

  let defaultBase: string | null = currentBranch
  if (branches.includes('main')) defaultBase = 'main'
  else if (branches.includes('master')) defaultBase = 'master'

  return { isRepo: true, hasRemote, remoteUrl, currentBranch, branches, defaultBase }
}

/**
 * Append `entry` (under a `# header` line) to a git ignore-style file unless it
 * — or one of `aliases` — is already present. Idempotent; preserves existing
 * content and trailing-newline conventions. Creates the parent dir when asked.
 */
async function appendLineIfMissing(
  filePath: string,
  entry: string,
  header: string,
  options: { aliases?: string[]; mkdir?: boolean } = {}
): Promise<void> {
  let content = ''
  try {
    content = await fs.readFile(filePath, 'utf8')
  } catch {
    content = ''
  }
  const present = new Set([entry, ...(options.aliases ?? [])])
  const lines = content.split('\n').map((l) => l.trim())
  if (lines.some((l) => present.has(l))) return
  const prefix = content.length > 0 && !content.endsWith('\n') ? '\n' : ''
  const addition = `${prefix}\n${header}\n${entry}\n`
  if (options.mkdir) {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
  }
  await fs.writeFile(filePath, content + addition, 'utf8')
}

/**
 * Initialise `projectPath` as a git repository with an initial commit so that
 * `provisionWorktree` can create a worktree from it.  Idempotent: safe to call
 * on a folder that is already a git repo or already has commits.
 */
export async function initRepository(projectPath: string): Promise<void> {
  await fs.mkdir(projectPath, { recursive: true })

  // Detect whether the path is already inside a git work-tree.
  let alreadyRepo = false
  try {
    await git(projectPath, ['rev-parse', '--is-inside-work-tree'])
    alreadyRepo = true
  } catch {
    // not a repo yet — fall through to git init
  }

  if (!alreadyRepo) {
    // Prefer -b main (git ≥ 2.28) for a consistent default branch name.
    try {
      await git(projectPath, ['init', '-b', 'main'])
    } catch {
      await git(projectPath, ['init'])
    }
  }

  // Write .vibeflow/ into .gitignore regardless (ensureGitignore is idempotent).
  await ensureGitignore(projectPath)

  // If there is already at least one commit, we are done.
  try {
    await git(projectPath, ['rev-parse', '--verify', 'HEAD'])
    return
  } catch {
    // no commits yet — create the initial one
  }

  // Stage the .gitignore we just wrote and make the first commit.  Use inline
  // -c overrides so the commit succeeds even when the user's git identity is
  // not configured, without touching their global git config.
  await git(projectPath, ['add', '.gitignore'])
  await git(projectPath, [
    '-c', 'user.name=VibeFlow',
    '-c', 'user.email=vibeflow@local',
    '-c', 'commit.gpgsign=false',
    'commit',
    '-m', 'chore: initialize repository',
  ])
}

/** Ensure `.vibeflow/` is present in the project's .gitignore. */
export async function ensureGitignore(projectPath: string): Promise<void> {
  await appendLineIfMissing(
    path.join(projectPath, '.gitignore'),
    '.vibeflow/',
    '# VibeFlow worktrees',
    { aliases: ['.vibeflow'] }
  )
}

/**
 * Ensure the agent-maintained progress file is excluded via the repository's
 * `.git/info/exclude`. Unlike `.gitignore` this never enters the project's
 * history, and it applies to every worktree of the clone — so the progress
 * file can't be committed even by a `git add -A` run inside a task worktree.
 */
export async function ensureLocalExclude(projectPath: string): Promise<void> {
  const commonDir = await git(projectPath, ['rev-parse', '--git-common-dir'])
  const infoDir = path.resolve(projectPath, commonDir, 'info')
  await appendLineIfMissing(
    path.join(infoDir, 'exclude'),
    PROGRESS_FILE,
    '# VibeFlow task progress file (runtime-only)',
    { mkdir: true }
  )
  // The sub-agent event log is VibeFlow runtime metadata, never to be committed.
  await appendLineIfMissing(
    path.join(infoDir, 'exclude'),
    `${SUBAGENTS_DIR}/`,
    '# VibeFlow sub-agent event log (runtime-only)',
    { mkdir: true }
  )
}

export interface ProvisionResult {
  branch: string
  /** Absolute path of the created worktree. */
  worktreePath: string
  /** Relative path from the project root (e.g. .vibeflow/feature-WR-4832). */
  relativePath: string
  pushed: boolean
  baseBranch: string
}

/** Worktree directory name for a branch — `/` flattened so the directory
 *  always sits directly under `.vibeflow/` (e.g. feature/WR-4832 → feature-WR-4832). */
function worktreeDirName(branch: string): string {
  return branch.replace(/\//g, '-')
}

/** Whether `branch` already exists locally or on origin. */
async function branchExists(
  projectPath: string,
  branch: string
): Promise<boolean> {
  for (const ref of [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`]) {
    try {
      await git(projectPath, ['rev-parse', '--verify', '--quiet', ref])
      return true
    } catch {
      // not this ref — keep checking
    }
  }
  return false
}

/**
 * Legacy branch name used when no meaningful name can be derived from a card.
 * Shared so worktree provisioning and later cleanup/delete resolve the same
 * branch for a task that fell back to this naming.
 */
export function fallbackBranchName(taskId: string): string {
  return `vf-${taskId}`
}

/**
 * Resolve the branch to create for a task. Prefers the meaningful name from
 * branch-name.ts (validated via `git check-ref-format`); appends `-<taskId>`
 * when the name (or its worktree dir) is already taken; falls back to the
 * legacy `vf-<taskId>` when no preferred name was derived or it's invalid.
 */
async function resolveBranchName(
  projectPath: string,
  taskId: string,
  preferredBranch: string | null | undefined
): Promise<string> {
  const fallback = fallbackBranchName(taskId)
  if (!preferredBranch) return fallback
  try {
    await git(projectPath, ['check-ref-format', '--branch', preferredBranch])
  } catch {
    return fallback
  }
  const dirTaken = await fs
    .access(path.join(projectPath, '.vibeflow', worktreeDirName(preferredBranch)))
    .then(() => true)
    .catch(() => false)
  if (dirTaken || (await branchExists(projectPath, preferredBranch))) {
    return `${preferredBranch}-${taskId}`
  }
  return preferredBranch
}

/**
 * Create an isolated worktree for a task under `.vibeflow/<branch-dir>` on a
 * new branch, and (when a remote exists) push the branch upstream. The branch
 * is named from `preferredBranch` (e.g. feature/WR-4832, fix/WCL260522-0002,
 * feature/<title-slug>) when given, otherwise the legacy `vf-<taskId>`.
 */
export async function provisionWorktree(
  projectPath: string,
  taskId: string,
  baseBranch: string | null,
  preferredBranch?: string | null
): Promise<ProvisionResult> {
  await ensureGitignore(projectPath)
  await ensureLocalExclude(projectPath)

  const branch = await resolveBranchName(projectPath, taskId, preferredBranch)
  const relativePath = path.join('.vibeflow', worktreeDirName(branch))
  const worktreePath = path.join(projectPath, relativePath)

  const info = await getGitInfo(projectPath)
  const base = baseBranch || info.defaultBase || info.currentBranch || 'HEAD'

  // Prefer origin/<base> as the start point when it exists on the remote.
  // Fetch first so the worktree starts from the truly latest remote commit.
  let startPoint = base
  if (info.hasRemote) {
    try {
      await git(projectPath, ['fetch', 'origin', base])
    } catch {
      // fetch failure (e.g. offline) is non-fatal — fall back to local cache
    }
    try {
      await git(projectPath, ['rev-parse', '--verify', `origin/${base}`])
      startPoint = `origin/${base}`
    } catch {
      startPoint = base
    }
  }

  try {
    await git(projectPath, [
      'worktree',
      'add',
      '-b',
      branch,
      relativePath,
      startPoint,
    ])
  } catch (err) {
    // `worktree add` can fail AFTER creating the dir + branch (e.g. a failing
    // post-checkout hook), leaving orphans that clutter the repo. Roll back the
    // partial state before surfacing the error.
    await removeWorktree(projectPath, branch)
    await deleteBranch(projectPath, branch)
    throw err
  }

  let pushed = false
  if (info.hasRemote) {
    try {
      await git(worktreePath, ['push', '-u', 'origin', branch])
      pushed = true
    } catch {
      pushed = false
    }
  }

  return { branch, worktreePath, relativePath, pushed, baseBranch: base }
}

/** Remove a task branch's worktree directory and prune stale worktree metadata. */
export async function removeWorktree(
  projectPath: string,
  branch: string
): Promise<void> {
  const relativePath = path.join('.vibeflow', worktreeDirName(branch))
  try {
    await git(projectPath, ['worktree', 'remove', '--force', relativePath])
  } catch {
    // ignore — may already be gone
  }
  try {
    await git(projectPath, ['worktree', 'prune'])
  } catch {
    // ignore
  }
}

/**
 * Delete a task's local branch (best-effort). The branch must not be checked
 * out in any worktree — call this AFTER removeWorktree. The remote branch
 * (if pushed) is intentionally left intact for any open PR / merge.
 */
export async function deleteBranch(
  projectPath: string,
  branch: string
): Promise<void> {
  try {
    await git(projectPath, ['branch', '-D', branch])
  } catch {
    // ignore — branch may not exist (e.g. never created / already gone)
  }
}

export interface SyncResult {
  baseBranch: string
  /** Whether the main working tree is now on `baseBranch`. */
  switched: boolean
  /** Whether a fast-forward pull succeeded. */
  pulled: boolean
}

/**
 * Bring the main working tree back to `baseBranch` and fast-forward it to the
 * remote. Best-effort: a dirty tree, missing upstream, or absent remote leaves
 * the result flags false rather than throwing (used during task finalize).
 */
export async function syncBaseBranch(
  projectPath: string,
  baseBranch: string
): Promise<SyncResult> {
  let switched = false
  try {
    await git(projectPath, ['checkout', baseBranch])
    switched = true
  } catch {
    switched = false
  }
  let pulled = false
  try {
    await git(projectPath, ['pull', '--ff-only'])
    pulled = true
  } catch {
    pulled = false
  }
  return { baseBranch, switched, pulled }
}

export interface RefreshResult {
  fetched: boolean
  rebased: boolean
  /** True when rebase produced conflicts and was aborted — requires manual resolution. */
  conflicts: boolean
}

/**
 * Fetch the latest remote base branch and rebase the worktree's feature branch
 * on top of it. Call this to synchronise a long-running task with upstream changes.
 * On conflict the rebase is aborted and `conflicts` is set so the caller can surface
 * an actionable error to the user.
 */
export async function refreshWorktreeBase(
  worktreePath: string,
  baseBranch: string
): Promise<RefreshResult> {
  let fetched = false
  try {
    await git(worktreePath, ['fetch', 'origin', baseBranch])
    fetched = true
  } catch {
    fetched = false
  }

  let rebased = false
  let conflicts = false
  try {
    await git(worktreePath, ['rebase', `origin/${baseBranch}`])
    rebased = true
  } catch {
    conflicts = true
    try {
      await git(worktreePath, ['rebase', '--abort'])
    } catch {
      // ignore — rebase may not have started
    }
  }

  return { fetched, rebased, conflicts }
}

// --- Review & finalize (Phase 4) ---

export interface DiffFile {
  path: string
  /** Single-letter git status: A(dded) M(odified) D(eleted) R(enamed) ?(untracked) */
  status: string
  oldValue: string
  newValue: string
  /** True if content was truncated for display. */
  truncated: boolean
}

const MAX_BYTES = 1024 * 1024 // per-side content cap for the diff viewer
const MAX_FILES = 80

function clip(content: string): { value: string; truncated: boolean } {
  if (content.length > MAX_BYTES) {
    return { value: content.slice(0, MAX_BYTES) + '\n… (truncated)', truncated: true }
  }
  return { value: content, truncated: false }
}

/** Resolve the comparison ref for a worktree's base branch (prefer origin/<base>). */
async function resolveBaseRef(
  worktreePath: string,
  baseBranch: string
): Promise<string> {
  try {
    await git(worktreePath, ['rev-parse', '--verify', `origin/${baseBranch}`])
    return `origin/${baseBranch}`
  } catch {
    /* fall through */
  }
  try {
    await git(worktreePath, ['rev-parse', '--verify', baseBranch])
    return baseBranch
  } catch {
    return 'HEAD'
  }
}

/**
 * Compute the set of changed files in a worktree relative to its base branch,
 * returning full old/new file contents suitable for a side-by-side diff viewer.
 */
export async function getWorktreeDiff(
  worktreePath: string,
  baseBranch: string
): Promise<DiffFile[]> {
  // Refresh origin/<baseBranch> so the diff is always against the latest remote.
  try {
    await git(worktreePath, ['fetch', 'origin', baseBranch])
  } catch {
    // fetch failure (e.g. offline) is non-fatal — use local cache
  }
  const baseRef = await resolveBaseRef(worktreePath, baseBranch)

  // Tracked changes (committed + working tree) vs base.
  const nameStatus = await git(worktreePath, [
    'diff',
    '--name-status',
    baseRef,
  ]).catch(() => '')

  type Entry = { status: string; path: string }
  const entries: Entry[] = []
  for (const line of nameStatus.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const parts = line.split('\t')
    const code = parts[0]?.[0] ?? 'M'
    // For renames (R100\told\tnew) use the new path.
    const filePath = parts[parts.length - 1]
    entries.push({ status: code, path: filePath })
  }

  // Untracked files (not yet added).
  const untracked = await git(worktreePath, [
    'ls-files',
    '--others',
    '--exclude-standard',
  ]).catch(() => '')
  for (const p of untracked.split('\n').map((l) => l.trim()).filter(Boolean)) {
    if (!entries.some((e) => e.path === p)) {
      entries.push({ status: '?', path: p })
    }
  }

  // The agent-maintained progress file and sub-agent event log are VibeFlow
  // metadata, not changes to review — keep them out of the diff viewer.
  const limited = entries
    .filter(
      (e) =>
        e.path !== PROGRESS_FILE &&
        e.path !== SUBAGENTS_DIR &&
        !e.path.startsWith(`${SUBAGENTS_DIR}/`)
    )
    .slice(0, MAX_FILES)
  const files: DiffFile[] = []
  for (const entry of limited) {
    let oldValue = ''
    if (entry.status !== 'A' && entry.status !== '?') {
      oldValue = await git(worktreePath, [
        'show',
        `${baseRef}:${entry.path}`,
      ]).catch(() => '')
    }
    let newValue = ''
    if (entry.status !== 'D') {
      try {
        newValue = await fs.readFile(
          path.join(worktreePath, entry.path),
          'utf8'
        )
      } catch {
        newValue = ''
      }
    }
    const oldClip = clip(oldValue)
    const newClip = clip(newValue)
    files.push({
      path: entry.path,
      status: entry.status,
      oldValue: oldClip.value,
      newValue: newClip.value,
      truncated: oldClip.truncated || newClip.truncated,
    })
  }
  return files
}

export interface FinalizeResult {
  committed: boolean
  pushed: boolean
  message: string
}

/** Stage everything, commit, and push the worktree's branch upstream. */
export async function commitAndPush(
  worktreePath: string,
  message: string
): Promise<FinalizeResult> {
  // Stage everything. The agent-maintained progress file is kept out of the
  // commit by `.git/info/exclude` (see ensureLocalExclude), so `git add -A`
  // skips it on its own. An explicit `:(exclude)` pathspec here is redundant
  // and, on modern git, throws when the ignored file is present on disk.
  await git(worktreePath, ['add', '-A'])

  let committed = false
  try {
    await git(worktreePath, ['commit', '-m', message])
    committed = true
  } catch {
    // nothing to commit (working tree clean) — not an error
    committed = false
  }

  let pushed = false
  try {
    await git(worktreePath, ['push'])
    pushed = true
  } catch {
    pushed = false
  }

  return { committed, pushed, message }
}

export { git as runGit }
