import { AnimatePresence } from 'motion/react'
import { CircleDot, ExternalLink, Layers, Loader2, Plus, RefreshCw, SquareArrowOutUpRight, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { GithubFilterMenu } from '@/components/github-filter-menu'
import { MarkdownContent } from '@/components/markdown-content'
import { Button } from '@/components/ui/button'
import { DialogShell } from '@/components/ui/dialog-shell'
import { IconButton } from '@/components/ui/icon-button'
import { openExternal } from '@/lib/api'
import { JIRA_CATEGORY_CLASS, dueInfo } from '@/lib/jira-display'
import { jiraEntries, jiraStatusOptions, type JiraFilters } from '@/lib/jira-filter'
import { cn } from '@/lib/utils'
import type { JiraInbox, JiraTicket } from '@/lib/types'

export interface JiraProject { path: string; name: string }

export function JiraPanel({ inbox, loading, error, filters, onFiltersChange, onRefresh, boardCards, projects, onCreate, onOpenTask, onOpenSettings }: {
  inbox: JiraInbox | null
  loading: boolean
  error: string | null
  filters: JiraFilters
  onFiltersChange: (next: JiraFilters) => void
  onRefresh: () => void
  boardCards: Map<string, string>
  projects: JiraProject[]
  onCreate: (ticket: JiraTicket, projectPath: string) => Promise<string>
  onOpenTask: (taskId: string) => void
  onOpenSettings: () => void
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [projectPath, setProjectPath] = useState('')
  const [creating, setCreating] = useState(false)
  const [createdTaskId, setCreatedTaskId] = useState<string | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const [duplicate, setDuplicate] = useState(false)
  const tickets = inbox?.tickets ?? []
  const entries = jiraEntries(tickets, filters)
  const selected = entries.find((ticket) => ticket.key === selectedKey)
  const boardTaskId = selected ? boardCards.get(selected.key) : undefined
  const taskId = createdTaskId ?? boardTaskId

  useEffect(() => {
    if (selectedKey && inbox?.status === 'ok' && !selected) setSelectedKey(null)
  }, [selectedKey, selected, inbox?.status])

  const choose = (key: string) => {
    setSelectedKey(key)
    setProjectPath('')
    setCreateError(null)
    setCreatedTaskId(null)
    setDuplicate(false)
  }

  const create = async () => {
    if (!selected || !projectPath || creating) return
    setCreating(true)
    setCreateError(null)
    try {
      const id = await onCreate(selected, projectPath)
      setCreatedTaskId(id)
      setDuplicate(false)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  const notice = (text: string, settings = false) => (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-5 text-center text-sm text-muted-foreground">
      <p className="max-w-md">{text}</p>
      {settings && <Button size="sm" onClick={onOpenSettings}>開啟設定</Button>}
    </div>
  )

  return <div className="flex min-h-0 flex-1 flex-col bg-background">
    <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-5">
      <GithubFilterMenu name="Status" allLabel="所有 Status" icon={Layers}
        options={jiraStatusOptions(tickets, filters)} value={filters.statuses}
        onChange={(statuses) => onFiltersChange({ statuses })} />
      {filters.statuses.length > 0 && <button type="button" onClick={() => onFiltersChange({ statuses: [] })}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <X className="size-3.5" />清除篩選
      </button>}
      <span className="ml-auto min-w-0 truncate text-sm text-muted-foreground">
        {inbox?.email ?? inbox?.site ?? ''}{inbox?.status === 'ok' ? ` · ${entries.length} 筆` : ''}
        {inbox?.fetchedAt ? ` · ${new Date(inbox.fetchedAt).toLocaleTimeString()} 更新` : ''}
      </span>
      <IconButton aria-label="重新整理 Jira ticket" title="重新整理 Jira ticket" onClick={onRefresh} disabled={loading}>
        <RefreshCw className={cn('size-4', loading && 'animate-spin motion-reduce:animate-none')} />
      </IconButton>
    </div>
    {inbox?.error && <div role="alert" className="border-b border-destructive/30 bg-destructive/10 px-5 py-2 text-sm text-destructive">{inbox.error}</div>}
    {inbox?.status === 'acli-missing' ? notice('找不到 Atlassian CLI（acli）。安裝並登入後就能看到指派給你的 Jira ticket。', true)
      : inbox?.status === 'unauthenticated' ? notice('尚未登入 Atlassian。', true)
      : !inbox ? notice(loading ? '讀取 Jira 中…' : error ?? '無法讀取 Jira ticket')
      : inbox.error && tickets.length === 0 ? notice(inbox.error)
      : entries.length === 0 ? notice(filters.statuses.length ? '沒有符合篩選條件的 ticket' : '目前沒有指派給你的 Jira ticket')
      : <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] content-start gap-3">
            {entries.map((ticket) => {
              const due = dueInfo(ticket.dueDate)
              return <button key={ticket.key} type="button" onClick={() => choose(ticket.key)} aria-pressed={ticket.key === selectedKey}
                className={cn('min-h-32 rounded-md border bg-card p-3 text-left outline-none transition-colors hover:border-input focus-visible:ring-[3px] focus-visible:ring-ring/50', ticket.key === selectedKey ? 'border-primary' : 'border-border')}>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CircleDot className="size-3 shrink-0" />
                  <span className="font-mono tabular-nums">{ticket.key}</span>
                  {boardCards.has(ticket.key) && <span className="rounded-xs bg-primary/15 px-1.5 py-0.5 text-primary">已在看板</span>}
                  <span className={cn('ml-auto max-w-[45%] truncate rounded-xs px-1.5 py-0.5', JIRA_CATEGORY_CLASS[ticket.status.category])}>{ticket.status.name}</span>
                </span>
                <span className="mt-2 line-clamp-2 min-h-10 text-[15px] font-medium leading-5">{ticket.summary}</span>
                <span className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{ticket.storyPoints === null ? '— pt' : `◆ ${ticket.storyPoints} pt`}</span>
                  <span title={due.title} className={cn(due.tone === 'overdue' && 'text-destructive', (due.tone === 'soon' || due.tone === 'today') && 'text-warning')}>{due.text}</span>
                </span>
              </button>
            })}
          </div>
        </div>}
    <AnimatePresence>{selected && <DialogShell key={selected.key} title={`${selected.key} ${selected.summary}`} showHeader saving={creating}
      description={`${selected.issueType} · ${selected.status.name}`} onClose={() => setSelectedKey(null)}
      contentClassName="max-w-3xl" bodyClassName="min-h-0"
      footer={<div className="flex w-full flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => void openExternal(selected.url)}><ExternalLink />在 Jira 開啟</Button>
        {createdTaskId && <span className="text-sm text-success">已建立到 Backlog</span>}
        {taskId && !duplicate ? <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" title="已經有對應卡片，仍可再建一張" onClick={() => { setDuplicate(true); setCreatedTaskId(null); setProjectPath('') }}>再建一張</Button>
          <Button size="sm" onClick={() => { setSelectedKey(null); onOpenTask(taskId) }}><SquareArrowOutUpRight />前往卡片</Button>
        </div> : <div className="ml-auto flex flex-wrap items-center gap-2">
          <select aria-label="建立到專案" value={projectPath} onChange={(event) => setProjectPath(event.target.value)} disabled={creating}
            className="h-9 max-w-56 rounded-md border border-input bg-background px-2 text-sm focus-visible:ring-[3px] focus-visible:ring-ring/50">
            <option value="">選擇專案…</option>
            {projects.map((project) => <option key={project.path} value={project.path}>{project.name} · {project.path}</option>)}
          </select>
          <Button size="sm" disabled={!projectPath || creating} title={!projectPath ? '先選擇要建立到哪個專案' : undefined} onClick={() => void create()}>
            {creating ? <Loader2 className="animate-spin" /> : <Plus />}{creating ? '建立中…' : '建立卡片'}
          </Button>
        </div>}
      </div>}>
      <div className="space-y-4">
        <dl className="grid grid-cols-[90px_minmax(0,1fr)] gap-2 text-sm">
          <dt className="text-muted-foreground">狀態</dt><dd>{selected.status.name}</dd>
          <dt className="text-muted-foreground">Story Points</dt><dd>{selected.storyPoints ?? '—'}</dd>
          <dt className="text-muted-foreground">期限</dt><dd>{dueInfo(selected.dueDate).text}</dd>
          <dt className="text-muted-foreground">Sprint</dt><dd>{selected.sprint ?? '—'}</dd>
          <dt className="text-muted-foreground">優先度</dt><dd>{selected.priority ?? '—'}</dd>
          {selected.parentKey && <><dt className="text-muted-foreground">Parent</dt><dd><button type="button" className="text-primary underline focus-visible:ring-[3px] focus-visible:ring-ring/50" onClick={() => void openExternal(`https://${inbox?.site}/browse/${selected.parentKey}`)}>{selected.parentKey}</button></dd></>}
        </dl>
        <div className="border-t border-border pt-4">{selected.description ? <MarkdownContent source={selected.description} compact /> : <p className="text-sm text-muted-foreground">沒有內文</p>}</div>
        {createError && <p role="alert" className="text-sm text-destructive">{createError}</p>}
      </div>
    </DialogShell>}</AnimatePresence>
  </div>
}
