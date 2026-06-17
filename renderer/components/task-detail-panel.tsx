import { Fragment, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCheck,
  CheckCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  ClipboardList,
  Eye,
  FolderGit2,
  GitBranch,
  GitCompare,
  Hammer,
  ListChecks,
  Loader2,
  Pencil,
  Play,
  Search,
  Terminal as TerminalIcon,
  Trash2,
  Undo2,
} from 'lucide-react'
import { TaskTerminal } from '@/components/task-terminal'
import { RoleAvatar } from '@/components/roles-dialog'
import { AGENT_NAMES, isTaskComplete, taskAgent } from '@/lib/claude'
import { cn } from '@/lib/utils'
import type { ColumnId, Role, SubAgentRun, Task } from '@/lib/types'

type StageStatus = 'pending' | 'active' | 'done' | 'blocked'

interface PipelineStage {
  id: string
  label: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: React.ComponentType<{ className?: string }>
  status: StageStatus
}

const STAGE_COLORS: Record<
  StageStatus,
  { node: string; label: string; line: string }
> = {
  done: {
    node: 'border-primary/50 bg-primary/15 text-primary',
    label: 'text-primary',
    line: 'bg-primary/40',
  },
  active: {
    node: 'border-amber-500/50 bg-amber-500/15 text-amber-500',
    label: 'text-amber-500 font-semibold',
    line: 'bg-border',
  },
  pending: {
    node: 'border-border bg-muted/30 text-muted-foreground',
    label: 'text-muted-foreground',
    line: 'bg-border',
  },
  blocked: {
    node: 'border-destructive/50 bg-destructive/15 text-destructive',
    label: 'text-destructive',
    line: 'bg-border',
  },
}

function deriveStages(
  task: Task,
  column: ColumnId,
  reviewerRole: Role | null
): PipelineStage[] {
  const hasReviewer = !!reviewerRole
  const p = task.pipeline

  let planSt: StageStatus
  let checkPlanSt: StageStatus
  let executeSt: StageStatus
  let reviewSt: StageStatus

  if (column === 'done') {
    planSt = 'done'
    checkPlanSt = 'done'
    executeSt = 'done'
    reviewSt = 'done'
  } else if (column === 'in_progress') {
    if (!task.progress) {
      // No progress file yet — agent is still planning, not yet executing
      planSt = 'active'
      checkPlanSt = 'pending'
      executeSt = 'pending'
      reviewSt = 'pending'
    } else {
      planSt = 'done'
      checkPlanSt = 'done'
      const stage = p?.stage
      const complete = isTaskComplete(task)
      if (!stage || stage === 'developing') {
        executeSt = complete ? 'done' : 'active'
        reviewSt = 'pending'
      } else if (stage === 'revising') {
        executeSt = complete ? 'done' : 'active'
        reviewSt = 'active'
      } else if (stage === 'reviewing') {
        executeSt = 'done'
        reviewSt = task.progress?.review?.verdict === 'approve' ? 'done' : 'active'
      } else if (stage === 'approved') {
        executeSt = 'done'
        reviewSt = 'done'
      } else {
        // blocked
        executeSt = 'done'
        reviewSt = 'blocked'
      }
    }
  } else {
    // backlog
    planSt = 'active'
    checkPlanSt = 'pending'
    executeSt = 'pending'
    reviewSt = 'pending'
  }

  const stages: PipelineStage[] = [
    { id: 'plan', label: '規劃任務', icon: ClipboardList, status: planSt },
  ]

  // 複雜任務（有 code reviewer）才顯示「檢視並修正計劃」環節
  if (hasReviewer) {
    stages.push({
      id: 'check_plan',
      label: '檢視並修正計劃',
      icon: Search,
      status: checkPlanSt,
    })
  }

  stages.push({
    id: 'execute',
    label: '執行計劃',
    icon: Hammer,
    status: executeSt,
  })

  if (hasReviewer) {
    stages.push({
      id: 'review',
      label: '驗收與修復',
      icon: CheckCircle,
      status: reviewSt,
    })
  }

  return stages
}

