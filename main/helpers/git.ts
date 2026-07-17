import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs/promises'
import { PLAN_FILE, PROGRESS_FILE } from './progress'
import { SUBAGENTS_DIR } from './subagents'
import { execEnv } from './env'
import { ATTACHMENTS_DIR } from './attachments'

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

  // If there is already at least one commit, we are done.
  try {
    await git(projectPath, ['rev-parse', '--verify', 'HEAD'])
    return
  } catch {
    // no commits yet — create the initial one
  }

  // An empty initial commit is enough for `worktree add` to branch from. Use
  // inline -c overrides so the commit succeeds even when the user's git identity
  // is not configured, without touching their global git config.
  await git(projectPath, [
    '-c', 'user.name=VibeFlow',
    '-c', 'user.email=vibeflow@local',
    '-c', 'commit.gpgsign=false',
    'commit',
    '--allow-empty',
    '-m', 'chore: initialize repository',
  ])
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
  // The planning artifact is temporary — exclude so git add -A can't commit it.
  await appendLineIfMissing(
    path.join(infoDir, 'exclude'),
    PLAN_FILE,
    '# VibeFlow planning artifact (runtime-only)',
    { mkdir: true }
  )
  await appendLineIfMissing(
    path.join(infoDir, 'exclude'),
    `${ATTACHMENTS_DIR}/`,
    '# VibeFlow task attachments (runtime-only)',
    { mkdir: true }
  )
}

export interface ProvisionResult {
  branch: string
  /** Absolute path of the created worktree. */
  worktreePath: string
  pushed: boolean
  baseBranch: string
}

/** Worktree directory name for a branch — `/` flattened so the directory
 *  sits directly under the workspace folder (e.g. feature/WR-4832 → feature-WR-4832). */
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
  workspacePath: string,
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
    .access(path.join(workspacePath, worktreeDirName(preferredBranch)))
    .then(() => true)
    .catch(() => false)
  if (dirTaken || (await branchExists(projectPath, preferredBranch))) {
    return `${preferredBranch}-${taskId}`
  }
  return preferredBranch
}

/**
 * Runtime-only VibeFlow artifacts that must never be carried over from the
 * source project into a new worktree — each task starts these fresh. They
 * live in `.git/info/exclude` (see `ensureLocalExclude`), so `git ls-files
 * --ignored` would otherwise happily include them.
 */
const RUNTIME_ARTIFACT_DENYLIST = new Set([PROGRESS_FILE, PLAN_FILE, SUBAGENTS_DIR])
const MAX_IGNORED_COPY_BYTES = 10 * 1024 * 1024
const MAX_IGNORED_COPY_FILES = 200

const HEAVY_IGNORED_DIR_NAMES = new Set([
  '.cache',
  '.gradle',
  '.next',
  '.nuxt',
  '.parcel-cache',
  '.svelte-kit',
  '.turbo',
  '.venv',
  'app',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'target',
  'vendor',
])

const BACKGROUND_DEPENDENCY_DIR_NAMES = new Set([
  '.venv',
  'node_modules',
  'vendor',
])

function ignoredEntryHasPart(entry: string, names: Set<string>): boolean {
  return entry
    .split(/[\\/]+/)
    .some((part) => names.has(part))
}

function shouldSkipForegroundIgnoredEntry(entry: string): boolean {
  return ignoredEntryHasPart(entry, HEAVY_IGNORED_DIR_NAMES)
}

function shouldCopyIgnoredEntryInBackground(entry: string): boolean {
  return ignoredEntryHasPart(entry, BACKGROUND_DEPENDENCY_DIR_NAMES)
}

async function ignoredEntryFitsCopyBudget(src: string): Promise<boolean> {
  let bytes = 0
  let files = 0
  const stack = [src]

  while (stack.length > 0) {
    const current = stack.pop()!
    const stat = await fs.lstat(current)
    if (stat.isSymbolicLink()) continue
    if (stat.isDirectory()) {
      const children = await fs.readdir(current, { withFileTypes: true })
      files += children.length
      if (files > MAX_IGNORED_COPY_FILES) return false
      for (const child of children) stack.push(path.join(current, child.name))
      continue
    }
    files += 1
    bytes += stat.size
    if (bytes > MAX_IGNORED_COPY_BYTES || files > MAX_IGNORED_COPY_FILES) {
      return false
    }
  }

  return true
}

