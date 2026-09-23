import { existsSync } from 'fs'
import path from 'path'
import type Store from 'electron-store'
import type { BoardState, VibeFlowState } from './store'

export interface RecentProject {
  path: string
  /** basename(path) — the identity used to recognise a project that moved. */
  name: string
  lastUsedAt: number
}

export interface RecentProjectEntry extends RecentProject {
  /** The recorded folder no longer exists (moved, renamed or deleted). */
  missing: boolean
}

const MAX_RECENT_PROJECTS = 20

type PathExists = (p: string) => boolean

/**
 * Record `projectPath` as the most recently used project. A same-named entry
 * whose folder is gone is treated as this project having moved and is replaced;
 * a same-named entry that still exists is a different project and is kept.
 */
export function rememberProject(
  list: RecentProject[],
  projectPath: string,
  now: number,
  exists: PathExists = existsSync
): RecentProject[] {
  const name = path.basename(projectPath)
  const rest = list.filter(
    (p) => p.path !== projectPath && !(p.name === name && !exists(p.path))
  )
  return [{ path: projectPath, name, lastUsedAt: now }, ...rest].slice(0, MAX_RECENT_PROJECTS)
}

/** Seed the list from projects the board's cards already use, newest first. */
export function recentProjectsFromBoard(board: BoardState): RecentProject[] {
  const byPath = new Map<string, RecentProject>()
  for (const task of [...board.backlog, ...board.in_progress, ...board.done]) {
    if (!task.projectPath) continue
    const lastUsedAt = task.createdAt ?? 0
    const prev = byPath.get(task.projectPath)
    if (!prev || prev.lastUsedAt < lastUsedAt) {
      byPath.set(task.projectPath, {
        path: task.projectPath,
        name: path.basename(task.projectPath),
        lastUsedAt,
      })
    }
  }
  return Array.from(byPath.values())
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
    .slice(0, MAX_RECENT_PROJECTS)
}

export function listRecentProjects(
  store: Store<VibeFlowState>,
  exists: PathExists = existsSync
): RecentProjectEntry[] {
  return (store.get('recentProjects') ?? []).map((p) => ({ ...p, missing: !exists(p.path) }))
}

export function recordRecentProject(store: Store<VibeFlowState>, projectPath: string): void {
  store.set(
    'recentProjects',
    rememberProject(store.get('recentProjects') ?? [], projectPath, Date.now())
  )
}
