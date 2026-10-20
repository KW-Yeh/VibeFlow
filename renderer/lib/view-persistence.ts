import type { BoardView } from '@/components/ui/view-tabs'
import type { TerminalTab } from '@/components/terminal-tab-bar'
import type { InboxTab } from '@/components/inbox-view'
import type { JiraScope } from '@/lib/types'
import { EMPTY_GITHUB_FILTERS, type GithubFilters } from '@/lib/github-filter'

// Where the user was survives a reload: the view and card in the URL (so the
// address names them), the rest per browser. Anything unreadable falls back
// to the defaults instead of breaking the page.

const VIEWS: BoardView[] = ['board', 'github', 'terminals']
const INBOX_TABS: InboxTab[] = ['jira', 'issues', 'prs']
const TABS_KEY = 'vibeflow:terminal-tabs'
const INBOX_TAB_KEY = 'vibeflow:inbox-tab'
const FILTERS_KEY = 'vibeflow:github-filters'
const JIRA_SCOPE_KEY = 'vibeflow:jira-scope'

export type GithubFilterState = Record<'issues' | 'prs', GithubFilters>

export function readViewUrl(): { view: BoardView; taskId: string | null } {
  const params = new URLSearchParams(window.location.search)
  const view = params.get('view') as BoardView | null
  return {
    view: view && VIEWS.includes(view) ? view : 'board',
    taskId: params.get('task') || null,
  }
}

/** Replace, not push: switching views is not navigation the back button should step through. */
export function writeViewUrl(view: BoardView, taskId: string | null): void {
  const url = new URL(window.location.href)
  if (view === 'board') url.searchParams.delete('view')
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

export function readTerminalTabs(): TerminalTab[] {
  const value = read(TABS_KEY)
  if (!Array.isArray(value)) return []
  return value.filter((t): t is TerminalTab =>
    Boolean(t) && typeof t.taskId === 'string' && typeof t.preview === 'boolean')
}

export const writeTerminalTabs = (tabs: TerminalTab[]) => write(TABS_KEY, tabs)

export function readInboxTab(): InboxTab | null {
  const value = read(INBOX_TAB_KEY)
  return INBOX_TABS.includes(value as InboxTab) ? (value as InboxTab) : null
}

export const writeInboxTab = (tab: InboxTab | null) => write(INBOX_TAB_KEY, tab)

export function readJiraScope(): JiraScope {
  const value = read(JIRA_SCOPE_KEY)
  return value === 'sprint' || value === 'all' ? value : 'current'
}

export const writeJiraScope = (scope: JiraScope) => write(JIRA_SCOPE_KEY, scope)

function readFilters(value: unknown): GithubFilters {
  const v = (value ?? {}) as Partial<Record<keyof GithubFilters, unknown>>
  return {
    projects: isStrings(v.projects) ? v.projects : EMPTY_GITHUB_FILTERS.projects,
    assignees: isStrings(v.assignees) ? v.assignees : EMPTY_GITHUB_FILTERS.assignees,
    authors: isStrings(v.authors) ? v.authors : EMPTY_GITHUB_FILTERS.authors,
  }
}

export function readGithubFilters(): GithubFilterState {
  const value = (read(FILTERS_KEY) ?? {}) as Partial<Record<'issues' | 'prs', unknown>>
  return { issues: readFilters(value.issues), prs: readFilters(value.prs) }
}

export const writeGithubFilters = (filters: GithubFilterState) => write(FILTERS_KEY, filters)