/**
 * Best-effort list of git-ignored/untracked paths that might be copied into a
 * freshly created worktree. Shared by the foreground small-file copy and the
 * background dependency copy.
 */
async function listIgnoredCopyEntries(projectPath: string): Promise<string[]> {
  let listing: string
  try {
    listing = await git(projectPath, [
      'ls-files',
      '--others',
      '--ignored',
      '--exclude-standard',
      '--directory',
    ])
  } catch (err) {
    console.error('Failed to list ignored files for worktree copy:', err)
    return []
  }

  return listing
    .split('\n')
    .map((line) => line.replace(/\/$/, '').trim())
    .filter((entry) => entry && !entry.startsWith('.git') && !RUNTIME_ARTIFACT_DENYLIST.has(entry))
    .filter((entry, index, all) => all.indexOf(entry) === index)
}

async function copyIgnoredEntry(
  projectPath: string,
  worktreePath: string,
  entry: string
): Promise<void> {
  const src = path.join(projectPath, entry)
  const dest = path.join(worktreePath, entry)
  await fs.mkdir(path.dirname(dest), { recursive: true })
  await fs.cp(src, dest, { recursive: true })
}

/**
 * Best-effort copy of small git-ignored/untracked files (for example `.env`)
 * from the source project into a freshly created worktree. Heavy dependency
 * folders and build caches are intentionally skipped: copying `node_modules`,
 * `.next`, `dist`, `.venv`, etc. can dominate task creation time and make the
 * app look stuck while the actual git worktree is already ready. Dependency
 * folders can be copied later by `copyIgnoredDependenciesInBackground`.
 *
 * Best-effort throughout: a missing git command, an unreadable path, or a
 * skipped large entry never fails provisioning — it just means the worktree may
 * need its own install/build step before those generated files exist.
 */
async function copySmallIgnoredFiles(
  projectPath: string,
  worktreePath: string
): Promise<void> {
  const entries = await listIgnoredCopyEntries(projectPath)

  await Promise.all(
    entries.map(async (entry) => {
      const src = path.join(projectPath, entry)
      try {
        if (shouldSkipForegroundIgnoredEntry(entry)) return
        if (!(await ignoredEntryFitsCopyBudget(src))) return
        await copyIgnoredEntry(projectPath, worktreePath, entry)
      } catch (err) {
        console.error(`Failed to copy ignored path "${entry}" into worktree:`, err)
      }
    })
  )
}

/**
 * Copy dependency directories in the background after task creation has already
 * returned to the UI. This preserves the convenience of pre-warmed worktrees
 * without making users wait on large filesystem copies during creation.
 */
function copyIgnoredDependenciesInBackground(
  projectPath: string,
  worktreePath: string
): void {
  void (async () => {
    const entries = (await listIgnoredCopyEntries(projectPath))
      .filter(shouldCopyIgnoredEntryInBackground)

    for (const entry of entries) {
      try {
        await copyIgnoredEntry(projectPath, worktreePath, entry)
      } catch (err) {
        console.error(`Failed to background-copy ignored path "${entry}" into worktree:`, err)
      }
    }
  })()
}

/**
 * Create an isolated worktree for a task under `<workspacePath>/<branch-dir>` on
 * a new branch, and (when a remote exists) push the branch upstream. The branch
 * is named from `preferredBranch` (e.g. feature/WR-4832, fix/WCL260522-0002,
 * feature/<title-slug>) when given, otherwise the legacy `vf-<taskId>`. The
 * worktree lives outside the project tree, so the project's .gitignore is left
 * untouched.
 */