function PipelineStagesBar({ stages }: { stages: PipelineStage[] }) {
  return (
    <div className="flex shrink-0 items-center justify-center border-b border-border bg-card/30 px-8 py-5 text-card-foreground">
      {stages.map((stage, i) => {
        const colors = STAGE_COLORS[stage.status]
        const Icon = stage.icon
        const isLast = i === stages.length - 1
        return (
          <Fragment key={stage.id}>
            <div className="flex flex-col items-center gap-2">
              <div
                className={cn(
                  'flex size-10 items-center justify-center rounded-full border-2 transition-colors',
                  colors.node
                )}
              >
                {stage.status === 'active' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : stage.status === 'done' ? (
                  <CheckCheck className="size-4" />
                ) : stage.status === 'blocked' ? (
                  <AlertTriangle className="size-4" />
                ) : (
                  <Icon className="size-4" />
                )}
              </div>
              <span className={cn('whitespace-nowrap text-xs', colors.label)}>
                {stage.label}
              </span>
            </div>
            {!isLast && (
              <div
                className={cn(
                  'mx-2 h-px w-12 flex-shrink-0 transition-colors md:w-16',
                  stage.status === 'done' ? 'bg-primary/40' : 'bg-border'
                )}
              />
            )}
          </Fragment>
        )
      })}
    </div>
  )
}

function PipelineStageBadge({
  task,
  reviewerRole,
}: {
  task: Task
  reviewerRole: Role | null
}) {
  const p = task.pipeline
  if (!p) return null

  const labels: Record<string, string> = {
    developing: '開發中',
    reviewing: '審查中',
    revising: '修正中',
    approved: '已通過',
    blocked: '需人工介入',
  }
  const tones: Record<string, string> = {
    developing: 'bg-secondary text-secondary-foreground',
    reviewing: 'bg-amber-500/15 text-amber-500',
    revising: 'bg-amber-500/15 text-amber-500',
    approved: 'bg-primary/15 text-primary',
    blocked: 'bg-destructive/15 text-destructive',
  }

  const suffix =
    p.stage === 'revising'
      ? ` · 第 ${p.round} 輪`
      : p.stage === 'blocked'
        ? ` · 已達 ${p.maxRounds} 輪`
        : ''

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
        tones[p.stage]
      )}
    >
      {labels[p.stage]}
      {suffix}
      {p.stage === 'reviewing' && reviewerRole ? ` · ${reviewerRole.name}` : ''}
    </span>
  )
}

interface LaunchEntry {
  command: string
  nonce: number
}

export interface TaskDetailPanelProps {
  task: Task
  column: ColumnId
  role: Role | null
  reviewerRole: Role | null
  subAgents: SubAgentRun[]
  isMounted: boolean
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
  onClose: () => void
}

