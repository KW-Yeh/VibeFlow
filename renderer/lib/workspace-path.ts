import type { Workspace } from '@/lib/types'

function isWindowsLikePath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.includes('\\')
}

export function basenameFromPath(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

export function defaultWorkspacePath(projectPath: string): string {
  const slug = basenameFromPath(projectPath).trim().toLowerCase().replace(/\s+/g, '_')
  const parent = projectPath.replace(/[/\\][^/\\]+[/\\]?$/, '')
  return `${parent}/${slug}-workspace`
}

export function normalizePathForWorkspaceCompare(path: string): string {
  const windowsLike = isWindowsLikePath(path)
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  return windowsLike ? normalized.toLowerCase() : normalized
}

export function sameWorkspacePath(a: string, b: string): boolean {
  return normalizePathForWorkspaceCompare(a) === normalizePathForWorkspaceCompare(b)
}

export function findWorkspaceForProject(projectPath: string, workspaces: Workspace[]): Workspace | undefined {
  const workspacePath = defaultWorkspacePath(projectPath)
  return workspaces.find((workspace) => sameWorkspacePath(workspace.path, workspacePath))
}
