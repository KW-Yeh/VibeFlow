import { lazy, memo, Suspense, useCallback, useEffect, useId, useRef, useState } from 'react'
import { AnimatePresence } from 'motion/react'
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
  ChevronRight,
  Circle,
  FileDiff,
  FileText,
  GitBranch,
  GitCompare,
  History,
  Image as ImageIcon,
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
import { DialogShell } from '@/components/ui/dialog-shell'
import { IconButton } from '@/components/ui/icon-button'
import { SECTION_LABEL } from '@/components/ui/section-label'
import { RoleAvatar } from '@/components/roles-dialog'
import {
  buildAgentCommand,
  isTaskComplete,
  taskArtifactsDir,
} from '@/lib/claude'
import {
  getCheckpoints,
  getDiff,
  getDiffEntries,
  getDiffFile,
  getPlanHtml,
  getRelatedTasks,
  getTaskLinks,
  listArtifacts,
  readArtifact,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import type {
  ArtifactContent,
  ArtifactKind,
  ColumnId,
  DiffEntry,
  DiffFile,
  MemoryCheckpoint,
  MemoryLaunchInfo,
  MemoryTaskLink,
  RelatedTask,
  Role,
  SubAgentRun,
  Task,
  TaskArtifact,
} from '@/lib/types'

const STATUS_LABEL: Record<string, string> = {
  A: '新增',
  M: '修改',
  D: '刪除',
  R: '更名',
  '?': '未追蹤',
}

const ARTIFACT_KIND_LABEL: Record<ArtifactKind, string> = {
  image: '截圖',
  text: '文字',
  binary: '二進位',
}

/**
 * Poll interval for the artifact list and the diff file list. Both reads are
 * local (the diff poll passes `fetch: false`), so this costs a readdir and a few
 * local git calls per tick.
 */
const POLL_INTERVAL_MS = 3000

/**
 * Cap the diff list is truncated at, so the UI can say so instead of silently
 * showing a short list. Must match MAX_DIFF_FILES in main/helpers/git.ts (value
 * duplicated because the renderer cannot runtime-import main-process modules).
 */
const MAX_DIFF_FILES = 80

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

interface LaunchEntry {
  command: string
  nonce: number
}

interface TaskWorkspacePanelProps {
  task: Task
  column: ColumnId
  role: Role | null
  subAgents: SubAgentRun[]
  launch?: LaunchEntry
  onRun: (task: Task) => void
  onStart: (task: Task) => void
  onComplete: (task: Task) => void
  onEdit: (taskId: string) => void
  onDelete: (taskId: string) => void
  onOpenSubAgents: (taskId: string) => void
}

function InfoSection({
  title,
  icon,
  children,
  actions,
  count,
}: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
  actions?: React.ReactNode
  /** Optional item count shown beside the title (discoverability, PLAN E1). */
  count?: number
}) {
  return (
    <section className="flex min-h-0 flex-1 flex-col border-b border-border last:border-b-0">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border/70 px-4">
        <h2 className={cn(SECTION_LABEL, 'flex min-w-0 items-center gap-2')}>
          {icon}
          <span className="truncate">{title}</span>
          {count !== undefined && count > 0 && (
            <span className="shrink-0 tabular-nums text-muted-foreground/80">{count}</span>
          )}
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
  subAgents,
  onOpenSubAgents,
}: Pick<
  TaskWorkspacePanelProps,
  'task' | 'column' | 'role' | 'subAgents' | 'onOpenSubAgents'
>) {
  const progress = task.progress
  const steps = progress?.steps ?? []
  const doneSteps = steps.filter((step) => step.done).length
  const complete = isTaskComplete(task)

  return (
    <div className="space-y-4 text-base">
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="rounded-xs bg-secondary px-1.5 py-0.5 text-xs font-medium text-secondary-foreground">
            {column === 'in_progress' ? 'In Progress' : column === 'done' ? 'Done' : 'Backlog'}
          </span>
          {complete && (
            <span className="rounded-xs bg-primary/15 px-1.5 py-0.5 text-xs font-medium text-primary">
              complete
            </span>
          )}
        </div>
        <h3 className="break-words text-lg font-semibold tracking-tight text-foreground">
          {task.title}
        </h3>
      </div>

      <div className="space-y-1.5 rounded-md bg-muted/30 p-2.5 text-sm text-muted-foreground">
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

      {role && (
        <div className="flex flex-wrap gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-secondary py-0.5 pl-0.5 pr-2 text-xs font-medium text-secondary-foreground">
            <RoleAvatar role={role} className="size-4 text-[10px]" />
            {role.name}
          </span>
        </div>
      )}

      {task.description && <MarkdownContent source={task.description} />}

      {steps.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
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
            <p className="text-sm text-muted-foreground">{progress.summary}</p>
          )}
          <ul className="space-y-1 rounded-md bg-muted/30 p-2.5 text-sm">
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
          className="flex w-full items-center justify-between rounded-md border border-border/70 px-2.5 py-2 text-left text-sm text-muted-foreground outline-none transition-colors motion-reduce:transition-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
        compact ? 'prose-xs text-xs leading-snug' : 'prose-sm'
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
                className={cn('break-words rounded-xs bg-background/70 px-1 py-0.5', className)}
              >
                {children}
              </code>
            ),
            pre: ({ children, ...props }) => (
              <pre
                {...props}
                className={cn(
                  'max-w-full overflow-x-auto rounded-md bg-background/70 p-3',
                  compact ? 'text-xs leading-snug' : 'text-sm'
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
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        讀取 plan 中…
      </div>
    )
  }

  if (!html) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
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
        <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          讀取 memory 中…
        </div>
      ) : checkpoints.length === 0 && related.length === 0 && links.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          此任務沒有記錄任何 memory checkpoint。
        </p>
      ) : (
        <div className="space-y-4">
        {checkpoints.length > 0 && (
        <ol className="space-y-3">
          {checkpoints.map((cp) => (
            <li
              key={cp.id}
              className="rounded-md border border-border/70 bg-muted/20 p-3 text-sm"
            >
              <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
                <span className="rounded-xs bg-secondary px-1.5 py-0.5 font-medium text-secondary-foreground">
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
            <h3 className={cn(SECTION_LABEL, 'mb-2 flex items-center gap-1.5')}>
              <Layers className="size-3.5" />
              相關任務
            </h3>
            <ul className="space-y-1.5">
              {related.map((r) => (
                <li
                  key={r.id}
                  className="rounded-md border border-border/70 bg-muted/20 p-2 text-sm"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={r.id}>
                      {r.title}
                    </span>
                    {r.status && (
                      <span className="shrink-0 rounded-xs bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground">
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
            <h3 className={cn(SECTION_LABEL, 'mb-2 flex items-center gap-1.5')}>
              <GitBranch className="size-3.5" />
              關聯
            </h3>
            <ul className="space-y-1.5">
              {links.map((l, i) => (
                <li
                  key={`${l.direction}-${l.otherId}-${l.relation}-${i}`}
                  className="flex items-start gap-1.5 rounded-md border border-border/70 bg-muted/20 p-2 text-sm"
                >
                  <span className="shrink-0 rounded-xs bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground">
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

/**
 * Thumbnail for an image artifact. Each tile fetches its own data URL, so
 * listing a directory of screenshots costs nothing until it is displayed.
 * `modifiedAt` is a dep so an overwritten screenshot reloads on the next poll.
 */
function ArtifactThumb({ taskId, artifact }: { taskId: string; artifact: TaskArtifact }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setDataUrl(null)
    readArtifact(taskId, artifact.name)
      .then((content) => {
        if (active) setDataUrl(content?.dataUrl ?? null)
      })
      .catch(() => {
        if (active) setDataUrl(null)
      })
    return () => {
      active = false
    }
  }, [taskId, artifact.name, artifact.modifiedAt])

  if (!dataUrl) {
    return (
      <div className="flex h-24 items-center justify-center rounded-md border border-border/70 bg-card">
        <ImageIcon className="size-5 text-muted-foreground" />
      </div>
    )
  }
  return (
    <img
      src={dataUrl}
      alt={artifact.name}
      className="h-24 w-full rounded-md border border-border/70 bg-card object-contain"
    />
  )
}

/** Full-size artifact view. Images render inline; anything else falls back to text. */
function ArtifactPreview({
  taskId,
  artifact,
  onClose,
}: {
  taskId: string
  artifact: TaskArtifact
  onClose: () => void
}) {
  const [content, setContent] = useState<ArtifactContent | null | undefined>(undefined)

  useEffect(() => {
    let active = true
    setContent(undefined)
    readArtifact(taskId, artifact.name)
      .then((next) => {
        if (active) setContent(next)
      })
      .catch(() => {
        if (active) setContent(null)
      })
    return () => {
      active = false
    }
  }, [taskId, artifact.name, artifact.modifiedAt])

  return (
    <DialogShell
      title={artifact.name}
      description={`${ARTIFACT_KIND_LABEL[artifact.kind]} · ${formatBytes(artifact.size)}`}
      onClose={onClose}
      showHeader
      contentClassName="max-w-5xl"
      bodyClassName="p-4"
    >
      {content === undefined ? (
        <div className="flex h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          讀取中…
        </div>
      ) : content === null ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          讀不到這個檔案，可能已被刪除。
        </p>
      ) : content.kind === 'image' && content.dataUrl ? (
        <img
          src={content.dataUrl}
          alt={artifact.name}
          className="mx-auto max-h-[70vh] w-auto max-w-full rounded-md"
        />
      ) : content.kind === 'binary' ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          二進位檔案（{formatBytes(artifact.size)}），不提供預覽。
        </p>
      ) : (
        <>
          <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/30 p-3 font-mono text-xs">
            {content.text}
          </pre>
          {content.truncated && (
            <p className="mt-2 text-xs text-muted-foreground">
              內容過長，僅顯示開頭 256 KB。
            </p>
          )}
        </>
      )}
    </DialogShell>
  )
}

/**
 * Temporary artifacts the agent produced for this task — screenshots from UI
 * verification, comparison reports, logs. The list is owned by the panel so the
 * tab badge stays live even while this tab is closed.
 */
function ArtifactsContent({
  taskId,
  artifacts,
  artifactsDir,
}: {
  taskId: string
  artifacts: TaskArtifact[]
  artifactsDir: string | null
}) {
  const [preview, setPreview] = useState<TaskArtifact | null>(null)

  return (
    <>
      {artifacts.length === 0 ? (
        <div className="space-y-2 py-8 text-center">
          <p className="text-sm text-muted-foreground">還沒有暫存產物。</p>
          <p className="text-xs leading-5 text-muted-foreground/80">
            Agent 會把驗證截圖與報告寫進
            {artifactsDir ? (
              <code className="mx-1 break-all rounded-xs bg-muted/40 px-1 py-0.5 font-mono">
                {artifactsDir}
              </code>
            ) : (
              '任務的 artifacts 目錄'
            )}
            ，完成任務時會一併清除。
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-2">
          {artifacts.map((artifact) => (
            <li key={artifact.name}>
              <button
                type="button"
                onClick={() => setPreview(artifact)}
                title={artifact.name}
                className="w-full rounded-md border border-border/70 bg-muted/20 p-2 text-left outline-none transition-colors motion-reduce:transition-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {artifact.kind === 'image' ? (
                  <ArtifactThumb taskId={taskId} artifact={artifact} />
                ) : (
                  <div className="flex h-24 items-center justify-center rounded-md border border-border/70 bg-card">
                    <FileText className="size-5 text-muted-foreground" />
                  </div>
                )}
                <div className="mt-1.5 flex items-baseline gap-1.5">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">
                    {artifact.name}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {formatBytes(artifact.size)}
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      <AnimatePresence>
        {preview && (
          <ArtifactPreview
            key={`artifact-${taskId}-${preview.name}`}
            taskId={taskId}
            artifact={preview}
            onClose={() => setPreview(null)}
          />
        )}
      </AnimatePresence>
    </>
  )
}

const DiffFileViewer = memo(function DiffFileViewer({
  file,
  /** False inside the sidebar accordion, whose row already shows status + path. */
  showHeader = true,
}: {
  file: DiffFile
  showHeader?: boolean
}) {
  return (
    <div className={cn('overflow-hidden', showHeader && 'rounded-md border border-border/70')}>
      {showHeader && (
        <div className="flex items-center gap-2 border-b border-border/70 bg-muted/30 px-2 py-1.5">
          <span className="rounded-xs bg-secondary px-1.5 py-0.5 text-xs font-medium text-secondary-foreground">
            {STATUS_LABEL[file.status] ?? file.status}
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-xs" title={file.path}>
            {file.path}
          </span>
          {file.truncated && (
            <span className="shrink-0 text-xs text-muted-foreground">
              已截斷
            </span>
          )}
        </div>
      )}
      <div className="min-w-0 max-w-full overflow-x-auto text-xs [&_.diff-content]:whitespace-pre-wrap [&_.diff-content]:break-words [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_table]:min-w-full [&_table]:table-fixed [&_td]:min-w-0 [&_td]:align-top">
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

/**
 * A cached file body is only reusable while the entry it came from is unchanged.
 * Untracked files carry no numstat (see DiffEntry), so an edit to one is
 * invisible here — those are treated as always stale by the caller.
 */
function sameEntry(a: DiffEntry, b: DiffEntry): boolean {
  return (
    a.status === b.status &&
    a.additions === b.additions &&
    a.deletions === b.deletions
  )
}

/**
 * Changed files as a collapsible list. The list itself is polled cheaply
 * (`fetch: false`, metadata only); a file's body is loaded when its row is
 * opened, and the full-screen view still loads everything at once.
 */
function DiffSection({ taskId }: { taskId: string }) {
  const [entries, setEntries] = useState<DiffEntry[]>([])
  /** path → body; a `null` value records "asked, not available" so it is not refetched. */
  const [contents, setContents] = useState<Record<string, DiffFile | null>>({})
  const [openPaths, setOpenPaths] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshNonce, setRefreshNonce] = useState(0)

  const [expanded, setExpanded] = useState(false)
  const [fullFiles, setFullFiles] = useState<DiffFile[] | null>(null)

  const prevEntriesRef = useRef<DiffEntry[]>([])
  const pendingRef = useRef<Set<string>>(new Set())

  /** Adopt a fresh entry list, dropping cached bodies the list invalidates. */
  const applyEntries = useCallback((next: DiffEntry[]) => {
    const prevByPath = new Map(prevEntriesRef.current.map((e) => [e.path, e]))
    prevEntriesRef.current = next
    setEntries(next)
    setContents((cache) => {
      const kept: Record<string, DiffFile | null> = {}
      for (const entry of next) {
        if (!(entry.path in cache)) continue
        if (entry.status === '?') continue
        const before = prevByPath.get(entry.path)
        if (!before || !sameEntry(before, entry)) continue
        kept[entry.path] = cache[entry.path]
      }
      return kept
    })
  }, [])

  // Reset per-task view state when switching tasks.
  useEffect(() => {
    setOpenPaths([])
    setContents({})
    setEntries([])
    prevEntriesRef.current = []
    pendingRef.current.clear()
  }, [taskId])

  // First load does a full remote refresh (matching the old behaviour); the
  // self-rescheduling poll that follows stays local, so it never hits the
  // network and cannot overlap with itself.
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined

    const tick = async (withFetch: boolean) => {
      try {
        const next = await getDiffEntries(taskId, { fetch: withFetch })
        if (!active) return
        applyEntries(next)
        setError(null)
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (active) {
          setLoading(false)
          timer = setTimeout(() => void tick(false), POLL_INTERVAL_MS)
        }
      }
    }

    setLoading(true)
    void tick(true)
    return () => {
      active = false
      if (timer) clearTimeout(timer)
    }
  }, [taskId, refreshNonce, applyEntries])

  // Load the body of any open row that has none.
  useEffect(() => {
    const missing = openPaths.filter(
      (p) => !(p in contents) && !pendingRef.current.has(p)
    )
    if (missing.length === 0) return
    let active = true
    for (const filePath of missing) {
      pendingRef.current.add(filePath)
      getDiffFile(taskId, filePath)
        .then((file) => {
          if (active) setContents((c) => ({ ...c, [filePath]: file }))
        })
        .catch(() => {
          if (active) setContents((c) => ({ ...c, [filePath]: null }))
        })
        .finally(() => {
          pendingRef.current.delete(filePath)
        })
    }
    return () => {
      active = false
    }
  }, [taskId, openPaths, contents])

  // The full-screen view keeps the original single-shot path: every file with
  // its content, fetched fresh each time it opens.
  useEffect(() => {
    if (!expanded) return
    let active = true
    getDiff(taskId)
      .then((next) => {
        if (active) setFullFiles(next)
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      active = false
    }
  }, [expanded, taskId])

  const closeExpanded = () => {
    setExpanded(false)
    setFullFiles(null)
  }

  const manualRefresh = () => {
    setContents({})
    prevEntriesRef.current = []
    setRefreshNonce((n) => n + 1)
  }

  const toggle = (filePath: string) => {
    setOpenPaths((open) =>
      open.includes(filePath) ? open.filter((p) => p !== filePath) : [...open, filePath]
    )
  }

  return (
    <InfoSection
      title="Git diff"
      icon={<GitCompare className="size-3.5" />}
      count={entries.length}
      actions={
        <div className="flex items-center gap-1">
          <IconButton
            aria-label="重新整理 Git diff"
            title="重新整理（含 fetch origin）"
            className="p-1"
            disabled={loading}
            onClick={manualRefresh}
          >
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
          </IconButton>
          {entries.length > 0 && (
            <IconButton
              aria-label="放大檢視 Git diff"
              title="放大檢視（全部展開）"
              className="p-1"
              onClick={() => setExpanded(true)}
            >
              <Maximize2 className="size-3.5" />
            </IconButton>
          )}
        </div>
      }
    >
      {loading && entries.length === 0 ? (
        <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          讀取 diff 中…
        </div>
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm">
          {error}
        </div>
      ) : entries.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          與基準分支相比沒有變更。
        </p>
      ) : (
        <>
          <ul className="space-y-1">
            {entries.map((entry) => {
              const open = openPaths.includes(entry.path)
              const body = entry.path in contents ? contents[entry.path] : undefined
              return (
                <li
                  key={entry.path}
                  className="overflow-hidden rounded-md border border-border/70"
                >
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => toggle(entry.path)}
                    className="flex w-full items-center gap-2 bg-muted/30 px-2 py-1.5 text-left outline-none transition-colors motion-reduce:transition-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <ChevronRight
                      className={cn(
                        'size-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none',
                        open && 'rotate-90'
                      )}
                    />
                    <span className="shrink-0 rounded-xs bg-secondary px-1.5 py-0.5 text-xs font-medium text-secondary-foreground">
                      {STATUS_LABEL[entry.status] ?? entry.status}
                    </span>
                    <span
                      className="min-w-0 flex-1 truncate font-mono text-xs"
                      title={entry.path}
                    >
                      {entry.path}
                    </span>
                    {(entry.additions > 0 || entry.deletions > 0) && (
                      <span className="shrink-0 font-mono text-xs tabular-nums">
                        <span className="text-success">+{entry.additions}</span>
                        <span className="ml-1 text-destructive">−{entry.deletions}</span>
                      </span>
                    )}
                  </button>
                  {open && (
                    <div className="border-t border-border/70">
                      {body === undefined ? (
                        <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
                          <Loader2 className="size-3.5 animate-spin" />
                          讀取內容中…
                        </div>
                      ) : body === null ? (
                        <p className="py-4 text-center text-xs text-muted-foreground">
                          讀不到這個檔案的內容。
                        </p>
                      ) : (
                        <DiffFileViewer file={body} showHeader={false} />
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
          {entries.length >= MAX_DIFF_FILES && (
            <p className="mt-2 text-xs text-muted-foreground">
              變更檔案超過 {MAX_DIFF_FILES} 個，僅顯示前 {MAX_DIFF_FILES} 個。
            </p>
          )}
        </>
      )}
      {expanded && (
        <div className="fixed inset-0 z-50 flex bg-background/95 text-foreground">
          <div className="flex min-h-0 w-full flex-col">
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-5">
              <div className="min-w-0">
                <h2 className="text-base font-semibold">Git diff</h2>
                <p className="text-sm text-muted-foreground">
                  {entries.length} changed {entries.length === 1 ? 'file' : 'files'}
                </p>
              </div>
              <IconButton
                aria-label="關閉 diff 放大檢視"
                title="關閉"
                onClick={closeExpanded}
              >
                <X className="size-4" />
              </IconButton>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <div className="mx-auto w-full max-w-6xl space-y-4">
                {fullFiles === null ? (
                  <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" />
                    讀取全部 diff 內容中…
                  </div>
                ) : (
                  fullFiles.map((file) => <DiffFileViewer key={file.path} file={file} />)
                )}
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
  subAgents,
  launch,
  onRun,
  onStart,
  onComplete,
  onEdit,
  onDelete,
  onOpenSubAgents,
}: TaskWorkspacePanelProps) {
  type TaskTab = 'task' | 'plan' | 'artifacts'
  const [activeTaskTab, setActiveTaskTab] = useState<TaskTab>('task')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [artifacts, setArtifacts] = useState<TaskArtifact[]>([])
  const tabBaseId = useId()
  const tabPanelId = `${tabBaseId}-panel`
  const tabId = (tab: TaskTab) => `${tabBaseId}-tab-${tab}`
  const cwd = task.worktreePath ?? task.projectPath ?? null
  const artifactsDir = taskArtifactsDir(task.worktreePath, task.workspacePath)

  // Polled here rather than inside ArtifactsContent so the tab's count stays
  // live while the tab is closed. A completed task has no artifacts left (the
  // directory is cleaned with its worktree), so skip the poll entirely there.
  useEffect(() => {
    if (column === 'done') {
      setArtifacts([])
      return
    }
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined

    const tick = async () => {
      try {
        const next = await listArtifacts(task.id)
        if (active) setArtifacts(next)
      } catch {
        // a failed listing just leaves the previous snapshot in place
      } finally {
        if (active) timer = setTimeout(() => void tick(), POLL_INTERVAL_MS)
      }
    }

    void tick()
    return () => {
      active = false
      if (timer) clearTimeout(timer)
    }
  }, [task.id, column])

  // Inline delete confirmation is dismissible with Esc, matching the dialog
  // affordance elsewhere (the row is not a modal, so DialogShell doesn't cover it).
  useEffect(() => {
    if (!confirmDelete) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // Defer to a modal dialog's own Esc handling if one is open above the row.
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
      setConfirmDelete(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirmDelete])
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
            <span className="min-w-0 truncate text-base font-semibold">{task.title}</span>
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
        {confirmDelete ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="rounded-md px-1.5 py-1 text-sm text-muted-foreground outline-none transition-colors motion-reduce:transition-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => onDelete(task.id)}
              className="rounded-md px-1.5 py-1 text-sm text-destructive outline-none transition-colors motion-reduce:transition-none hover:bg-destructive/15 focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
              <div
                role="tablist"
                aria-label="任務內容檢視"
                className="flex rounded-md border border-border/70 p-0.5"
              >
                {([
                  ['task', '任務'],
                  ['plan', 'Plan'],
                  ['artifacts', 'Artifacts'],
                ] as const).map(([tab, label]) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    id={tabId(tab)}
                    aria-selected={activeTaskTab === tab}
                    aria-controls={tabPanelId}
                    onClick={() => setActiveTaskTab(tab)}
                    className={cn(
                      'rounded-sm px-2 py-0.5 text-xs outline-none transition-colors motion-reduce:transition-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                      activeTaskTab === tab
                        ? 'bg-primary/15 text-primary'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {label}
                    {tab === 'artifacts' && artifacts.length > 0 && (
                      <span className="ml-1 tabular-nums text-muted-foreground/80">
                        {artifacts.length}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            }
          >
            <div role="tabpanel" id={tabPanelId} aria-labelledby={tabId(activeTaskTab)}>
              {activeTaskTab === 'task' ? (
                <TaskInfo
                  task={task}
                  column={column}
                  role={role}
                  subAgents={subAgents}
                  onOpenSubAgents={onOpenSubAgents}
                />
              ) : activeTaskTab === 'plan' ? (
                <PlanContent taskId={task.id} />
              ) : (
                <ArtifactsContent
                  taskId={task.id}
                  artifacts={artifacts}
                  artifactsDir={artifactsDir}
                />
              )}
            </div>
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
