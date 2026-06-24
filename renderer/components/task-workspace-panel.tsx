import { useEffect, useState } from 'react'
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued'
import {
  Check,
  CheckCircle2,
  Circle,
  FileDiff,
  GitBranch,
  GitCommit,
  GitCompare,
  Hammer,
  Layers,
  Loader2,
  Pencil,
  Play,
  Trash2,
  Undo2,
} from 'lucide-react'

import { TaskTerminal } from '@/components/task-terminal'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { RoleAvatar } from '@/components/roles-dialog'
import {
  AGENT_NAMES,
  buildAgentCommand,
  isTaskComplete,
  taskExecutionAgent,
} from '@/lib/claude'
import { getDiff, getPlan } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { ColumnId, DiffFile, Role, SubAgentRun, Task } from '@/lib/types'

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
  onMoveBack: (task: Task) => void
  onComplete: (task: Task) => void
  onReview: (taskId: string) => void
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
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border/70 px-3">
        <h2 className="flex min-w-0 items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
          {icon}
          <span className="truncate">{title}</span>
        </h2>
        {actions}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
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
    <div className="space-y-3 text-sm">
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
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400">
              reviewer: {reviewerRole.name}
            </span>
          )}
        </div>
      )}

      {task.description && (
        <p className="whitespace-pre-wrap break-words rounded-md bg-muted/30 p-2.5 text-xs leading-relaxed text-muted-foreground">
          {task.description}
        </p>
      )}

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

function PlanContent({ taskId }: { taskId: string }) {
  const [plan, setPlan] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    let active = true
    setPlan(undefined)
    getPlan(taskId)
      .then((next) => {
        if (active) setPlan(next)
      })
      .catch(() => {
        if (active) setPlan(null)
      })
    return () => {
      active = false
    }
  }, [taskId])

  if (plan === undefined) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        讀取 plan 中…
      </div>
    )
  }

  if (!plan?.trim()) {
    return (
      <p className="py-10 text-center text-xs text-muted-foreground">
        尚未找到 agent 產出的 PLAN.md。
      </p>
    )
  }

  return (
    <pre className="whitespace-pre-wrap break-words rounded-md bg-muted/30 p-3 font-mono text-xs leading-relaxed text-muted-foreground">
      {plan}
    </pre>
  )
}

