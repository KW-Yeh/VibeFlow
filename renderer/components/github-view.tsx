import {
  CircleDot,
  ExternalLink,
  GitPullRequest,
  GitPullRequestDraft,
  Loader2,
  Layers,
  Plus,
  RefreshCw,
  SquareArrowOutUpRight,
  UserCheck,
  UserPen,
  X,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

import { GithubFilterMenu } from '@/components/github-filter-menu'
import { MarkdownContent } from '@/components/markdown-content'
import { Button } from '@/components/ui/button'
import { DialogShell } from '@/components/ui/dialog-shell'
import { IconButton } from '@/components/ui/icon-button'
import { SECTION_LABEL } from '@/components/ui/section-label'
import { ViewTabs, type BoardView } from '@/components/ui/view-tabs'
import { openExternal } from '@/lib/api'
import {
  absoluteTime,
  GITHUB_STATE_CLASS,
  GITHUB_STATE_LABEL,
  githubItemKey,
  initials,
  relativeTime,
  REVIEW_LABEL,
} from '@/lib/github-display'
import {
  EMPTY_GITHUB_FILTERS,
  githubEntries,
  githubFilterOptions,
  hasGithubFilters,
  UNASSIGNED,
  type GithubEntry,
  type GithubFilters,
} from '@/lib/github-filter'
import { cn } from '@/lib/utils'
import type { GithubInbox, GithubItem, GithubUser } from '@/lib/types'

export interface GithubViewProps {
  view: BoardView
  onViewChange: (next: BoardView) => void
  inbox: GithubInbox | null
  loading: boolean
  error: string | null
  onRefresh: () => void
  filters: GithubFilters
  onFiltersChange: (next: GithubFilters) => void
  /** Board card already made from an Issue/PR, keyed by `repo#number`. */
  boardCards: Map<string, string>
  onConvert: (item: GithubItem, projectPath: string) => Promise<string>
  onOpenTask: (taskId: string) => void
  onOpenSettings: () => void
  sourceKind?: 'issues' | 'prs'
  embedded?: boolean
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

function ItemIcon({ item, className }: { item: GithubItem; className?: string }) {
  if (item.kind === 'issue') {
    return <CircleDot className={cn('size-3 shrink-0 text-success', className)} />
  }
  const Icon = item.state === 'draft' ? GitPullRequestDraft : GitPullRequest
  return <Icon className={cn('size-3 shrink-0', GITHUB_STATE_CLASS[item.state], className)} />
}

function Avatar({ user }: { user: GithubUser }) {
  return (
    <span
      title={user.login}
      className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-[9px] font-semibold text-foreground"
    >
      {initials(user.login)}
    </span>
  )
}

function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-xs bg-accent px-1.5 py-0.5 text-xs leading-4 text-muted-foreground',
        className
      )}
    >
      {children}
    </span>
  )
}

function ItemChips({ item }: { item: GithubItem }) {
  return (
    <>
      {item.kind === 'issue' && item.issueType && (
        <Chip className="font-medium text-foreground">{item.issueType.name}</Chip>
      )}
      {item.kind === 'pr' && (
        <Chip className={cn('font-medium', GITHUB_STATE_CLASS[item.state])}>
          {GITHUB_STATE_LABEL[item.state]}
        </Chip>
      )}
      {item.kind === 'pr' && item.reviewDecision && REVIEW_LABEL[item.reviewDecision] && (
        <Chip>{REVIEW_LABEL[item.reviewDecision]}</Chip>
      )}
      {item.labels.map((label) => (
        <Chip key={label.name}>
          <span
            className="size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: `#${label.color}` }}
          />
          {label.name}
        </Chip>
      ))}
    </>
  )
}

