import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs/promises'
import { PROGRESS_FILE } from './progress'
import { buildEnv } from './env'

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
    env: { ...process.env, PATH: buildEnv().PATH },
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

/** Ensure `.vibeflow/` is present in the project's .gitignore. */
export async function ensureGitignore(projectPath: string): Promise<void> {
  const gitignorePath = path.join(projectPath, '.gitignore')
  let content = ''
  try {
    content = await fs.readFile(gitignorePath, 'utf8')
  } catch {
    content = ''
  }
  const entries = content.split('\n').map((l) => l.trim())
  if (entries.includes('.vibeflow/') || entries.includes('.vibeflow')) {
    return
  }
  const prefix = content.length > 0 && !content.endsWith('\n') ? '\n' : ''
  const addition = `${prefix}\n# VibeFlow worktrees\n.vibeflow/\n`
  await fs.writeFile(gitignorePath, content + addition, 'utf8')
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
  const excludePath = path.join(infoDir, 'exclude')
  let content = ''
  try {
    content = await fs.readFile(excludePath, 'utf8')
  } catch {
    content = ''
  }
  const entries = content.split('\n').map((l) => l.trim())
  if (entries.includes(PROGRESS_FILE)) {
    return
  }
  const prefix = content.length > 0 && !content.endsWith('\n') ? '\n' : ''
  const addition = `${prefix}\n# VibeFlow task progress file (runtime-only)\n${PROGRESS_FILE}\n`
  await fs.mkdir(infoDir, { recursive: true })
  await fs.writeFile(excludePath, content + addition, 'utf8')
}

export interface ProvisionResult {
  branch: string
  /** Absolute path of the created worktree. */
  worktreePath: string
  /** Relative path from the project root (e.g. .vibeflow/vf-xxxx). */
  relativePath: string
  pushed: boolean
  baseBranch: string
}

/**
 * Create an isolated worktree for a task under `.vibeflow/vf-<id>` on a new
 * branch `vf-<id>`, and (when a remote exists) push the branch upstream.
 */
export async function provisionWorktree(
  projectPath: string,
  taskId: string,
  baseBranch: string | null
): Promise<ProvisionResult> {
  await ensureGitignore(projectPath)
  await ensureLocalExclude(projectPath)

  const branch = `vf-${taskId}`
  const relativePath = path.join('.vibeflow', branch)
  const worktreePath = path.join(projectPath, relativePath)

  const info = await getGitInfo(projectPath)
  const base = baseBranch || info.defaultBase || info.currentBranch || 'HEAD'

  // Prefer origin/<base> as the start point when it exists on the remote.
  let startPoint = base
  if (info.hasRemote) {
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
    await removeWorktree(projectPath, taskId)
    await deleteBranch(projectPath, taskId)
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

/** Remove a task's worktree directory and prune stale worktree metadata. */
export async function removeWorktree(
  projectPath: string,
  taskId: string
): Promise<void> {
  const branch = `vf-${taskId}`
  const relativePath = path.join('.vibeflow', branch)
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
 * Delete a task's local branch `vf-<taskId>` (best-effort). The branch must not
 * be checked out in any worktree — call this AFTER removeWorktree. The remote
 * branch (if pushed) is intentionally left intact for any open PR / merge.
 */
export async function deleteBranch(
  projectPath: string,
  taskId: string
): Promise<void> {
  const branch = `vf-${taskId}`
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

const MAX_BYTES = 200 * 1024 // per-side content cap for the diff viewer
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

  // The agent-maintained progress file is VibeFlow metadata, not a change to
  // review — keep it out of the diff viewer.
  const limited = entries
    .filter((e) => e.path !== PROGRESS_FILE)
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
  // Stage everything except the agent-maintained progress file (metadata).
  await git(worktreePath, ['add', '-A', '--', '.', `:(exclude)${PROGRESS_FILE}`])

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