export function TaskDetailPanel({
  task,
  column,
  role,
  reviewerRole,
  subAgents,
  isMounted,
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
  onClose,
}: TaskDetailPanelProps) {
  const [showSteps, setShowSteps] = useState(false)
  const stages = deriveStages(task, column, reviewerRole)
  const cwd = task.worktreePath ?? task.projectPath ?? null
  const agentName = AGENT_NAMES[taskAgent(task)]
  const progress = task.progress
  const totalSteps = progress?.steps.length ?? 0
  const doneSteps = progress?.steps.filter((s) => s.done).length ?? 0
  const hasProgress = !!progress && totalSteps > 0

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 頂部 Pipeline 進度條 */}
      <PipelineStagesBar stages={stages} />

      {/* 任務資訊區（固定高度，不隨 terminal 捲動） */}
      <div className="shrink-0 border-b border-border p-6">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            {/* 小型 meta badges */}
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
              {task.projectName && (
                <span className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground">
                  <FolderGit2 className="size-3 shrink-0" />
                  <span className="truncate">{task.projectName}</span>
                </span>
              )}
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <GitBranch className="size-3 shrink-0" />
                <span className="break-all">{task.branch}</span>
              </span>
              {task.pushed && (
                <span className="text-[10px] uppercase tracking-wide text-primary">
                  pushed
                </span>
              )}
            </div>

            <h2 className="text-lg font-semibold tracking-tight">{task.title}</h2>

            {/* 角色 + pipeline stage */}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {role && (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-secondary py-0.5 pl-0.5 pr-2 text-[10px] font-medium text-secondary-foreground"
                  title={`執行角色：${role.name}`}
                >
                  <RoleAvatar role={role} className="size-4 text-[8px]" />
                  <span>{role.name}</span>
                </span>
              )}
              <PipelineStageBadge task={task} reviewerRole={reviewerRole} />
            </div>
          </div>

          {/* 操作按鈕 */}
          <div className="flex shrink-0 flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={onClose}
              title="返回任務列表"
              className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
            </button>
            {column === 'backlog' && cwd && (
              <button
                type="button"
                onClick={() => onStart(task)}
                title={`移至 In Progress 並啟動 ${agentName}`}
                className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-primary"
              >
                <Play className="size-4" />
              </button>
            )}
            {column === 'in_progress' && (
              <>
                {cwd && (
                  <button
                    type="button"
                    onClick={() => onRun(task)}
                    title={
                      task.launchedAt
                        ? `重新執行（啟動 ${agentName}）`
                        : `開始執行（啟動 ${agentName}）`
                    }
                    className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-primary"
                  >
                    <Play className="size-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onMoveBack(task)}
                  title="退回 Backlog"
                  className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Undo2 className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onComplete(task)}
                  title="標記完成（清理 PTY 與 worktree）"
                  className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-primary"
                >
                  <Check className="size-4" />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => onEdit(task.id)}
              title="編輯任務"
              className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Pencil className="size-4" />
            </button>
            {task.worktreePath && (
              <button
                type="button"
                onClick={() => onReview(task.id)}
                title="審查變更"
                className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <GitCompare className="size-4" />
              </button>
            )}
            {task.pipeline?.stage === 'reviewing' && column !== 'done' && (
              <button
                type="button"
                onClick={() => onOpenReviewPanel?.(task.id)}
                title="查看 Reviewer 終端"
                className="rounded p-1.5 text-amber-500 hover:bg-accent hover:text-amber-400"
              >
                <Eye className="size-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => onDelete(task.id)}
              title="刪除任務（清理 worktree）"
              className="rounded p-1.5 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        </div>

        {/* 子代理執行流程 */}
        {subAgents.length > 0 && (
          <div className="mt-3 flex items-center gap-1">
            <div
              role="list"
              className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5"
            >
              {subAgents.map((run, i) => (
                <Fragment key={run.id}>
                  {i > 0 && (
                    <ChevronRight className="size-2.5 shrink-0 text-border" />
                  )}
                  <span
                    role="listitem"
                    className={cn(
                      'flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium',
                      run.status === 'running' && 'bg-amber-500/15 text-amber-500',
                      run.status === 'completed' && 'bg-primary/10 text-primary',
                      run.status === 'error' && 'bg-destructive/15 text-destructive'
                    )}
                    title={run.prompt}
                  >
                    {run.status === 'running' ? (
                      <Loader2 className="size-2.5 shrink-0 animate-spin" />
                    ) : run.status === 'completed' ? (
                      <CheckCircle2 className="size-2.5 shrink-0" />
                    ) : (
                      <AlertTriangle className="size-2.5 shrink-0" />
                    )}
                    <span className="max-w-[10rem] truncate">
                      {run.description || run.subagentType || `步驟 ${i + 1}`}
                    </span>
                  </span>
                </Fragment>
              ))}
            </div>
            <button
              type="button"
              onClick={() => onOpenSubAgents(task.id)}
              title="查看子代理執行流程"
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ChevronRight className="size-3" />
            </button>
          </div>
        )}

        {/* 進度條 */}
        {hasProgress && (
          <div className="mt-3 space-y-1">
            <button
              type="button"
              onClick={() => setShowSteps((v) => !v)}
              className="flex w-full items-center justify-between text-[10px] text-muted-foreground hover:text-foreground"
            >
              <span className="inline-flex items-center gap-1">
                <ListChecks className="size-3 shrink-0" />
                進度
                {showSteps ? (
                  <ChevronDown className="size-3" />
                ) : (
                  <ChevronRight className="size-3" />
                )}
              </span>
              <span className="tabular-nums">
                {doneSteps}/{totalSteps}
              </span>
            </button>
            <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${(doneSteps / totalSteps) * 100}%` }}
              />
            </div>
            {progress.summary && (
              <p className="truncate text-[11px] text-muted-foreground">
                {progress.summary}
              </p>
            )}
            {showSteps && (
              <ul className="mt-2 max-h-44 space-y-1 overflow-y-auto rounded-md bg-muted/40 p-2.5 text-xs">
                {progress.steps.map((step, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    {step.done ? (
                      <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-primary" />
                    ) : (
                      <Circle className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                    )}
                    <span
                      className={cn(
                        'break-words',
                        step.done && 'text-muted-foreground line-through'
                      )}
                    >
                      {step.text}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* 任務說明（無進度時顯示） */}
        {task.description && !hasProgress && (
          <p className="mt-3 whitespace-pre-wrap break-words rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
            {task.description}
          </p>
        )}
      </div>

      {/* 終端機區域 — 佔用剩餘空間 */}
      <div className="min-h-0 flex-1 p-4">
        {isMounted ? (
          <TaskTerminal
            taskId={task.id}
            sessionKey={task.id}
            cwd={cwd}
            launchCommand={launch?.command}
            launchNonce={launch?.nonce ?? 0}
            launchLabel={`啟動 ${agentName}`}
            onLaunchRequest={() => onRun(task)}
            readOnly={column === 'done'}
          />
        ) : (
          <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border/40 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <TerminalIcon className="size-4 opacity-40" />
              <span>載入終端中…</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