function GithubCard({
  entry,
  selected,
  onBoard,
  now,
  onSelect,
}: {
  entry: GithubEntry
  selected: boolean
  onBoard: boolean
  now: number
  onSelect: () => void
}) {
  const { item } = entry
  const chips = item.kind === 'pr' || item.issueType || item.labels.length > 0

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'block w-full rounded-md border bg-card p-3 text-left outline-none transition-colors motion-reduce:transition-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        selected
          ? 'border-primary shadow-[0_0_0_2px] shadow-primary/20'
          : 'border-border hover:border-input'
      )}
    >
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ItemIcon item={item} />
        <span className="min-w-0 truncate">
          {entry.projectName} #{item.number}
        </span>
        {onBoard && (
          <span className="shrink-0 rounded-xs bg-primary/15 px-1.5 py-0.5 font-medium text-primary">
            已在看板
          </span>
        )}
        <span className="ml-auto shrink-0" title={absoluteTime(item.createdAt)}>
          {relativeTime(item.createdAt, now)}
        </span>
      </span>
      <span className="mt-2 line-clamp-2 text-[15px] font-medium leading-[1.4] text-foreground">
        {item.title}
      </span>
      {chips && (
        <span className="mt-2 flex flex-wrap gap-1">
          <ItemChips item={item} />
        </span>
      )}
      <span className="mt-2.5 flex items-center gap-3 text-xs text-muted-foreground">
        {item.author && (
          <span className="flex min-w-0 items-center gap-1.5">
            <Avatar user={item.author} />
            <span className="truncate">{item.author.login} 發起</span>
          </span>
        )}
        {item.assignees.length > 0 && (
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            指派
            <span className="flex -space-x-1">
              {item.assignees.slice(0, 3).map((user) => (
                <Avatar key={user.login} user={user} />
              ))}
            </span>
          </span>
        )}
      </span>
    </button>
  )
}

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-foreground">{children}</dd>
    </>
  )
}

function DetailDrawer({
  entry,
  taskId,
  onClose,
  onConvert,
  onOpenTask,
}: {
  entry: GithubEntry
  taskId: string | undefined
  onClose: () => void
  onConvert: () => Promise<string>
  onOpenTask: (taskId: string) => void
}) {
  const { item } = entry
  const users = (list: GithubUser[]) => (list.length ? list.map((u) => u.login).join('、') : '—')
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const create = async () => {
    if (creating) return
    setCreating(true)
    setCreateError(null)
    try { setCreatedId(await onConvert()) }
    catch (err) { setCreateError(err instanceof Error ? err.message : String(err)) }
    finally { setCreating(false) }
  }
  const linkedId = createdId ?? taskId

  return (
    <DialogShell title={item.title} description={`${item.repo} · ${item.kind === 'issue' ? 'Issue' : 'PR'} #${item.number}`}
      showHeader saving={creating} onClose={onClose} contentClassName="max-w-3xl"
      footer={<div className="flex w-full flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => void openExternal(item.url)}><ExternalLink />在 GitHub 開啟</Button>
        {createdId && <span className="text-sm text-success">已建立到 Backlog</span>}
        {linkedId ? <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => void create()} disabled={creating} title="已經有對應卡片，仍可再建一張">再建一張</Button>
          <Button size="sm" onClick={() => onOpenTask(linkedId)}><SquareArrowOutUpRight />前往卡片</Button>
        </div> : <div className="ml-auto flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">建立到：{entry.projectName}</span>
          <Button size="sm" onClick={() => void create()} disabled={creating}>
            {creating ? <Loader2 className="animate-spin" /> : <Plus />}{creating ? '建立中…' : '建立卡片'}
          </Button>
        </div>}
      </div>}>
      <div className="space-y-4">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {item.kind === 'issue' ? (
            <Chip className="bg-success/15 font-medium text-success">Open</Chip>
          ) : (
            <Chip className={cn('font-medium', GITHUB_STATE_CLASS[item.state])}>
              {GITHUB_STATE_LABEL[item.state]}
            </Chip>
          )}
          <span className="min-w-0 truncate">
            {item.repo} · {item.kind === 'issue' ? 'Issue' : 'PR'} #{item.number}
          </span>
        </div>
        <dl className="mt-3 grid grid-cols-[64px_minmax(0,1fr)] gap-y-1.5 text-xs">
          <MetaRow label="專案">{entry.projectName}</MetaRow>
          <MetaRow label="發起人">{item.author?.login ?? '—'}</MetaRow>
          <MetaRow label="指派">{users(item.assignees)}</MetaRow>
          <MetaRow label="建立時間">{absoluteTime(item.createdAt)}</MetaRow>
          {item.kind === 'issue' && (
            <MetaRow label="Issue Type">{item.issueType?.name ?? '—'}</MetaRow>
          )}
          {item.kind === 'pr' && (
            <MetaRow label="分支">
              <span className="break-all">
                {item.headRefName} → {item.baseRefName}
              </span>
            </MetaRow>
          )}
          {item.kind === 'pr' && item.reviewDecision && (
            <MetaRow label="Review">{REVIEW_LABEL[item.reviewDecision] ?? item.reviewDecision}</MetaRow>
          )}
          {item.labels.length > 0 && (
            <MetaRow label="Labels">
              <span className="flex flex-wrap gap-1">
                {item.labels.map((label) => (
                  <Chip key={label.name}>
                    <span
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: `#${label.color}` }}
                    />
                    {label.name}
                  </Chip>
                ))}
              </span>
            </MetaRow>
          )}
          {item.milestone && <MetaRow label="Milestone">{item.milestone}</MetaRow>}
        </dl>

      <div className="border-t border-border pt-4">
        {item.body.trim() ? (
          <MarkdownContent source={item.body} compact />
        ) : (
          <p className="text-sm text-muted-foreground/70">沒有內文</p>
        )}
      </div>

      {createError && <p role="alert" className="text-sm text-destructive">{createError}</p>}
      </div>
    </DialogShell>
  )
}

