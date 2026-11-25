import type { TagDef, Task } from './types'

/** Values ticked in each board filter; an empty list leaves that filter open. */
export interface BoardFilters {
  projects: string[]
  tags: string[]
}

export const EMPTY_BOARD_FILTERS: BoardFilters = { projects: [], tags: [] }

/** The "card has no tag" choice. Tag ids are UUIDs, so `:` never collides. */
export const UNTAGGED = ':untagged'

export function projectLabel(task: Task): string {
  if (task.role === 'master') return 'Master'
  if (task.projectName) return task.projectName
  const parts = (task.projectPath ?? '').split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] ?? '未指定專案'
}

export function hasBoardFilters(filters: BoardFilters): boolean {
  return filters.projects.length > 0 || filters.tags.length > 0
}

/** Ticked tags that were deleted since would otherwise hide every card. */
export function liveBoardFilters(filters: BoardFilters, tags: TagDef[]): BoardFilters {
  const ids = new Set(tags.map((t) => t.id))
  return { projects: filters.projects, tags: filters.tags.filter((id) => id === UNTAGGED || ids.has(id)) }
}

export function boardFilterOptions(tasks: Task[], tags: TagDef[], filters: BoardFilters): BoardFilters {
  return {
    // A ticked project stays listed after its last card goes, so it can still be unticked.
    projects: Array.from(new Set([...tasks.map(projectLabel), ...filters.projects])).sort((a, b) => a.localeCompare(b)),
    tags: [...tags.map((t) => t.id), UNTAGGED],
  }
}

/** OR within a filter, AND across filters. */
export function matchesBoardFilters(task: Task, filters: BoardFilters): boolean {
  if (filters.projects.length > 0 && !filters.projects.includes(projectLabel(task))) return false
  if (filters.tags.length > 0) {
    const own = task.tags ?? []
    const hit = own.length === 0 ? filters.tags.includes(UNTAGGED) : own.some((id) => filters.tags.includes(id))
    if (!hit) return false
  }
  return true
}

/**
 * Whether a master card shows, and which of its cards are listed under it:
 * a master that matches itself keeps all of them; one shown only for its cards lists just those.
 */
export function masterMatch<T extends { task: Task }>(
  master: Task,
  slaves: T[],
  filters: BoardFilters
): { visible: boolean; slaves: T[] } {
  if (!hasBoardFilters(filters) || matchesBoardFilters(master, filters)) return { visible: true, slaves }
  const matching = slaves.filter((s) => matchesBoardFilters(s.task, filters))
  return { visible: matching.length > 0, slaves: matching }
}
