import { useRef, type KeyboardEvent } from 'react'
import { ViewTabs, type BoardView } from '@/components/ui/view-tabs'
import { GithubView } from '@/components/github-view'
import { JiraPanel, type JiraProject } from '@/components/jira-panel'
import type { GithubFilters } from '@/lib/github-filter'
import type { JiraFilters } from '@/lib/jira-filter'
import type { GithubInbox, GithubItem, JiraInbox, JiraTicket } from '@/lib/types'
import { cn } from '@/lib/utils'

export type InboxTab = 'jira' | 'issues' | 'prs'
const TABS: { id: InboxTab; label: string }[] = [
  { id: 'jira', label: 'Jira' }, { id: 'issues', label: 'Issues' }, { id: 'prs', label: 'Pull Requests' },
]

export function InboxView({ view, onViewChange, tab, onTabChange, jira, github, jiraFilters, onJiraFiltersChange, githubFilters, onGithubFiltersChange, jiraCards, githubCards, projects, onBrowseProject, onCreateJira, onConvertGithub, onOpenTask, onOpenSettings }: {
  view: BoardView
  onViewChange: (view: BoardView) => void
  tab: InboxTab
  onTabChange: (tab: InboxTab) => void
  jira: { inbox: JiraInbox | null; loading: boolean; error: string | null; refresh: () => void }
  github: { inbox: GithubInbox | null; loading: boolean; error: string | null; refresh: () => void }
  jiraFilters: JiraFilters
  onJiraFiltersChange: (filters: JiraFilters) => void
  githubFilters: Record<'issues' | 'prs', GithubFilters>
  onGithubFiltersChange: (kind: 'issues' | 'prs', filters: GithubFilters) => void
  jiraCards: Map<string, string>
  githubCards: Map<string, string>
  projects: JiraProject[]
  onBrowseProject: () => Promise<string | null>
  onCreateJira: (ticket: JiraTicket, projectPath: string) => Promise<string>
  onConvertGithub: (item: GithubItem, projectPath: string) => Promise<string>
  onOpenTask: (taskId: string) => void
  onOpenSettings: () => void
}) {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const counts = {
    jira: jira.inbox?.status === 'ok' ? jira.inbox.tickets.length : null,
    issues: github.inbox?.status === 'ok' ? github.inbox.repos.reduce((n, repo) => n + repo.issues.length, 0) : null,
    prs: github.inbox?.status === 'ok' ? github.inbox.repos.reduce((n, repo) => n + repo.prs.length, 0) : null,
  }
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!direction) return
    event.preventDefault()
    const next = (index + direction + TABS.length) % TABS.length
    tabRefs.current[next]?.focus()
    onTabChange(TABS[next].id)
  }
  return <div className="flex h-full min-h-0 flex-col bg-background">
    <div className="flex h-12 shrink-0 items-center border-b border-border px-5"><ViewTabs value={view} onChange={onViewChange} /></div>
    <div role="tablist" aria-label="來源" className="flex h-10 shrink-0 items-stretch gap-5 border-b border-border px-5">
      {TABS.map((entry, index) => <button key={entry.id} ref={(node) => { tabRefs.current[index] = node }} type="button" role="tab"
        aria-selected={tab === entry.id} tabIndex={tab === entry.id ? 0 : -1} onKeyDown={(event) => move(event, index)} onClick={() => onTabChange(entry.id)}
        className={cn('-mb-px flex items-center gap-1.5 border-b-2 px-1 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50', tab === entry.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
        {entry.label}{counts[entry.id] !== null && <span className="text-xs tabular-nums text-muted-foreground/80">{counts[entry.id]}</span>}
      </button>)}
    </div>
    {tab === 'jira' ? <JiraPanel {...jira} filters={jiraFilters} onFiltersChange={onJiraFiltersChange} onRefresh={jira.refresh}
      boardCards={jiraCards} projects={projects} onCreate={onCreateJira} onOpenTask={onOpenTask} onOpenSettings={onOpenSettings} />
      : <GithubView view={view} onViewChange={onViewChange} inbox={github.inbox} loading={github.loading} error={github.error}
        onRefresh={github.refresh} filters={githubFilters[tab]} onFiltersChange={(filters) => onGithubFiltersChange(tab, filters)}
        boardCards={githubCards} onConvert={onConvertGithub} onOpenTask={onOpenTask} onOpenSettings={onOpenSettings}
        projects={projects} onBrowseProject={onBrowseProject} sourceKind={tab} embedded />}
  </div>
}