function Notice({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
      <p className="max-w-md">{children}</p>
      {action}
    </div>
  )
}

function Column<T extends GithubItem>({
  label,
  entries,
  empty,
  selectedKey,
  boardCards,
  now,
  onSelect,
}: {
  label: string
  entries: GithubEntry<T>[]
  empty: string
  selectedKey: string | null
  boardCards: Map<string, string>
  now: number
  onSelect: (key: string) => void
}) {
  return (
    <section className="flex min-h-0 flex-col gap-2">
      <div className="flex shrink-0 items-center gap-2 px-1">
        <h2 className={SECTION_LABEL}>{label}</h2>
        <span className="text-xs tabular-nums text-muted-foreground/80">{entries.length}</span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] content-start gap-3 overflow-y-auto rounded-md p-1">
        {entries.length === 0 ? (
          <p className="px-2 py-1 text-sm text-muted-foreground/60">{empty}</p>
        ) : (
          entries.map((entry) => {
            const key = githubItemKey(entry.item)
            return (
              <GithubCard
                key={key}
                entry={entry}
                selected={key === selectedKey}
                onBoard={boardCards.has(key)}
                now={now}
                onSelect={() => onSelect(key)}
              />
            )
          })
        )}
      </div>
    </section>
  )
}

const assigneeLabel = (login: string) => (login === UNASSIGNED ? '未指派' : login)

