import { AnimatePresence } from 'motion/react'
import { CircleDot, ExternalLink, FolderOpen, Loader2, Paperclip, Plus, RefreshCw, SquareArrowOutUpRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { MarkdownContent } from '@/components/markdown-content'
import { Button } from '@/components/ui/button'
import { DialogShell } from '@/components/ui/dialog-shell'
import { IconButton } from '@/components/ui/icon-button'
import { openExternal } from '@/lib/api'
import { jiraStatusColumns } from '@/lib/jira-columns'
import { JIRA_CATEGORY_CLASS, dueInfo } from '@/lib/jira-display'
import { cn } from '@/lib/utils'
import type { JiraInbox, JiraTicket } from '@/lib/types'

export interface JiraProject { path: string; name: string }

export function JiraPanel({ inbox, loading, error, onRefresh, boardCards, projects, onBrowseProject, onCreate, onOpenTask, onOpenSettings }: {
  inbox: JiraInbox | null
  loading: boolean
  error: string | null
  onRefresh: () => void
  boardCards: Map<string, string>
  projects: JiraProject[]
  onBrowseProject: () => Promise<string | null>
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
  const columns = jiraStatusColumns(tickets)
  const selected = tickets.find((ticket) => ticket.key === selectedKey)
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
      <span className="ml-auto min-w-0 truncate text-sm text-muted-foreground">
        {inbox?.email ?? inbox?.site ?? ''}{inbox?.status === 'ok' ? ` · ${tickets.length} 筆` : ''}
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
      : tickets.length === 0 ? notice('目前沒有指派給你的 Jira ticket')
      : <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          <div className="flex min-h-full w-max max-w-none items-start gap-3">
            {columns.map((column) => <section key={column.name} aria-label={`${column.name}，${column.tickets.length} 筆`}
              className="w-[min(300px,calc(100vw-5.5rem))] shrink-0 rounded-md border border-border bg-muted/20 p-2">
              <h3 className="flex min-w-0 items-center gap-2 px-1 py-1 text-sm font-medium">
                <span className={cn('size-2 shrink-0 rounded-full', column.category === 'new' ? 'bg-muted-foreground' : column.category === 'done' ? 'bg-success' : 'bg-primary')} />
                <span className="min-w-0 truncate" title={column.name}>{column.name}</span>
                <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">{column.tickets.length}</span>
              </h3>
              <div className="mt-2 space-y-2">
              {column.tickets.map((ticket) => {
              const due = dueInfo(ticket.dueDate)
              return <button key={ticket.key} type="button" onClick={() => choose(ticket.key)} aria-pressed={ticket.key === selectedKey}
                className={cn('min-h-32 w-full rounded-md border bg-card p-3 text-left outline-none transition-colors hover:border-input focus-visible:ring-[3px] focus-visible:ring-ring/50', ticket.key === selectedKey ? 'border-primary' : 'border-border')}>
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
            </section>)}
          </div>
        </div>}
    <AnimatePresence>{selected && <DialogShell key={selected.key} title={`${selected.key} ${selected.summary}`} showHeader saving={creating}
      description={`${selected.issueType} · ${selected.status.name}`} onClose={() => setSelectedKey(null)}
      contentClassName="max-w-3xl" bodyClassName="min-h-0"
      footer={<div className="flex w-full flex-wrap items-center gap-2">
        {createdTaskId && <span className="text-sm text-success">已建立到 Backlog</span>}
        {taskId && !duplicate ? <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" title="已經有對應卡片，仍可再建一張" onClick={() => { setDuplicate(true); setCreatedTaskId(null); setProjectPath('') }}>再建一張</Button>
          <Button size="sm" onClick={() => { setSelectedKey(null); onOpenTask(taskId) }}><SquareArrowOutUpRight />前往卡片</Button>
        </div> : <div className="ml-auto flex flex-wrap items-center gap-2">
          <select aria-label="建立到專案" value={projectPath} onChange={(event) => setProjectPath(event.target.value)} disabled={creating}
            className="h-9 max-w-56 rounded-md border border-input bg-background px-2 text-sm focus-visible:ring-[3px] focus-visible:ring-ring/50">
            <option value="">選擇專案…</option>
            {projectPath && !projects.some((project) => project.path === projectPath) && <option value={projectPath}>{projectPath}</option>}
            {projects.map((project) => <option key={project.path} value={project.path}>{project.name} · {project.path}</option>)}
          </select>
          <IconButton aria-label="從資料夾選擇專案" title="從資料夾選擇專案" disabled={creating}
            className="rounded-md border border-border p-2"
            onClick={() => void onBrowseProject().then((path) => { if (path) setProjectPath(path) })}>
            <FolderOpen className="size-4" />
          </IconButton>
          <Button size="sm" disabled={!projectPath || creating} title={!projectPath ? '先選擇要建立到哪個專案' : undefined} onClick={() => void create()}>
            {creating ? <Loader2 className="animate-spin" /> : <Plus />}{creating ? '建立中…' : '建立卡片'}
          </Button>
        </div>}
      </div>}>
      <div className="space-y-4">
        <dl className="grid grid-cols-[90px_minmax(0,1fr)] gap-2 text-sm">
          <dt className="text-muted-foreground">編號</dt><dd><a href={selected.url} target="_blank" rel="noopener noreferrer"
            onClick={(event) => { event.preventDefault(); void openExternal(selected.url) }}
            className="inline-flex items-center gap-1 text-primary underline outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">{selected.key}<ExternalLink className="size-3" /></a></dd>
          <dt className="text-muted-foreground">狀態</dt><dd>{selected.status.name}</dd>
          <dt className="text-muted-foreground">Story Points</dt><dd>{selected.storyPoints ?? '—'}</dd>
          <dt className="text-muted-foreground">期限</dt><dd>{dueInfo(selected.dueDate).text}</dd>
          <dt className="text-muted-foreground">Sprint</dt><dd>{selected.sprint ?? '—'}</dd>
          <dt className="text-muted-foreground">優先度</dt><dd>{selected.priority ?? '—'}</dd>
          {selected.parentKey && <><dt className="text-muted-foreground">Parent</dt><dd><a href={`https://${inbox?.site}/browse/${selected.parentKey}`} target="_blank" rel="noopener noreferrer"
            onClick={(event) => { event.preventDefault(); void openExternal(`https://${inbox?.site}/browse/${selected.parentKey}`) }}
            className="inline-flex items-center gap-1 text-primary underline outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">{selected.parentKey}<ExternalLink className="size-3" /></a></dd></>}
        </dl>
        <div className="border-t border-border pt-4">{selected.description ? <MarkdownContent source={selected.description} compact /> : <p className="text-sm text-muted-foreground">沒有內文</p>}</div>
        {selected.attachments.length > 0 && <section className="border-t border-border pt-4" aria-label="附件">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-medium"><Paperclip className="size-4" />附件 <span className="text-xs tabular-nums text-muted-foreground">{selected.attachments.length}</span></h3>
          <ul className="space-y-1.5">{selected.attachments.map((attachment) => <li key={attachment.id} className="flex min-w-0 items-center gap-2 text-sm">
            <a href={attachment.url} target="_blank" rel="noopener noreferrer" title={attachment.filename}
              onClick={(event) => { event.preventDefault(); void openExternal(attachment.url) }}
              className="min-w-0 truncate text-primary underline outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">{attachment.filename}</a>
            {attachment.size !== null && <span className="shrink-0 text-xs text-muted-foreground">{formatFileSize(attachment.size)}</span>}
          </li>)}</ul>
        </section>}
        {createError && <p role="alert" className="text-sm text-destructive">{createError}</p>}
      </div>
    </DialogShell>}</AnimatePresence>
  </div>
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const unit = bytes < 1024 * 1024 ? 'KB' : bytes < 1024 * 1024 * 1024 ? 'MB' : 'GB'
  const divisor = unit === 'KB' ? 1024 : unit === 'MB' ? 1024 * 1024 : 1024 * 1024 * 1024
  return `${new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 1 }).format(bytes / divisor)} ${unit}`
}
