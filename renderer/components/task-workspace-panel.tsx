import { lazy, memo, Suspense, useEffect, useState } from 'react'
import type { DiffMethod } from 'react-diff-viewer-continued'
import remarkGfm from 'remark-gfm'

const ReactDiffViewer = lazy(() =>
  import('react-diff-viewer-continued').then((m) => ({ default: m.default }))
)
const ReactMarkdown = lazy(() =>
  import('react-markdown').then((m) => ({ default: m.default }))
)
import {
  Check,
  CheckCircle2,
  Circle,
  FileDiff,
  GitBranch,
  GitCompare,
  Hammer,
  History,
  Layers,
  Lightbulb,
  ListTodo,
  Loader2,
  Maximize2,
  RefreshCw,
  Pencil,
  Play,
  Trash2,
  X,
} from 'lucide-react'

import { TaskTerminal } from '@/components/task-terminal'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { RoleAvatar } from '@/components/roles-dialog'
import {
  buildAgentCommand,
  isTaskComplete,
} from '@/lib/claude'
import {
  getCheckpoints,
  getDiff,
  getPlanHtml,
  getRelatedTasks,
  getTaskLinks,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import type {
  ColumnId,
  DiffFile,
  MemoryCheckpoint,
  MemoryLaunchInfo,
  MemoryTaskLink,
  RelatedTask,
  Role,
  SubAgentRun,
  Task,
} from '@/lib/types'

const STATUS_LABEL: Record<string, string> = {
  A: '新增',
  M: '修改',
  D: '刪除',
  R: '更名',
  '?': '未追蹤',
}

interface LaunchEntry {
  command: string
  nonce: number
}

interface TaskWorkspacePanelProps {
  task: Task
  column: ColumnId
  role: Role | null
  reviewerRole: Role | null
  subAgents: SubAgentRun[]
  launch?: LaunchEntry
  onRun: (task: Task) => void
  onStart: (task: Task) => void
  onComplete: (task: Task) => void
  onEdit: (taskId: string) => void
  onDelete: (taskId: string) => void
  onOpenReviewPanel?: (taskId: string) => void
  onOpenSubAgents: (taskId: string) => void
}

function InfoSection({
  title,
  icon,
  children,
  actions,
}: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <section className="flex min-h-0 flex-1 flex-col border-b border-border last:border-b-0">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border/70 px-4">
        <h2 className="flex min-w-0 items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
          {icon}
          <span className="truncate">{title}</span>
        </h2>
        {actions}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
    </section>
  )
}

