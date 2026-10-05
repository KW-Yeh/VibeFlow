import fs from 'fs'
import path from 'path'

/**
 * Legacy: tasks launched before the spec tab replaced it were told to keep a
 * `<key>.DECISIONS.md` in the workspace folder. Nothing writes or reads it any
 * more; it is only removed with its card, so old boards do not leave orphans
 * behind in the user's workspace.
 */
const DECISIONS_FILE_SUFFIX = '.DECISIONS.md'

/**
 * The workspace-folder name the record was keyed by. The worktree directory is
 * the source of truth while it exists; completing a task clears
 * `worktreePath`, so the branch — which is kept — has to reproduce the same
 * name (see worktreeDirName in git.ts).
 */
export function decisionsKey(
  worktreePath: string | undefined,
  branch: string
): string {
  return worktreePath ? path.basename(worktreePath) : branch.replace(/\//g, '-')
}

export function decisionsPath(workspacePath: string, key: string): string {
  return path.join(workspacePath, `${key}${DECISIONS_FILE_SUFFIX}`)
}

/** Best-effort removal of a legacy decision record. */
export function deleteDecisions(workspacePath: string, key: string): void {
  try {
    fs.rmSync(decisionsPath(workspacePath, key), { force: true })
  } catch {
    // best-effort — a missing file or unlink race must not fail teardown
  }
}
