import fs from 'fs'
import path from 'path'
import { collectDiffEntries, resolveBaseRef, runGit } from './git'

/**
 * A task's spec is any `spec.md` its branch added or changed — the
 * feature-spec-plan skill writes the high-level decisions there. Specs that
 * already existed on the base and were left alone belong to other work, so
 * they are never shown for this task.
 */
export const SPEC_FILE_NAME = 'spec.md'

/** Preview cap per spec, so a runaway file cannot cross IPC in full. */
const MAX_SPEC_BYTES = 256 * 1024

export interface TaskSpec {
  /** Path relative to the repository root. */
  path: string
  markdown: string
  /** Epoch ms of the last change: file mtime, or commit time once the worktree is gone. */
  updatedAt?: number
  /** True when `markdown` was cut at MAX_SPEC_BYTES. */
  truncated?: boolean
}

function isSpecPath(p: string): boolean {
  return path.posix.basename(p) === SPEC_FILE_NAME
}

function clip(buf: Buffer): Pick<TaskSpec, 'markdown' | 'truncated'> {
  return {
    markdown: buf.subarray(0, MAX_SPEC_BYTES).toString('utf8'),
    ...(buf.byteLength > MAX_SPEC_BYTES ? { truncated: true } : {}),
  }
}

/**
 * Specs of a task whose worktree still exists, read from the working tree so
 * an uncommitted edit shows up while the agent is writing it. Never fetches —
 * it is polled.
 */
export async function readWorktreeSpecs(
  worktreePath: string,
  baseBranch: string
): Promise<TaskSpec[]> {
  const baseRef = await resolveBaseRef(worktreePath, baseBranch)
  const entries = await collectDiffEntries(worktreePath, baseRef)
  const specs: TaskSpec[] = []
  for (const entry of entries) {
    if (entry.status === 'D' || !isSpecPath(entry.path)) continue
    try {
      const full = path.join(worktreePath, entry.path)
      const stat = fs.statSync(full)
      if (!stat.isFile()) continue
      specs.push({ path: entry.path, ...clip(fs.readFileSync(full)), updatedAt: stat.mtimeMs })
    } catch {
      // vanished between listing and reading — the next poll settles it
    }
  }
  return specs.sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * Specs of a completed task. Completion removes the worktree and deletes the
 * local branch, so the spec is looked for where the branch's work still
 * survives, most current first: the local branch (a card completed before the
 * branch was deleted), `origin/<branch>` (pushed, PR not merged yet), then the
 * pull-request merge commit on the base, whose second parent is the branch as
 * it was merged. `changedPaths` is the file list captured at completion; it is
 * preferred over a fresh diff because once the branch is merged into its base,
 * a merge-base diff comes back empty. `launchedAt` bounds the merge search so a
 * reused branch name cannot surface an older task's PR.
 */
export async function readBranchSpecs(
  projectPath: string,
  branch: string,
  baseBranch: string,
  changedPaths?: string[],
  launchedAt?: number
): Promise<TaskSpec[]> {
  for (const ref of [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`]) {
    if (!(await refExists(projectPath, ref))) continue
    const paths =
      changedPaths ??
      (await diffNames(projectPath, `${await resolveBaseRef(projectPath, baseBranch)}...${ref}`))
    const specs = await readSpecsAt(projectPath, ref, paths)
    if (specs.length > 0) return specs
  }
  const merge = await findPullRequestMerge(projectPath, branch, baseBranch, launchedAt)
  if (!merge) return []
  return readSpecsAt(projectPath, `${merge}^2`, await diffNames(projectPath, `${merge}^1`, merge))
}

async function refExists(cwd: string, ref: string): Promise<boolean> {
  try {
    await runGit(cwd, ['rev-parse', '--verify', '--quiet', ref])
    return true
  } catch {
    return false
  }
}

async function diffNames(cwd: string, ...range: string[]): Promise<string[]> {
  const names = await runGit(cwd, ['diff', '--name-only', '--diff-filter=d', ...range]).catch(() => '')
  return names.split('\n').map((l) => l.trim())
}

/**
 * The newest "Merge pull request #N from <owner>/<branch>" commit on the base's
 * first-parent line — GitHub's merge-commit subject. Squash and rebase merges
 * leave no such commit, so their specs cannot be recovered this way.
 */
async function findPullRequestMerge(
  cwd: string,
  branch: string,
  baseBranch: string,
  launchedAt?: number
): Promise<string | null> {
  const baseRef = await resolveBaseRef(cwd, baseBranch)
  const log = await runGit(cwd, [
    'log',
    '--merges',
    '--first-parent',
    '--format=%H %s',
    ...(launchedAt ? [`--since=${new Date(launchedAt).toISOString()}`] : []),
    baseRef,
  ]).catch(() => '')
  for (const line of log.split('\n')) {
    const match = /^(\S+) Merge pull request #\d+ from [^/\s]+\/(\S+)$/.exec(line.trim())
    if (match && match[2] === branch) return match[1]
  }
  return null
}

async function readSpecsAt(cwd: string, ref: string, paths: string[]): Promise<TaskSpec[]> {
  const specs: TaskSpec[] = []
  for (const p of paths.filter(isSpecPath)) {
    try {
      const content = await runGit(cwd, ['show', `${ref}:${p}`])
      const ct = await runGit(cwd, ['log', '-1', '--format=%ct', ref, '--', p])
      specs.push({
        path: p,
        ...clip(Buffer.from(content, 'utf8')),
        ...(ct ? { updatedAt: Number(ct) * 1000 } : {}),
      })
    } catch {
      // unreadable blob — skip it rather than fail the whole tab
    }
  }
  return specs.sort((a, b) => a.path.localeCompare(b.path))
}