export async function provisionWorktree(
  projectPath: string,
  workspacePath: string,
  taskId: string,
  baseBranch: string | null,
  preferredBranch?: string | null
): Promise<ProvisionResult> {
  await ensureLocalExclude(projectPath)

  const branch = await resolveBranchName(projectPath, workspacePath, taskId, preferredBranch)
  const worktreePath = path.join(workspacePath, worktreeDirName(branch))

  const info = await getGitInfo(projectPath)
  const base = baseBranch || info.defaultBase || info.currentBranch || 'HEAD'

  // Prefer origin/<base> as the start point when it exists on the remote.
  // Pull the local base branch first so history is up-to-date before branching.
  let startPoint = base
  if (info.hasRemote) {
    try {
      // `<base>:<base>` fast-forwards the local branch too; fails safely if it's
      // currently checked out or has diverged — plain fetch covers that case.
      await git(projectPath, ['fetch', 'origin', `${base}:${base}`])
    } catch {
      try {
        await git(projectPath, ['fetch', 'origin', base])
      } catch {
        // offline — fall back to local cache
      }
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
      worktreePath,
      startPoint,
    ])
  } catch (err) {
    // `worktree add` can fail AFTER creating the dir + branch (e.g. a failing
    // post-checkout hook), leaving orphans that clutter the repo. Roll back the
    // partial state before surfacing the error.
    await removeWorktree(projectPath, worktreePath)
    await deleteBranch(projectPath, branch)
    throw err
  }

  const [pushed] = await Promise.all([
    (async () => {
      if (!info.hasRemote) return false
      try {
        await git(worktreePath, ['push', '-u', 'origin', branch])
        return true
      } catch {
        return false
      }
    })(),
    copySmallIgnoredFiles(projectPath, worktreePath),
  ])

  copyIgnoredDependenciesInBackground(projectPath, worktreePath)

  return { branch, worktreePath, pushed, baseBranch: base }
}

/**
 * Remove a task's worktree directory and prune stale worktree metadata.
 * `worktreePath` is the absolute path recorded on the task (now a sibling
 * workspace folder; legacy tasks pass their old `.vibeflow/<dir>` path).
 */
