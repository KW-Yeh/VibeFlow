import { join } from 'path'

/**
 * Per-project folder under the global workstation root: `<root>/<projectName>`.
 * This is a task's `workspacePath` — its worktree and runtime artifact files
 * live directly inside it.
 */
export function projectWorkstationPath(
  workstationRoot: string,
  projectName: string
): string {
  return join(workstationRoot, projectName)
}
