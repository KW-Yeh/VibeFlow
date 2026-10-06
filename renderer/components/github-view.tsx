import {
  CircleDot,
  ExternalLink,
  GitPullRequest,
  GitPullRequestDraft,
  Plus,
  RefreshCw,
  SquareArrowOutUpRight,
  X,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

import { ProjectFilter } from '@/components/board-columns'
import { MarkdownContent } from '@/components/markdown-content'
import { Button } from '@/components/ui/button'
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
import { cn } from '@/lib/utils'
import type { GithubInbox, GithubIssue, GithubItem, GithubPr, GithubUser } from '@/lib/types'

export interface GithubViewProps {
  view: BoardView
  onViewChange: (next: BoardView) => void
  inbox: GithubInbox | null
  loading: boolean
  error: string | null
  onRefresh: () => void
  /** Project name to show, null = every project. */
  projectFilter: string | null
  onProjectFilterChange: (next: string | null) => void
  /** Board card already made from an Issue/PR, keyed by `repo#number`. */
  boardCards: Map<string, string>
  onConvert: (item: GithubItem, projectPath: string) => void
  onOpenTask: (taskId: string) => void
  onOpenSettings: () => void
}

interface Entry<T extends GithubItem> {
  item: T
  projectName: string
  projectPath: string
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
  entry: Entry<GithubItem>
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
  entry: Entry<GithubItem>
  taskId: string | undefined
  onClose: () => void
  onConvert: () => void
  onOpenTask: (taskId: string) => void
}) {
  const { item } = entry
  const users = (list: GithubUser[]) => (list.length ? list.map((u) => u.login).join('、') : '—')

  return (
    <aside
      aria-label={`${item.kind === 'issue' ? 'Issue' : 'PR'} #${item.number} 詳細內容`}
      className="flex w-[400px] shrink-0 flex-col border-l border-border bg-card"
    >
      <div className="border-b border-border px-5 py-4">
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
          <IconButton aria-label="關閉詳細內容" title="關閉（Esc）" onClick={onClose} className="ml-auto">
            <X className="size-4" />
          </IconButton>
        </div>
        <p className="mt-2 text-[17px] font-semibold leading-[1.4] text-foreground">{item.title}</p>
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
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {item.body.trim() ? (
          <MarkdownContent source={item.body} compact />
        ) : (
          <p className="text-sm text-muted-foreground/70">沒有內文</p>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-border px-5 py-4">
        <Button variant="outline" size="sm" className="text-[13px]" onClick={() => void openExternal(item.url)}>
          <ExternalLink />
          在 GitHub 開啟
        </Button>
        {taskId ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-[13px]"
              onClick={onConvert}
              title="已經有對應卡片，仍可再建一張"
            >
              再建一張
            </Button>
            <Button size="sm" className="text-[13px]" onClick={() => onOpenTask(taskId)}>
              <SquareArrowOutUpRight />
              前往卡片
            </Button>
          </>
        ) : (
          <Button size="sm" className="ml-auto text-[13px]" onClick={onConvert}>
            <Plus />
            轉為 Backlog 卡片
          </Button>
        )}
      </div>
    </aside>
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
  entries: Entry<T>[]
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
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-md p-1">
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

function byNewest(a: Entry<GithubItem>, b: Entry<GithubItem>): number {
  return b.item.createdAt.localeCompare(a.item.createdAt)
}

export function GithubView({
  view,
  onViewChange,
  inbox,
  loading,
  error,
  onRefresh,
  projectFilter,
  onProjectFilterChange,
  boardCards,
  onConvert,
  onOpenTask,
  onOpenSettings,
}: GithubViewProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const now = useNow(30_000)

  const repos = inbox?.status === 'ok' ? inbox.repos : []
  const projects = Array.from(new Set(repos.map((r) => r.projectName))).sort((a, b) =>
    a.localeCompare(b)
  )
  const shown = projectFilter ? repos.filter((r) => r.projectName === projectFilter) : repos
  const issues: Entry<GithubIssue>[] = shown
    .flatMap((r) => r.issues.map((item) => ({ item, projectName: r.projectName, projectPath: r.projectPath })))
    .sort(byNewest)
  const prs: Entry<GithubPr>[] = shown
    .flatMap((r) => r.prs.map((item) => ({ item, projectName: r.projectName, projectPath: r.projectPath })))
    .sort(byNewest)
  const failed = shown.filter((r) => r.error)
  const selected =
    [...issues, ...prs].find((entry) => githubItemKey(entry.item) === selectedKey) ?? null

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
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-4">
          <Column
            label="Issues"
            entries={issues}
            empty="沒有指派給你或你建立的 open Issue"
            selectedKey={selectedKey}
            boardCards={boardCards}
            now={now}
            onSelect={setSelectedKey}
          />
          <Column
            label="Pull Requests"
            entries={prs}
            empty="沒有指派給你、你建立或請你 review 的 open PR"
            selectedKey={selectedKey}
            boardCards={boardCards}
            now={now}
            onSelect={setSelectedKey}
          />
        </div>
      </div>
    )
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-background"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && selectedKey) {
          event.stopPropagation()
          setSelectedKey(null)
        }
      }}
    >
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-5">
        <ViewTabs value={view} onChange={onViewChange} />
        <span className="h-4 w-px bg-border" />
        <ProjectFilter projects={projects} value={projectFilter} onChange={onProjectFilterChange} />
        <span className="ml-auto min-w-0 truncate text-sm text-muted-foreground">
          {inbox?.login ? `${inbox.login} · 指派給我、我建立的` : '指派給我、我建立的'}
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