function TaskInfo({
  task,
  column,
  role,
  reviewerRole,
  subAgents,
  onOpenSubAgents,
}: Pick<
  TaskWorkspacePanelProps,
  'task' | 'column' | 'role' | 'reviewerRole' | 'subAgents' | 'onOpenSubAgents'
>) {
  const progress = task.progress
  const steps = progress?.steps ?? []
  const doneSteps = steps.filter((step) => step.done).length
  const complete = isTaskComplete(task)
  const stage = task.pipeline?.stage

  return (
    <div className="space-y-4 text-sm">
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground">
            {column === 'in_progress' ? 'In Progress' : column === 'done' ? 'Done' : 'Backlog'}
          </span>
          {complete && (
            <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              complete
            </span>
          )}
          {stage && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {stage}
            </span>
          )}
        </div>
        <h3 className="break-words text-base font-semibold tracking-tight text-foreground">
          {task.title}
        </h3>
      </div>

      <div className="space-y-1.5 rounded-md bg-muted/30 p-2.5 text-xs text-muted-foreground">
        {task.projectName && (
          <div className="flex items-center gap-2">
            <Layers className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate">{task.projectName}</span>
          </div>
        )}
        <div className="flex items-start gap-2">
          <GitBranch className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 break-all">{task.branch}</span>
        </div>
        {task.baseBranch && (
          <div className="flex items-start gap-2">
            <GitCompare className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0 break-all">base: {task.baseBranch}</span>
          </div>
        )}
      </div>

      {(role || reviewerRole) && (
        <div className="flex flex-wrap gap-1.5">
          {role && (
            <span className="inline-flex items-center gap-1 rounded-full bg-secondary py-0.5 pl-0.5 pr-2 text-[10px] font-medium text-secondary-foreground">
              <RoleAvatar role={role} className="size-4 text-[8px]" />
              {role.name}
            </span>
          )}
          {reviewerRole && (
            <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-medium text-warning">
              reviewer: {reviewerRole.name}
            </span>
          )}
        </div>
      )}

      {task.description && <MarkdownContent source={task.description} />}

      {steps.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Progress</span>
            <span className="tabular-nums">
              {doneSteps}/{steps.length}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${(doneSteps / steps.length) * 100}%` }}
            />
          </div>
          {progress?.summary && (
            <p className="text-xs text-muted-foreground">{progress.summary}</p>
          )}
          <ul className="space-y-1 rounded-md bg-muted/30 p-2.5 text-xs">
            {steps.map((step, index) => (
              <li key={index} className="flex items-start gap-1.5">
                {step.done ? (
                  <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-primary" />
                ) : (
                  <Circle className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                )}
                <span className={cn('break-words', step.done && 'text-muted-foreground line-through')}>
                  {step.text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {subAgents.length > 0 && (
        <button
          type="button"
          onClick={() => onOpenSubAgents(task.id)}
          className="flex w-full items-center justify-between rounded-md border border-border/70 px-2.5 py-2 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <span>{subAgents.length} sub-agent runs</span>
          <span>View</span>
        </button>
      )}
    </div>
  )
}

function MarkdownContent({
  source,
  compact = false,
}: {
  source: string
  compact?: boolean
}) {
  return (
    <div
      className={cn(
        'prose prose-invert max-w-none break-words rounded-md bg-muted/30 p-3 text-muted-foreground',
        compact ? 'prose-xs text-[11px] leading-snug' : 'prose-sm'
      )}
    >
      <Suspense fallback={null}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ children, ...props }) => (
              <a {...props} className="break-words text-primary underline underline-offset-2">
                {children}
              </a>
            ),
            code: ({ children, className, ...props }) => (
              <code
                {...props}
                className={cn('break-words rounded bg-background/70 px-1 py-0.5', className)}
              >
                {children}
              </code>
            ),
            pre: ({ children, ...props }) => (
              <pre
                {...props}
                className={cn(
                  'max-w-full overflow-x-auto rounded-md bg-background/70 p-3',
                  compact ? 'text-[10px] leading-snug' : 'text-xs'
                )}
              >
                {children}
              </pre>
            ),
          }}
        >
          {source}
        </ReactMarkdown>
      </Suspense>
    </div>
  )
}

function PlanContent({ taskId }: { taskId: string }) {
  const [html, setHtml] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    let active = true
    setHtml(undefined)
    getPlanHtml(taskId)
      .then((next) => {
        if (active) setHtml(next)
      })
      .catch(() => {
        if (active) setHtml(null)
      })
    return () => {
      active = false
    }
  }, [taskId])

  if (html === undefined) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        讀取 plan 中…
      </div>
    )
  }

  if (!html) {
    return (
      <p className="py-10 text-center text-xs text-muted-foreground">
        尚未找到 agent 產出的 PLAN.md。
      </p>
    )
  }

  return (
    <iframe
      srcDoc={html}
      className="-m-3 block border-0"
      style={{ width: 'calc(100% + 1.5rem)', height: 'calc(100% + 1.5rem)' }}
      title="Plan"
    />
  )
}

function formatCheckpointTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

function MemorySection({ taskId }: { taskId: string }) {
  const [checkpoints, setCheckpoints] = useState<MemoryCheckpoint[] | undefined>(
    undefined
  )
  const [related, setRelated] = useState<RelatedTask[]>([])
  const [links, setLinks] = useState<MemoryTaskLink[]>([])

  useEffect(() => {
    let active = true
    setCheckpoints(undefined)
    setRelated([])
    setLinks([])
    getCheckpoints(taskId)
      .then((next) => {
        if (active) setCheckpoints(next)
      })
      .catch(() => {
        if (active) setCheckpoints([])
      })
    // Cross-task relations come from the unified store, so they naturally span
    // every workspace. Failures degrade to empty (block simply hides).
    getRelatedTasks(taskId).then((r) => active && setRelated(r)).catch(() => {})
    getTaskLinks(taskId).then((l) => active && setLinks(l)).catch(() => {})
    return () => {
      active = false
    }
  }, [taskId])

  return (
    <InfoSection title="Memory" icon={<History className="size-3.5" />}>
      {checkpoints === undefined ? (
        <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          讀取 memory 中…
        </div>
      ) : checkpoints.length === 0 && related.length === 0 && links.length === 0 ? (
        <p className="py-10 text-center text-xs text-muted-foreground">
          此任務沒有記錄任何 memory checkpoint。
        </p>
      ) : (
        <div className="space-y-4">
        {checkpoints.length > 0 && (
        <ol className="space-y-3">
          {checkpoints.map((cp) => (
            <li
              key={cp.id}
              className="rounded-md border border-border/70 bg-muted/20 p-3 text-xs"
            >
              <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
                <span className="rounded bg-secondary px-1.5 py-0.5 font-medium text-secondary-foreground">
                  #{cp.seq}
                </span>
                <span className="tabular-nums">{formatCheckpointTime(cp.createdAt)}</span>
              </div>
              {cp.outcome && (
                <p className="whitespace-pre-wrap break-words text-foreground">
                  {cp.outcome}
                </p>
              )}
              {cp.decisions.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {cp.decisions.map((d, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <Lightbulb className="mt-0.5 size-3 shrink-0 text-warning" />
                      <span className="break-words">
                        <span className="text-foreground">{d.choice}</span>
                        {d.reason && (
                          <span className="text-muted-foreground"> — {d.reason}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {cp.openItems.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {cp.openItems.map((item, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-muted-foreground">
                      <ListTodo className="mt-0.5 size-3 shrink-0" />
                      <span className="break-words">{item}</span>
                    </li>
                  ))}
                </ul>
              )}
              {cp.artifacts.length > 0 && (
                <div className="mt-2 space-y-1 border-t border-border/50 pt-2">
                  {cp.artifacts.map((a) => (
                    <div key={a.id} className="flex items-start gap-1.5 text-muted-foreground">
                      <FileDiff className="mt-0.5 size-3 shrink-0" />
                      <span className="break-words">{a.description}</span>
                    </div>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ol>
        )}

        {related.length > 0 && (
          <div>
            <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <Layers className="size-3.5" />
              相關任務
            </h3>
            <ul className="space-y-1.5">
              {related.map((r) => (
                <li
                  key={r.id}
                  className="rounded-md border border-border/70 bg-muted/20 p-2 text-xs"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={r.id}>
                      {r.title}
                    </span>
                    {r.status && (
                      <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground">
                        {r.status}
                      </span>
                    )}
                  </div>
                  {r.summary && (
                    <p className="mt-1 line-clamp-2 break-words text-muted-foreground">
                      {r.summary}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {links.length > 0 && (
          <div>
            <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <GitBranch className="size-3.5" />
              關聯
            </h3>
            <ul className="space-y-1.5">
              {links.map((l, i) => (
                <li
                  key={`${l.direction}-${l.otherId}-${l.relation}-${i}`}
                  className="flex items-start gap-1.5 rounded-md border border-border/70 bg-muted/20 p-2 text-xs"
                >
                  <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground">
                    {l.direction === 'outgoing' ? l.relation : `← ${l.relation}`}
                  </span>
                  <span className="min-w-0 flex-1 break-words">
                    <span className="text-foreground">{l.otherTitle ?? l.otherId}</span>
                    {l.note && <span className="text-muted-foreground"> — {l.note}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        </div>
      )}
    </InfoSection>
  )
}

const DiffFileViewer = memo(function DiffFileViewer({ file }: { file: DiffFile }) {
  return (
    <div className="overflow-hidden rounded-md border border-border/70">
      <div className="flex items-center gap-2 border-b border-border/70 bg-muted/30 px-2 py-1.5">
        <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground">
          {STATUS_LABEL[file.status] ?? file.status}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px]" title={file.path}>
          {file.path}
        </span>
        {file.truncated && (
          <span className="shrink-0 text-[10px] text-muted-foreground">
            已截斷
          </span>
        )}
      </div>
      <div className="min-w-0 max-w-full overflow-x-auto text-[11px] [&_.diff-content]:whitespace-pre-wrap [&_.diff-content]:break-words [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_table]:min-w-full [&_table]:table-fixed [&_td]:min-w-0 [&_td]:align-top">
        <Suspense fallback={null}>
          <ReactDiffViewer
            oldValue={file.oldValue}
            newValue={file.newValue}
            splitView={false}
            useDarkTheme
            compareMethod={'diffLines' as unknown as DiffMethod}
            renderContent={(source) => (
              <span className="block min-w-0 max-w-full whitespace-pre-wrap break-words">
                {source}
              </span>
            )}
            styles={{
              // Colour overrides go under variables.dark (paired with the
              // useDarkTheme prop above). Text colours read app tokens via
              // var(); the diff +/- tints need an alpha a single CSS var
              // can't carry, so those are whitelisted near-hardcodes aligned
              // to --success (#4ec98a) / --destructive (#e5484d) / --primary
              // (#4c9bf5). See PLAN §2.2 whitelist item 3.
              variables: {
                dark: {
                  diffViewerBackground: 'var(--card)',
                  diffViewerColor: 'var(--card-foreground)',
                  addedBackground: 'rgba(78, 201, 138, 0.15)',
                  addedColor: 'var(--foreground)',
                  removedBackground: 'rgba(229, 72, 77, 0.15)',
                  removedColor: 'var(--foreground)',
                  wordAddedBackground: 'rgba(78, 201, 138, 0.32)',
                  wordRemovedBackground: 'rgba(229, 72, 77, 0.32)',
                  addedGutterBackground: 'rgba(78, 201, 138, 0.20)',
                  removedGutterBackground: 'rgba(229, 72, 77, 0.20)',
                  gutterBackground: 'var(--muted)',
                  gutterBackgroundDark: 'var(--muted)',
                  gutterColor: 'var(--muted-foreground)',
                  addedGutterColor: 'var(--foreground)',
                  removedGutterColor: 'var(--foreground)',
                  highlightBackground: 'rgba(76, 155, 245, 0.15)',
                  highlightGutterBackground: 'rgba(76, 155, 245, 0.20)',
                  codeFoldGutterBackground: 'var(--muted)',
                  codeFoldBackground: 'var(--secondary)',
                  codeFoldContentColor: 'var(--muted-foreground)',
                  emptyLineBackground: 'var(--card)',
                },
              },
              diffContainer: {
                width: '100%',
                maxWidth: '100%',
                overflowX: 'visible',
              },
              line: {
                width: '100%',
              },
              content: {
                width: '100%',
                maxWidth: '100%',
                overflowX: 'visible',
              },
              contentText: {
                display: 'block',
                width: '100%',
                maxWidth: '100%',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                wordBreak: 'break-word',
              },
              lineContent: {
                display: 'block',
                width: '100%',
                maxWidth: '100%',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                wordBreak: 'break-word',
              },
              gutter: {
                maxWidth: '2.5rem',
                minWidth: '2.5rem',
                width: '2.5rem',
                paddingLeft: '0.25rem',
                paddingRight: '0.25rem',
                whiteSpace: 'nowrap',
              },
            }}
          />
        </Suspense>
      </div>
    </div>
  )
})

function DiffSection({ taskId }: { taskId: string }) {
  const [files, setFiles] = useState<DiffFile[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [refreshNonce, setRefreshNonce] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    getDiff(taskId)
      .then((next) => {
        if (active) setFiles(next)
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [taskId, refreshNonce])

  return (
    <InfoSection
      title="Git diff"
      icon={<GitCompare className="size-3.5" />}
      actions={
        <div className="flex items-center gap-1">
          <IconButton
            aria-label="重新整理 Git diff"
            title="重新整理"
            className="p-1"
            disabled={loading}
            onClick={() => setRefreshNonce((n) => n + 1)}
          >
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
          </IconButton>
          {files.length > 0 && (
            <IconButton
              aria-label="放大檢視 Git diff"
              title="放大檢視"
              className="p-1"
              onClick={() => setExpanded(true)}
            >
              <Maximize2 className="size-3.5" />
            </IconButton>
          )}
        </div>
      }
    >
      {loading ? (
        <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          讀取 diff 中…
        </div>
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs">
          {error}
        </div>
      ) : files.length === 0 ? (
        <p className="py-10 text-center text-xs text-muted-foreground">
          與基準分支相比沒有變更。
        </p>
      ) : (
        <div className="space-y-3">
          {files.map((file) => (
            <DiffFileViewer key={file.path} file={file} />
          ))}
        </div>
      )}
      {expanded && (
        <div className="fixed inset-0 z-50 flex bg-background/95 text-foreground">
          <div className="flex min-h-0 w-full flex-col">
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-5">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold">Git diff</h2>
                <p className="text-xs text-muted-foreground">
                  {files.length} changed {files.length === 1 ? 'file' : 'files'}
                </p>
              </div>
              <IconButton
                aria-label="關閉 diff 放大檢視"
                title="關閉"
                onClick={() => setExpanded(false)}
              >
                <X className="size-4" />
              </IconButton>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <div className="mx-auto w-full max-w-6xl space-y-4">
                {files.map((file) => (
                  <DiffFileViewer key={file.path} file={file} />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </InfoSection>
  )
}

export function TaskWorkspacePanel({
  task,
  column,
  role,
  reviewerRole,
  subAgents,
  launch,
  onRun,
  onStart,
  onComplete,
  onEdit,
  onDelete,
  onOpenReviewPanel,
  onOpenSubAgents,
}: TaskWorkspacePanelProps) {
  const [activeTaskTab, setActiveTaskTab] = useState<'task' | 'plan'>('task')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const cwd = task.worktreePath ?? task.projectPath ?? null
  const canLaunch = column === 'backlog' || (column === 'in_progress' && !!task.launchedAt)
  const launchCommand = launch?.command
  const launchNonce = launch?.nonce ?? 0

  const requestLaunch = () => {
    if (column === 'backlog') onStart(task)
    else onRun(task)
  }

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate text-sm font-semibold">{task.title}</span>
          </div>
        </div>

        {canLaunch && (
          <Button size="sm" variant="outline" onClick={requestLaunch} disabled={!cwd}>
            <Play className="size-3.5" />
            {task.launchedAt ? '重跑' : '開始'}
          </Button>
        )}
        {column === 'in_progress' && (
          <>
            <Button size="sm" onClick={() => onComplete(task)} title="標記完成後會清理 PTY 與 worktree">
              <Check className="size-3.5" />
              完成
            </Button>
          </>
        )}
        <IconButton aria-label="編輯任務" title="編輯任務" onClick={() => onEdit(task.id)}>
          <Pencil className="size-4" />
        </IconButton>
        {task.pipeline?.stage === 'reviewing' && column !== 'done' && (
          <IconButton
            aria-label="查看 Reviewer 終端"
            title="查看 Reviewer 終端"
            className="text-warning hover:text-warning/80"
            onClick={() => onOpenReviewPanel?.(task.id)}
          >
            <Hammer className="size-4" />
          </IconButton>
        )}
        {confirmDelete ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="rounded px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => onDelete(task.id)}
              className="rounded px-1.5 py-1 text-xs text-destructive hover:bg-destructive/15"
            >
              確認刪除
            </button>
          </div>
        ) : (
          <IconButton
            aria-label="刪除任務"
            title="刪除任務（清理 worktree）"
            tone="danger"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="size-4" />
          </IconButton>
        )}
      </header>

      {column === 'done' ? (
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-card/40">
          <InfoSection title="Plan" icon={<FileDiff className="size-3.5" />}>
            <PlanContent taskId={task.id} />
          </InfoSection>
          <MemorySection taskId={task.id} />
        </main>
      ) : (
      <main className="grid min-h-0 flex-1 grid-rows-[minmax(18rem,1fr)_minmax(18rem,45%)] overflow-hidden lg:grid-cols-[minmax(20rem,1fr)_minmax(20rem,24rem)] lg:grid-rows-1 xl:grid-cols-[minmax(0,1fr)_minmax(21rem,27rem)]">
        <div className="flex min-h-0 min-w-0 flex-col border-b border-border bg-muted/30 p-3 lg:border-b-0 lg:border-r">
          <TaskTerminal
            taskId={task.id}
            cwd={cwd}
            launchCommand={launchCommand}
            launchNonce={launchNonce}
            launchLabel={task.launchedAt ? '重跑' : '開始任務'}
            onLaunchRequest={canLaunch ? requestLaunch : undefined}
            readOnly={false}
          />
        </div>

        <aside className="flex min-h-0 min-w-0 flex-col bg-card/40">
          <InfoSection
            title="任務內容"
            icon={<FileDiff className="size-3.5" />}
            actions={
              <div className="flex rounded-md border border-border/70 p-0.5">
                {([
                  ['task', '任務'],
                  ['plan', 'Plan'],
                ] as const).map(([tab, label]) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveTaskTab(tab)}
                    className={cn(
                      'rounded-sm px-2 py-0.5 text-[11px]',
                      activeTaskTab === tab
                        ? 'bg-primary/15 text-primary'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            }
          >
            {activeTaskTab === 'task' ? (
              <TaskInfo
                task={task}
                column={column}
                role={role}
                reviewerRole={reviewerRole}
                subAgents={subAgents}
                onOpenSubAgents={onOpenSubAgents}
              />
            ) : (
              <PlanContent taskId={task.id} />
            )}
          </InfoSection>

          <DiffSection taskId={task.id} />
        </aside>
      </main>
      )}
    </div>
  )
}

export function buildWorkspaceLaunchCommand({
  task,
  role,
  planningRole,
  systemPrompt,
  workspacePath,
  resume,
  memory,
  autoMode,
}: {
  task: Task
  role: Role | null
  /** Store's PM role for the planning phase; undefined → built-in fallback. */
  planningRole?: Role | null
  systemPrompt: string
  workspacePath?: string
  resume?: boolean
  /** Built-in agent-memory server injection; undefined → not wired. */
  memory?: MemoryLaunchInfo
  /** Global Auto Mode — drives Codex authorization at launch. */
  autoMode?: boolean
}): string {
  return buildAgentCommand(
    task,
    systemPrompt,
    role ?? undefined,
    { resume, memory, autoMode },
    workspacePath,
    planningRole ?? undefined
  )
}
