import fs from 'fs'
import path from 'path'

/**
 * Suffix of a task's decision record — the agent's account of what this task
 * decided, as opposed to what it changed (that is TaskOutcome, read from git).
 *
 * It lives in the task's workspace folder (the worktree's parent, shared by
 * every task of the project) named after the worktree folder, so git never sees
 * it, concurrent tasks never collide, and — unlike the worktree and the
 * artifacts directory — it survives completion. A done card must still be able
 * to say why the work went the way it did. Renderer builds the identical path
 * from the same inputs (see renderer/lib/claude.ts taskDecisionsPath) — keep
 * both in sync.
 */
export const DECISIONS_FILE_SUFFIX = '.DECISIONS.md'

/** Preview cap, so a runaway record cannot cross IPC in full. */
const MAX_DECISION_BYTES = 256 * 1024

export interface TaskDecisions {
  /** Absolute path of the record — present whether or not the file exists. */
  path: string
  /** File content; null when the agent has not written one yet. */
  markdown: string | null
  /** Epoch ms of the last write; absent when there is no file. */
  updatedAt?: number
  /** True when `markdown` was cut at MAX_DECISION_BYTES. */
  truncated?: boolean
}

/**
 * The workspace-folder name a task's runtime files are keyed by. The worktree
 * directory is the source of truth while it exists; completing a task clears
 * `worktreePath`, so the branch — which is kept — has to reproduce the same
 * name (see worktreeDirName in git.ts).
 */
export function decisionsKey(
  worktreePath: string | undefined,
  branch: string
): string {
  return worktreePath ? path.basename(worktreePath) : branch.replace(/\//g, '-')
}

/** Absolute path of a task's decision record. */
export function decisionsPath(workspacePath: string, key: string): string {
  return path.join(workspacePath, `${key}${DECISIONS_FILE_SUFFIX}`)
}

/** A task's decision record; `markdown: null` when the agent wrote none. */
export function readDecisions(workspacePath: string, key: string): TaskDecisions {
  const target = decisionsPath(workspacePath, key)
  try {
    const stat = fs.statSync(target)
    if (!stat.isFile()) return { path: target, markdown: null }
    const buf = fs.readFileSync(target)
    return {
      path: target,
      markdown: buf.subarray(0, MAX_DECISION_BYTES).toString('utf8'),
      updatedAt: stat.mtimeMs,
      ...(buf.byteLength > MAX_DECISION_BYTES ? { truncated: true } : {}),
    }
  } catch {
    return { path: target, markdown: null }
  }
}

/**
 * Best-effort removal of a task's decision record. Called only when the card
 * itself is deleted — completing a task deliberately keeps the record, which is
 * the whole point of writing it outside the worktree.
 */
export function deleteDecisions(workspacePath: string, key: string): void {
  try {
    fs.rmSync(decisionsPath(workspacePath, key), { force: true })
  } catch {
    // best-effort — a missing file or unlink race must not fail teardown
  }
}