export async function removeWorktree(
  projectPath: string,
  worktreePath: string
): Promise<void> {
  try {
    await git(projectPath, ['worktree', 'remove', '--force', worktreePath])
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

  type Entry = { status: string; path: string }
  // Use a Map so dirty-status entries (working tree) override committed entries
  // for the same file — giving priority to the most up-to-date state.
  const entryMap = new Map<string, Entry>()

  function parseNameStatus(output: string): void {
    for (const line of output.split('\n').map((l) => l.trim()).filter(Boolean)) {
      const parts = line.split('\t')
      const code = parts[0]?.[0] ?? 'M'
      // For renames (R100\told\tnew) use the new path.
      const filePath = parts[parts.length - 1]
      entryMap.set(filePath, { status: code, path: filePath })
    }
  }

  // 1. Committed changes on the feature branch vs base (merge-base diff).
  parseNameStatus(
    await git(worktreePath, ['diff', '--name-status', `${baseRef}...HEAD`]).catch(() => '')
  )

  // 2. Working-tree changes not yet committed (staged + unstaged).
  //    These override committed entries so the viewer shows the latest content.
  parseNameStatus(
    await git(worktreePath, ['diff', '--name-status', 'HEAD']).catch(() => '')
  )

  // 3. Untracked files (not yet added).
  const untracked = await git(worktreePath, [
    'ls-files',
    '--others',
    '--exclude-standard',
  ]).catch(() => '')
  for (const p of untracked.split('\n').map((l) => l.trim()).filter(Boolean)) {
    if (!entryMap.has(p)) entryMap.set(p, { status: '?', path: p })
  }

  const entries = Array.from(entryMap.values())

  // The agent-maintained progress file, plan file, and sub-agent event log are
  // VibeFlow metadata, not changes to review — keep them out of the diff viewer.
  const limited = entries
    .filter(
      (e) =>
        e.path !== PROGRESS_FILE &&
        e.path !== PLAN_FILE &&
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
      // Prefer working-tree content so uncommitted modifications are visible.
      // Fall back to HEAD for files that exist in git but are absent on disk.
      try {
        newValue = await fs.readFile(path.join(worktreePath, entry.path), 'utf8')
      } catch {
        newValue = await git(worktreePath, ['show', `HEAD:${entry.path}`]).catch(() => '')
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

export interface PrStatus {
  url: string
  number: number
  state: string
}

/**
 * Check whether a PR already exists for the current branch using the `gh` CLI.
 * Returns null when there is no PR or `gh` is not available.
 */
export async function getPrStatus(worktreePath: string): Promise<PrStatus | null> {
  try {
    const { stdout } = await pexec(
      'gh',
      ['pr', 'view', '--json', 'url,number,state'],
      { cwd: worktreePath, env: execEnv() }
    )
    const parsed = JSON.parse(stdout.toString().trim()) as PrStatus
    if (parsed.url) return parsed
    return null
  } catch {
    return null
  }
}

/**
 * Build the GitHub compare URL for creating a new PR from this branch.
 * Parses the remote URL to derive the GitHub base URL, then appends
 * `/compare/<base>...<branch>?expand=1`.
 */
export async function getGithubCompareUrl(
  worktreePath: string,
  baseBranch: string
): Promise<string | null> {
  try {
    const remoteUrl = await git(worktreePath, ['remote', 'get-url', 'origin'])
    const branch = await git(worktreePath, ['rev-parse', '--abbrev-ref', 'HEAD'])

    // Normalize SSH and HTTPS remote URLs to https://github.com/<owner>/<repo>
    let webUrl: string
    const sshMatch = remoteUrl.match(/git@github\.com:(.+?)(?:\.git)?$/)
    const httpsMatch = remoteUrl.match(/https?:\/\/github\.com\/(.+?)(?:\.git)?$/)
    if (sshMatch) {
      webUrl = `https://github.com/${sshMatch[1]}`
    } else if (httpsMatch) {
      webUrl = `https://github.com/${httpsMatch[1]}`
    } else {
      return null
    }

    return `${webUrl}/compare/${baseBranch}...${branch}?expand=1`
  } catch {
    return null
  }
}

/**
 * Commit message guidelines embedded from the internal engineering standard.
 * Format: [What] one-liner → [Why] motivation → [How] implementation list.
 */
const COMMIT_MESSAGE_GUIDELINES = `
Commit message format:

[What] <imperative, capitalized, concise title — e.g. "Fix project item RWD issue">

[Why] <one sentence explaining why this change was needed>

[How]
- <implementation detail 1>
- <implementation detail 2>

Rules:
- Use imperative tone in the title (Fix, Add, Refactor, Update), never past tense.
- Never skip [What], [Why], or [How].
- No vague reasons like "for update" or "just fixing stuff".
- Keep the [What] title concise and specific.
`.trim()

/**
 * Use the specified agent CLI to generate a commit message for the changes on
 * the feature branch compared to the base. Falls back gracefully when the CLI
 * is unavailable or non-zero exits.
 */
export async function generateCommitMessage(
  worktreePath: string,
  baseBranch: string,
  agentCli: string = 'claude'
): Promise<string> {
  const baseRef = await resolveBaseRef(worktreePath, baseBranch)

  const [diffStat, commits] = await Promise.all([
    git(worktreePath, ['diff', '--stat', `${baseRef}...HEAD`]).catch(() => ''),
    git(worktreePath, ['log', '--oneline', `${baseRef}...HEAD`]).catch(() => ''),
  ])

  if (!diffStat.trim() && !commits.trim()) {
    throw new Error('目前沒有相對於 base branch 的提交變更，無法產生 commit message。')
  }

  const prompt = [
    `You are a senior engineer. Generate a commit message following these guidelines:\n\n${COMMIT_MESSAGE_GUIDELINES}`,
    '',
    `Changed files summary:\n${diffStat || '(no stat)'}`,
    '',
    `Commits on this branch:\n${commits || '(none)'}`,
    '',
    'Output ONLY the commit message text, nothing else. Start directly with [What].',
  ].join('\n')

  const cliFlags: Record<string, string[]> = {
    claude: ['-p'],
    codex: ['-p'],
    gemini: ['-p'],
  }

  const flags = cliFlags[agentCli] ?? ['-p']
  const bin = agentCli

  const { stdout } = await pexec(bin, [...flags, prompt], {
    cwd: worktreePath,
    maxBuffer: 1 * 1024 * 1024,
    env: execEnv(),
  })

  const result = stdout.toString().trim()
  if (!result) throw new Error(`${agentCli} 回傳空的 commit message`)
  return result
}

export { git as runGit }