export function GithubView({
  view,
  onViewChange,
  inbox,
  loading,
  error,
  onRefresh,
  filters,
  onFiltersChange,
  boardCards,
  onConvert,
  onOpenTask,
  onOpenSettings,
  sourceKind,
  embedded = false,
}: GithubViewProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const now = useNow(30_000)

  const repos = inbox?.status === 'ok' ? inbox.repos : []
  const options = githubFilterOptions(repos, filters, sourceKind)
  const filtered = hasGithubFilters(filters)
  const issues = githubEntries(repos, 'issues', filters)
  const prs = githubEntries(repos, 'prs', filters)
  const failed = repos.filter(
    (r) => r.error && (filters.projects.length === 0 || filters.projects.includes(r.projectName))
  )
  const selected =
    [...(sourceKind === 'prs' ? [] : issues), ...(sourceKind === 'issues' ? [] : prs)]
      .find((entry) => githubItemKey(entry.item) === selectedKey) ?? null
  // Once the selected item is filtered out, clearing the filter must not reopen its drawer.
  const selectionHidden = inbox?.status === 'ok' && selectedKey !== null && selected === null
  useEffect(() => {
    if (selectionHidden) setSelectedKey(null)
  }, [selectionHidden])
  const setFilter = (key: keyof GithubFilters) => (next: string[]) => onFiltersChange({ ...filters, [key]: next })

  const fetchedAt = inbox?.fetchedAt ?? 0
  const updated = fetchedAt ? `${relativeTime(new Date(fetchedAt).toISOString(), now)}更新` : null

  let body: ReactNode
  if (!inbox) {
    body = loading ? <Notice>讀取 GitHub 中…</Notice> : error ? <Notice>{error}</Notice> : null
  } else if (inbox.status === 'gh-missing') {
    body = (
      <Notice>
        找不到 GitHub CLI（gh）。安裝後按右上角的重新整理，就能看到指派給你或你建立的 Issue 與 PR。
      </Notice>
    )
  } else if (inbox.status === 'unauthenticated') {
    body = (
      <Notice
        action={
          <Button size="sm" onClick={onOpenSettings}>
            開啟設定登入 GitHub
          </Button>
        }
      >
        GitHub CLI 尚未登入。
      </Notice>
    )
  } else if (repos.length === 0) {
    body = <Notice>看板上的專案都沒有 GitHub 的 origin，因此沒有可顯示的 Issue 或 PR。</Notice>
  } else {
    body = (
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-5 pb-4 pt-3">
        {failed.length > 0 && (
          <div role="alert" className="shrink-0 space-y-1 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {failed.map((r) => (
              <p key={r.repo} className="truncate" title={r.error}>
                {r.repo}：{r.error}
              </p>
            ))}
          </div>
        )}
        <div className="min-h-0 flex-1">
          {sourceKind !== 'prs' && <Column
            label="Issues"
            entries={issues}
            empty={filtered ? '沒有符合篩選條件的 Issue' : '沒有指派給你或你建立的 open Issue'}
            selectedKey={selectedKey}
            boardCards={boardCards}
            now={now}
            onSelect={setSelectedKey}
          />}
          {sourceKind !== 'issues' && <Column
            label="Pull Requests"
            entries={prs}
            empty={
              filtered ? '沒有符合篩選條件的 PR' : '沒有指派給你、你建立、請你 review 或你 review 過的 open PR'
            }
            selectedKey={selectedKey}
            boardCards={boardCards}
            now={now}
            onSelect={setSelectedKey}
          />}
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn('flex min-h-0 flex-col bg-background', embedded ? 'flex-1' : 'h-full')}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && selectedKey) {
          event.stopPropagation()
          setSelectedKey(null)
        }
      }}
    >
      <div className={cn('flex shrink-0 items-center gap-3 border-b border-border px-5', embedded ? 'h-11' : 'h-12')}>
        {!embedded && <><ViewTabs value={view} onChange={onViewChange} /><span className="h-4 w-px bg-border" /></>}
        {sourceKind !== 'issues' && <GithubFilterMenu
          name="專案"
          allLabel="所有專案"
          icon={Layers}
          options={options.projects}
          value={filters.projects}
          onChange={setFilter('projects')}
        />}
        {sourceKind !== 'issues' && <GithubFilterMenu
          name="Assignee"
          allLabel="所有 Assignee"
          icon={UserCheck}
          options={options.assignees}
          value={filters.assignees}
          onChange={setFilter('assignees')}
          optionLabel={assigneeLabel}
        />}
        <GithubFilterMenu
          name="發起人"
          allLabel="所有發起人"
          icon={UserPen}
          options={options.authors}
          value={filters.authors}
          onChange={setFilter('authors')}
        />
        {filtered && (
          <button
            type="button"
            onClick={() => onFiltersChange(EMPTY_GITHUB_FILTERS)}
            className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground outline-none transition-colors motion-reduce:transition-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <X className="size-3.5 shrink-0" />
            清除篩選
          </button>
        )}
        <span className="ml-auto min-w-0 truncate text-sm text-muted-foreground">
          {inbox?.login ? `${inbox.login} · ` : ''}{sourceKind === 'issues' ? `${issues.length} 筆` : sourceKind === 'prs' ? `${prs.length} 筆` : '指派給我、我建立、我 review 的'}
          {updated ? ` · ${updated}` : ''}
        </span>
        <IconButton
          aria-label="重新整理 Issue 與 PR"
          title="重新整理"
          onClick={onRefresh}
          disabled={loading}
        >
          <RefreshCw className={cn('size-4', loading && 'animate-spin motion-reduce:animate-none')} />
        </IconButton>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">{body}</div>
        {selected && (
          <DetailDrawer
            key={githubItemKey(selected.item)}
            entry={selected}
            taskId={boardCards.get(githubItemKey(selected.item))}
            onClose={() => setSelectedKey(null)}
            onConvert={() => onConvert(selected.item, selected.projectPath)}
            onOpenTask={onOpenTask}
          />
        )}
      </div>
    </div>
  )
}
