import type { BoardView } from '@/components/ui/view-tabs'
import type { InboxTab } from '@/components/inbox-view'
import type { JiraScope } from '@/lib/types'
import { EMPTY_GITHUB_FILTERS, type GithubFilters } from '@/lib/github-filter'

// Where the user was survives a reload: the view and card in the URL (so the
// address names them), the rest per browser. Anything unreadable falls back
// to the defaults instead of breaking the page.

const VIEWS: BoardView[] = ['board', 'workspace', 'github', 'terminals']
const INBOX_TABS: InboxTab[] = ['jira', 'issues', 'prs']
const WORKSPACE_RAIL_KEY = 'vibeflow:workspace-rail'
// The board/workspace split and the workspace tab bar are gone; their saved state is dead weight.
const RETIRED_KEYS = ['vibeflow:terminal-tabs', 'vibeflow:board-split-px']
const INBOX_TAB_KEY = 'vibeflow:inbox-tab'
const FILTERS_KEY = 'vibeflow:github-filters'
const JIRA_SCOPE_KEY = 'vibeflow:jira-scope'
const DIFF_VIEW_KEY = 'vibeflow:diff-view'

export type GithubFilterState = Record<'issues' | 'prs', GithubFilters>

export function readViewUrl(): { view: BoardView; taskId: string | null } {
  const params = new URLSearchParams(window.location.search)
  const view = params.get('view') as BoardView | null
  const taskId = params.get('task') || null
  if (view && VIEWS.includes(view)) return { view, taskId }
  // Before the workspace had its own page, a card with no view named meant "show this card's workspace".
  return { view: taskId ? 'workspace' : 'board', taskId }
}

/** Replace, not push: switching views is not navigation the back button should step through. */
export function writeViewUrl(view: BoardView, taskId: string | null): void {
  const url = new URL(window.location.href)
  // The board keeps a bare address only without a card: a bare `?task=` now opens the workspace.
  if (view === 'board' && !taskId) url.searchParams.delete('view')
  else url.searchParams.set('view', view)
  if (taskId) url.searchParams.set('task', taskId)
  else url.searchParams.delete('task')
  if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url)
}

function read(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key)
    return raw === null ? null : JSON.parse(raw)
  } catch {
    return null
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage full or blocked: the page still works, it just forgets.
  }
}

const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === 'string')

export function clearRetiredKeys(): void {
  for (const key of RETIRED_KEYS) {
    try {
      window.localStorage.removeItem(key)
    } catch {
      // Blocked storage has nothing to clear.
    }
  }
}

/** null = never toggled; the rail then follows the window width. */
export function readWorkspaceRailCollapsed(): boolean | null {
  const value = read(WORKSPACE_RAIL_KEY)
  return typeof value === 'boolean' ? value : null
}

export const writeWorkspaceRailCollapsed = (collapsed: boolean) => write(WORKSPACE_RAIL_KEY, collapsed)

export function readInboxTab(): InboxTab | null {
  const value = read(INBOX_TAB_KEY)
  return INBOX_TABS.includes(value as InboxTab) ? (value as InboxTab) : null
}

export const writeInboxTab = (tab: InboxTab | null) => write(INBOX_TAB_KEY, tab)

export function readJiraScope(): JiraScope {
  const value = read(JIRA_SCOPE_KEY)
  return value === 'all' ? value : 'sprint'
}

export const writeJiraScope = (scope: JiraScope) => write(JIRA_SCOPE_KEY, scope)

export interface DiffViewPrefs {
  /** Old file on the left, new on the right, rows aligned. */
  split: boolean
  /** Show every unchanged line instead of folding them around the changes. */
  fullContext: boolean
  /** The Git diff tab's list: every changed file, or the branch's commits. */
  groupBy: 'all' | 'commit'
}

export function readDiffView(): DiffViewPrefs {
  const value = read(DIFF_VIEW_KEY)
  const prefs = value && typeof value === 'object' ? (value as Partial<DiffViewPrefs>) : {}
  return {
    split: prefs.split === true,
    fullContext: prefs.fullContext === true,
    groupBy: prefs.groupBy === 'commit' ? 'commit' : 'all',
  }
}

export const writeDiffView = (prefs: DiffViewPrefs) => write(DIFF_VIEW_KEY, prefs)

function readFilters(value: unknown): GithubFilters {
  const v = (value ?? {}) as Partial<Record<keyof GithubFilters, unknown>>
  // Older saves also carry `projects`; that filter became the per-repo columns, so it is dropped.
  return {
    assignees: isStrings(v.assignees) ? v.assignees : EMPTY_GITHUB_FILTERS.assignees,
    authors: isStrings(v.authors) ? v.authors : EMPTY_GITHUB_FILTERS.authors,
  }
}

export function readGithubFilters(): GithubFilterState {
  const value = (read(FILTERS_KEY) ?? {}) as Partial<Record<'issues' | 'prs', unknown>>
  return { issues: readFilters(value.issues), prs: readFilters(value.prs) }
}

export const writeGithubFilters = (filters: GithubFilterState) => write(FILTERS_KEY, filters)
