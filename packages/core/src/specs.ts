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
 * Specs of a completed task, read from its branch: completion removes the
 * worktree but keeps the branch, so only what was committed survives.
 * `changedPaths` is the file list captured at completion; it is preferred over
 * a fresh diff because once the branch is merged into its base, a merge-base
 * diff comes back empty.
 */
export async function readBranchSpecs(
  projectPath: string,
  branch: string,
  baseBranch: string,
  changedPaths?: string[]
): Promise<TaskSpec[]> {
  const ref = `refs/heads/${branch}`
  try {
    await runGit(projectPath, ['rev-parse', '--verify', ref])
  } catch {
    return []
  }
  let paths = changedPaths
  if (!paths) {
    const baseRef = await resolveBaseRef(projectPath, baseBranch)
    const names = await runGit(projectPath, [
      'diff',
      '--name-only',
      '--diff-filter=d',
      `${baseRef}...${ref}`,
    ]).catch(() => '')
    paths = names.split('\n').map((l) => l.trim())
  }
  const specs: TaskSpec[] = []
  for (const p of paths.filter(isSpecPath)) {
    try {
      const content = await runGit(projectPath, ['show', `${ref}:${p}`])
      const ct = await runGit(projectPath, ['log', '-1', '--format=%ct', ref, '--', p])
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