function DiffContent({ taskId }: { taskId: string }) {
  const [files, setFiles] = useState<DiffFile[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
  }, [taskId])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        讀取 diff 中…
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs">
        {error}
      </div>
    )
  }

  if (files.length === 0) {
    return (
      <p className="py-10 text-center text-xs text-muted-foreground">
        與基準分支相比沒有已提交的變更。
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {files.map((file) => (
        <div key={file.path} className="overflow-hidden rounded-md border border-border/70">
          <div className="flex items-center gap-2 border-b border-border/70 bg-muted/30 px-2 py-1.5">
            <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground">
              {STATUS_LABEL[file.status] ?? file.status}
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-[11px]" title={file.path}>
              {file.path}
            </span>
          </div>
          <div className="text-[11px]">
            <ReactDiffViewer
              oldValue={file.oldValue}
              newValue={file.newValue}
              splitView={false}
              useDarkTheme
              compareMethod={DiffMethod.LINES}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

function GitGraphContent({ task }: { task: Task }) {
  return (
    <div className="space-y-3 text-xs text-muted-foreground">
      <div className="space-y-2 rounded-md bg-muted/30 p-3">
        {task.baseBranch && (
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-muted-foreground/60" />
            <span className="min-w-0 break-all">{task.baseBranch}</span>
          </div>
        )}
        <div className="ml-1 h-5 border-l border-border" />
        <div className="flex items-center gap-2 text-foreground">
          <span className="size-2 rounded-full bg-primary" />
          <span className="min-w-0 break-all">{task.branch}</span>
        </div>
      </div>
      <p>
        Git graph 真實提交 DAG 尚未接入資料來源；目前顯示任務分支與 base branch 摘要。
      </p>
    </div>
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
  onMoveBack,
  onComplete,
  onReview,
  onEdit,
  onDelete,
  onOpenReviewPanel,
  onOpenSubAgents,
}: TaskWorkspacePanelProps) {
  const [activeTaskTab, setActiveTaskTab] = useState<'task' | 'plan'>('task')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const cwd = task.worktreePath ?? task.projectPath ?? null
  const canLaunch = column === 'backlog' || column === 'in_progress'
  const activeAgent = taskExecutionAgent(task)
  const agentName = AGENT_NAMES[activeAgent]
  const launchCommand = launch?.command
  const launchNonce = launch?.nonce ?? 0

  const requestLaunch = () => {
    if (column === 'backlog') onStart(task)
    else onRun(task)
  }

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate text-sm font-semibold">{task.title}</span>
          </div>
        </div>

        {canLaunch && (
          <Button size="sm" variant="outline" onClick={requestLaunch} disabled={!cwd}>
            <Play className="size-3.5" />
            {task.launchedAt ? '重跑' : column === 'backlog' ? '開始' : `啟動 ${agentName}`}
          </Button>
        )}
        {column === 'in_progress' && (
          <>
            <IconButton aria-label="退回 Backlog" title="退回 Backlog" onClick={() => onMoveBack(task)}>
              <Undo2 className="size-4" />
            </IconButton>
            <Button size="sm" onClick={() => onComplete(task)} title="標記完成後會清理 PTY 與 worktree">
              <Check className="size-3.5" />
              完成
            </Button>
          </>
        )}
        <IconButton aria-label="編輯任務" title="編輯任務" onClick={() => onEdit(task.id)}>
          <Pencil className="size-4" />
        </IconButton>
        {task.worktreePath && (
          <IconButton aria-label="審查變更" title="審查變更" onClick={() => onReview(task.id)}>
            <GitCompare className="size-4" />
          </IconButton>
        )}
        {task.pipeline?.stage === 'reviewing' && column !== 'done' && (
          <IconButton
            aria-label="查看 Reviewer 終端"
            title="查看 Reviewer 終端"
            className="text-amber-500 hover:text-amber-400"
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

      <main className="grid min-h-0 flex-1 grid-rows-[minmax(18rem,1fr)_minmax(18rem,45%)] overflow-hidden lg:grid-cols-[minmax(20rem,1fr)_minmax(20rem,24rem)] lg:grid-rows-1 xl:grid-cols-[minmax(0,1fr)_minmax(21rem,27rem)]">
        <div className="flex min-h-0 min-w-0 flex-col border-b border-border bg-black p-0 lg:border-b-0 lg:border-r">
          <TaskTerminal
            taskId={task.id}
            cwd={cwd}
            launchCommand={launchCommand}
            launchNonce={launchNonce}
            launchLabel={column === 'backlog' ? '開始任務' : `啟動 ${agentName}`}
            onLaunchRequest={canLaunch ? requestLaunch : undefined}
            readOnly={column === 'done'}
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
                      'rounded px-2 py-0.5 text-[11px]',
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

          <InfoSection title="Git diff" icon={<GitCompare className="size-3.5" />}>
            <DiffContent taskId={task.id} />
          </InfoSection>

          <InfoSection title="Git graph" icon={<GitCommit className="size-3.5" />}>
            <GitGraphContent task={task} />
          </InfoSection>
        </aside>
      </main>
    </div>
  )
}

export function buildWorkspaceLaunchCommand({
  task,
  role,
  systemPrompt,
  workspacePath,
  resume,
}: {
  task: Task
  role: Role | null
  systemPrompt: string
  workspacePath?: string
  resume?: boolean
}): string {
  return buildAgentCommand(task, systemPrompt, role ?? undefined, { resume }, workspacePath)
}
