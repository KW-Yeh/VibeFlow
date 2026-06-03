import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs/promises'

const pexec = promisify(execFile)

/** Run a git command in `cwd` and return trimmed stdout. */
async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await pexec('git', args, {
    cwd,
    maxBuffer: 32 * 1024 * 1024,
    env: process.env,
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

  await git(projectPath, [
    'worktree',
    'add',
    '-b',
    branch,
    relativePath,
    startPoint,
  ])

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

export { git as runGit }
