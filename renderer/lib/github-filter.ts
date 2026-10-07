import type { GithubIssue, GithubItem, GithubPr, GithubRepoInbox } from './types'

/** Values ticked in each filter; an empty list leaves that filter open. */
export interface GithubFilters {
  projects: string[]
  assignees: string[]
  authors: string[]
}

export const EMPTY_GITHUB_FILTERS: GithubFilters = { projects: [], assignees: [], authors: [] }

/** The "nobody assigned" choice. GitHub logins are alphanumerics and hyphens, so `:` never collides. */
export const UNASSIGNED = ':unassigned'

export interface GithubEntry<T extends GithubItem = GithubItem> {
  item: T
  projectName: string
  projectPath: string
}

export interface GithubFilterOptions {
  projects: string[]
  assignees: string[]
  authors: string[]
}

export function hasGithubFilters(filters: GithubFilters): boolean {
  return filters.projects.length > 0 || filters.assignees.length > 0 || filters.authors.length > 0
}

export function toggleValue(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

const byName = (a: string, b: string) => a.localeCompare(b)

/** A ticked value stays listed after a refresh drops it, so it can still be unticked. */
function choices(seen: Iterable<string>, ticked: string[]): string[] {
  return Array.from(new Set([...seen, ...ticked])).sort(byName)
}

export function githubFilterOptions(repos: GithubRepoInbox[], filters: GithubFilters, kind?: 'issues' | 'prs'): GithubFilterOptions {
  const items: GithubItem[] = repos.flatMap((r) => kind ? r[kind] : [...r.issues, ...r.prs])
  return {
    projects: choices(
      repos.map((r) => r.projectName),
      filters.projects
    ),
    assignees: [
      UNASSIGNED,
      ...choices(
        items.flatMap((item) => item.assignees.map((u) => u.login)),
        filters.assignees.filter((v) => v !== UNASSIGNED)
      ),
    ],
    authors: choices(
      items.flatMap((item) => (item.author ? [item.author.login] : [])),
      filters.authors
    ),
  }
}

/** OR within a filter, AND across filters. */
export function matchesGithubFilters(entry: GithubEntry, filters: GithubFilters): boolean {
  const { item, projectName } = entry
  const { projects, assignees, authors } = filters
  if (projects.length && !projects.includes(projectName)) return false
  if (assignees.length) {
    const hit =
      item.assignees.length === 0
        ? assignees.includes(UNASSIGNED)
        : item.assignees.some((u) => assignees.includes(u.login))
    if (!hit) return false
  }
  if (authors.length && !(item.author && authors.includes(item.author.login))) return false
  return true
}

/** Grouped by project, highest number first within a project. */
export function compareByProjectThenNumber(a: GithubEntry, b: GithubEntry): number {
  return byName(a.projectName, b.projectName) || b.item.number - a.item.number
}

export function githubEntries(repos: GithubRepoInbox[], kind: 'issues', filters: GithubFilters): GithubEntry<GithubIssue>[]
export function githubEntries(repos: GithubRepoInbox[], kind: 'prs', filters: GithubFilters): GithubEntry<GithubPr>[]
export function githubEntries(
  repos: GithubRepoInbox[],
  kind: 'issues' | 'prs',
  filters: GithubFilters
): GithubEntry[] {
  return repos
    .flatMap((r) => {
      const items: GithubItem[] = r[kind]
      return items.map((item) => ({ item, projectName: r.projectName, projectPath: r.projectPath }))
    })
    .filter((entry) => matchesGithubFilters(entry, filters))
    .sort(compareByProjectThenNumber)
}
