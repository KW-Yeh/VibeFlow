import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Eye,
  FolderGit2,
  GitBranch,
  GitCompare,
  Hammer,
  ListChecks,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Settings,
  Terminal as TerminalIcon,
  Trash2,
  Undo2,
  Users,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { TaskTerminal } from '@/components/task-terminal'
import { SubAgentDrawer } from '@/components/sub-agent-drawer'
import { RoleAvatar } from '@/components/roles-dialog'
import {
  AGENT_NAMES,
  buildAgentCommand,
  buildReviewCommand,
  buildReviseCommand,
  isTaskComplete,
  taskAgent,
} from '@/lib/claude'
import { termKill } from '@/lib/api'
import { cn } from '@/lib/utils'
import type {
  BoardState,
  ColumnId,
  ReviewVerdict,
  Role,
  SubAgentRun,
  Task,
} from '@/lib/types'

// Views in the segmented control. In Progress comes first because it is the
// page users live in; Backlog and Done are secondary, freely switchable views.
// All three panels stay mounted — switching only toggles visibility — so the
// terminals (PTY + scrollback) on In Progress cards survive view changes.
const VIEWS: { id: ColumnId; title: string }[] = [
  { id: 'in_progress', title: 'In Progress' },
  { id: 'backlog', title: 'Backlog' },
  { id: 'done', title: 'Done' },
]

const EMPTY_HINTS: Record<ColumnId, string> = {
  in_progress: '沒有進行中的任務 — 到 Backlog 按 ▶ 開始執行',
  backlog: '佇列是空的 — 點「新增任務」建立卡片',
  done: '還沒有完成的任務',
}

interface KanbanBoardProps {
  board: BoardState
  onBoardChange: (board: BoardState) => void
  onNewTask: () => void
  onReview: (taskId: string) => void
  onEditTask: (taskId: string) => void
  onTaskDone: (taskId: string) => void
  onDeleteTask: (taskId: string) => void
  /** Global Auto Mode: auto-run a card's Claude execution on entering In Progress. */
  autoMode: boolean
  onToggleAutoMode: () => void
  /** Custom system prompt for launches ('' = use the built-in default). */
  systemPrompt: string
  onOpenSettings: () => void
  /** Roles available for assignment / display. */
  roles: Role[]
  onManageRoles: () => void
  /** Live sub-agent runs keyed by task id (session-only, not persisted). */
  subAgents: Record<string, SubAgentRun[]>
}

interface LaunchEntry {
  command: string
  nonce: number
}

/** Derive the reviewer session key from a task id (mirrors main/helpers/pty.ts). */
function reviewSessionKey(taskId: string): string {
  return `${taskId}:review`
}

// Visual treatment for each pipeline stage shown on the card's status badge.
const STAGE_BADGE: Record<
  NonNullable<Task['pipeline']>['stage'],
  { label: string; icon: typeof Eye; tone: string }
> = {
  developing: {
    label: '開發中',
    icon: Hammer,
    tone: 'bg-secondary text-secondary-foreground',
  },
  reviewing: {
    label: '審查中',
    icon: Eye,
    tone: 'bg-amber-500/15 text-amber-500',
  },
  revising: {
    label: '修正中',
    icon: RefreshCw,
    tone: 'bg-amber-500/15 text-amber-500',
  },
  approved: {
    label: '已通過',
    icon: CheckCheck,
    tone: 'bg-primary/15 text-primary',
  },
  blocked: {
    label: '需人工介入',
    icon: AlertTriangle,
    tone: 'bg-destructive/15 text-destructive',
  },
}

/**
 * Status chip for a pipeline task: shows the current review-loop stage, the
 * round number while iterating, and the reviewer persona while reviewing.
 */
function PipelineBadge({
  task,
  reviewerRole,
}: {
  task: Task
  reviewerRole: Role | null
}) {
  const p = task.pipeline
  if (!p) return null
  const meta = STAGE_BADGE[p.stage]
  const Icon = meta.icon
  const suffix =
    p.stage === 'revising'
      ? ` · 第 ${p.round} 輪`
      : p.stage === 'blocked'
        ? ` · 已達 ${p.maxRounds} 輪`
        : ''
  return (
    <span
      className={cn(
        'mb-1.5 inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
        meta.tone
      )}
      title={p.lastReview?.summary ?? `Code Reviewer：${reviewerRole?.name ?? '未指派'}`}
    >
      <Icon className="size-2.5 shrink-0" />
      <span className="truncate">
        {meta.label}
        {suffix}
        {p.stage === 'reviewing' && reviewerRole ? ` · ${reviewerRole.name}` : ''}
      </span>
    </span>
  )
}

/**
 * Clickable chip showing how many sub-agents this card's agent has spawned via
 * the Task tool, with a live count of those still running. Opens the read-only
 * sub-agent drawer. Distinct from PipelineBadge (the in-session reviewer loop).
 */
function SubAgentBadge({
  runs,
  onOpen,
}: {
  runs: SubAgentRun[]
  onOpen: () => void
}) {
  if (runs.length === 0) return null
  const running = runs.filter((r) => r.status === 'running').length
  return (
    <button
      type="button"
      onClick={onOpen}
      title="查看子代理收到的 prompt 與執行狀況"
      className={cn(
        'mb-1.5 inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
        running > 0
          ? 'bg-amber-500/15 text-amber-500'
          : 'bg-secondary text-secondary-foreground hover:bg-accent'
      )}
    >
      <Bot className="size-2.5 shrink-0" />
      <span className="truncate">
        子代理 {runs.length}
        {running > 0 ? ` · ${running} 執行中` : ''}
      </span>
    </button>
  )
}

interface TaskCardProps {
  task: Task
  column: ColumnId
  /** Resolved executor role assigned to this task, if any. */
  role: Role | null
  /** Resolved reviewer role (pipeline tasks only), if any. */
  reviewerRole: Role | null
  /** Sub-agents this card's agent spawned this session (Task-tool hooks). */
  subAgents: SubAgentRun[]
  isExpanded: boolean
  isMounted: boolean
  launch?: LaunchEntry
  /** Armed launch for the reviewer's independent PTY session. */
  reviewerLaunch?: LaunchEntry
  onToggleExpanded: (taskId: string) => void
  /** Open the read-only sub-agent drawer for this card. */
  onOpenSubAgents: (taskId: string) => void
  /** In Progress: (re-)launch Claude in place. */
  onRun: (task: Task) => void
  /** Backlog: move the card into In Progress and launch Claude. */
  onStart: (task: Task) => void
  /** In Progress → Backlog. */
  onMoveBack: (task: Task) => void
  /** In Progress → Done (tears down PTY + worktree). */
  onComplete: (task: Task) => void
  onReview: (taskId: string) => void
  onEdit: (taskId: string) => void
  onDelete: (taskId: string) => void
  /**
   * Manually (re-)arm the reviewer PTY for a reviewing-stage task. Needed so
   * the reviewer pane's launch button can trigger a reviewer restart after an
   * app reload cleared the in-memory reviewerLaunch state.
   */
  onReviewerRun?: (task: Task) => void
}

// Module-level component (not defined inside KanbanBoard) so its identity is
// stable across renders — an inline component type would remount the subtree
// every render and kill the embedded terminal.
function TaskCard({
  task,
  column,
  role,
  reviewerRole,
  subAgents,
  isExpanded,
  isMounted,
  launch,
  reviewerLaunch,
  onToggleExpanded,
  onOpenSubAgents,
  onRun,
  onStart,
  onMoveBack,
  onComplete,
  onReview,
  onEdit,
  onDelete,
  onReviewerRun,
}: TaskCardProps) {
  const cwd = task.worktreePath ?? task.projectPath ?? null
  const agentName = AGENT_NAMES[taskAgent(task)]
  const progress = task.progress
  const totalSteps = progress?.steps.length ?? 0
  const doneSteps = progress?.steps.filter((s) => s.done).length ?? 0
  const hasProgress = !!progress && totalSteps > 0
  // Step list + description start collapsed so the terminal owns the card's
  // height — a buried terminal hides that the agent already finished.
  const [showDetails, setShowDetails] = useState(false)
  return (
    // Expanded cards get a fixed per-column height (In Progress taller than
    // Backlog/Done) so the grid rows stay aligned; inner content scrolls and
    // the terminal absorbs the leftover space instead of stretching the card.
    <div
      className={cn(
        'flex flex-col rounded-lg border bg-card p-3',
        isExpanded && 'overflow-hidden',
        isExpanded && (column === 'in_progress' ? 'h-[34rem]' : 'h-[26rem]')
      )}
    >
      <div className="flex shrink-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          {task.projectName && (
            <span className="mb-1.5 inline-flex max-w-full items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground">
              <FolderGit2 className="size-2.5 shrink-0" />
              <span className="truncate">{task.projectName}</span>
            </span>
          )}
          <p className="mb-2 break-words text-sm font-medium">{task.title}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {role && (
              <span
                className="mb-1.5 inline-flex max-w-full items-center gap-1 rounded-full bg-secondary py-0.5 pl-0.5 pr-2 text-[10px] font-medium text-secondary-foreground"
                title={`執行角色：${role.name}`}
              >
                <RoleAvatar role={role} className="size-4 text-[8px]" />
                <span className="truncate">{role.name}</span>
              </span>
            )}
            <PipelineBadge task={task} reviewerRole={reviewerRole} />
            <SubAgentBadge
              runs={subAgents}
              onOpen={() => onOpenSubAgents(task.id)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex min-w-0 max-w-full items-center gap-1">
              <GitBranch className="size-3 shrink-0" />
              <span className="break-all">{task.branch}</span>
            </span>
            {task.pushed && (
              <span className="text-[10px] uppercase tracking-wide text-primary">
                pushed
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {column === 'backlog' && cwd && (
            <button
              type="button"
              onClick={() => onStart(task)}
              title={`移至 In Progress 並啟動 ${agentName}`}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-primary"
            >
              <Play className="size-3.5" />
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
                  className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-primary"
                >
                  <Play className="size-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => onMoveBack(task)}
                title="退回 Backlog"
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Undo2 className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onComplete(task)}
                title="標記完成（清理 PTY 與 worktree）"
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-primary"
              >
                <Check className="size-3.5" />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => onEdit(task.id)}
            title="編輯任務"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Pencil className="size-3.5" />
          </button>
          {task.worktreePath && (
            <button
              type="button"
              onClick={() => onReview(task.id)}
              title="審查變更"
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <GitCompare className="size-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => onToggleExpanded(task.id)}
            title={isExpanded ? '收合終端' : '展開終端'}
            className="flex items-center rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <TerminalIcon className="size-3.5" />
            {isExpanded ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
          </button>
          <button
            type="button"
            onClick={() => onDelete(task.id)}
            title="刪除卡片（並清理 worktree）"
            className="rounded p-1 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Progress bar lives outside the header flex row so it spans the full
          card width instead of being squeezed beside the action buttons. On an
          expanded card it doubles as the toggle for the step-list details. */}
      {hasProgress && (
        <div className="mt-2 shrink-0 space-y-1">
          <button
            type="button"
            onClick={() => isExpanded && setShowDetails((v) => !v)}
            disabled={!isExpanded}
            title={
              isExpanded
                ? showDetails
                  ? '收合進度詳情'
                  : '展開進度詳情'
                : undefined
            }
            className={cn(
              'flex w-full items-center justify-between text-[10px] text-muted-foreground',
              isExpanded ? 'hover:text-foreground' : 'cursor-default'
            )}
          >
            <span className="inline-flex items-center gap-1">
              <ListChecks className="size-3 shrink-0" />
              進度
              {isExpanded &&
                (showDetails ? (
                  <ChevronDown className="size-3" />
                ) : (
                  <ChevronRight className="size-3" />
                ))}
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
        </div>
      )}

      {isMounted && (
        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col',
            !isExpanded && 'hidden'
          )}
        >
          {!hasProgress && task.description && (
            <button
              type="button"
              onClick={() => setShowDetails((v) => !v)}
              title={showDetails ? '收合任務說明' : '展開任務說明'}
              className="mt-2 flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
            >
              {showDetails ? (
                <ChevronDown className="size-3" />
              ) : (
                <ChevronRight className="size-3" />
              )}
              任務說明
            </button>
          )}
          {/* Details are capped so the terminal keeps the lion's share of the
              card even with the step list open. */}
          {showDetails && (hasProgress || task.description) && (
            <div className="mt-2 max-h-44 shrink-0 space-y-2 overflow-y-auto">
              {hasProgress && (
                <ul className="space-y-1 rounded-md bg-muted/40 p-2.5 text-xs">
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
              {task.description && (
                <p className="whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2.5 text-xs text-muted-foreground">
                  {task.description}
                </p>
              )}
            </div>
          )}
          {/* Executor terminal — always rendered for In Progress and Done cards. */}
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
          {/* Reviewer terminal — rendered only while the pipeline is in the
              reviewing stage. Uses a composite session key so it runs in an
              independent PTY that can coexist with the executor session. */}
          {task.pipeline?.stage === 'reviewing' && column !== 'done' && (
            <div className="mt-1">
              <div className="mb-0.5 flex items-center gap-1 text-[10px] text-amber-500">
                <Eye className="size-3 shrink-0" />
                <span>Reviewer — {reviewerRole?.name ?? '審查中'}</span>
              </div>
              <TaskTerminal
                taskId={task.id}
                sessionKey={reviewSessionKey(task.id)}
                cwd={cwd}
                launchCommand={reviewerLaunch?.command}
                launchNonce={reviewerLaunch?.nonce ?? 0}
                launchLabel="啟動 Reviewer"
                onLaunchRequest={onReviewerRun ? () => onReviewerRun(task) : undefined}
                readOnly={false}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function KanbanBoard({
  board,
  onBoardChange,
  onNewTask,
  onReview,
  onEditTask,
  onTaskDone,
  onDeleteTask,
  autoMode,
  onToggleAutoMode,
  systemPrompt,
  onOpenSettings,
  roles,
  onManageRoles,
  subAgents,
}: KanbanBoardProps) {
  const roleById = (id?: string): Role | null =>
    (id && roles.find((r) => r.id === id)) || null
  // Task whose sub-agent drawer is open (null = closed).
  const [subAgentTaskId, setSubAgentTaskId] = useState<string | null>(null)
  // Active view. In Progress is the home view; the other two are reachable via
  // the segmented control. Hidden views stay mounted (CSS only).
  const [view, setView] = useState<ColumnId>('in_progress')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // Tasks whose terminal has ever been opened. Once mounted, the `TaskTerminal`
  // stays mounted (just hidden when collapsed) so its PTY + scrollback survive
  // toggling and the launch command runs only once.
  const [mounted, setMounted] = useState<Set<string>>(new Set())
  // Per-task armed launch command; bumping `nonce` (re-)fires it in the terminal.
  const [launch, setLaunch] = useState<Record<string, LaunchEntry>>({})
  // Per-task armed reviewer launch command (reviewer pane, `${taskId}:review` session).
  const [reviewerLaunch, setReviewerLaunch] = useState<Record<string, LaunchEntry>>({})

  const markMounted = (taskId: string) =>
    setMounted((prev) => (prev.has(taskId) ? prev : new Set(prev).add(taskId)))

  // A task has run before once it carries a launch timestamp. Re-executing such
  // a task resumes its prior agent session instead of starting fresh.
  const wasLaunched = (task: Task) => task.launchedAt != null

  const toggleExpanded = (taskId: string) => {
    const wasExpanded = expanded.has(taskId)
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
    markMounted(taskId)
    // Opening the terminal of an In Progress card that was launched before but
    // has no live launch armed (e.g. after an app restart wiped the PTY)
    // auto-resumes its agent session, continuing from the recorded progress.
    // A finished task just gets an open shell — no command is sent.
    if (!wasExpanded && !launch[taskId]) {
      const task = board.in_progress.find((t) => t.id === taskId)
      if (task && wasLaunched(task) && !isTaskComplete(task)) {
        armLaunch(task, { resume: true })
      }
    }
  }

  // Expand the card, mount its terminal, and arm a (re-)launch of `command`.
  // Bumping the nonce is what fires it in the TaskTerminal.
  const armCommand = (taskId: string, command: string) => {
    setExpanded((prev) => new Set(prev).add(taskId))
    markMounted(taskId)
    setLaunch((prev) => ({
      ...prev,
      [taskId]: { command, nonce: (prev[taskId]?.nonce ?? 0) + 1 },
    }))
  }

  // Arm the executor launch for a card (the default, non-pipeline launch path).
  // `resume` continues the prior session rather than starting a fresh one.
  const armLaunch = (task: Task, opts?: { resume?: boolean }) => {
    armCommand(
      task.id,
      buildAgentCommand(task, systemPrompt, roleById(task.roleId), opts)
    )
  }

  // Merge a patch into a task across all columns and persist (used by the
  // pipeline orchestrator to advance stage / round state).
  const patchTask = (taskId: string, patch: Partial<Task>) => {
    onBoardChange({
      backlog: board.backlog.map((t) =>
        t.id === taskId ? { ...t, ...patch } : t
      ),
      in_progress: board.in_progress.map((t) =>
        t.id === taskId ? { ...t, ...patch } : t
      ),
      done: board.done.map((t) => (t.id === taskId ? { ...t, ...patch } : t)),
    })
  }

  // --- Auto-assign pipeline orchestration ---
  //
  // For tasks with both an executor (roleId) and a reviewer (reviewerRoleId),
  // drive the executor → reviewer → (revise → reviewer)* → approve loop in a
  // single worktree. Transitions are event-driven off live progress updates
  // (mirrored into `board`), so they only fire while an agent is actively
  // working — never spuriously on app reload. Gated on Auto Mode, the global
  // automation switch.
  //
  // `firedRef` dedupes by a (stage, allDone, verdict, round) signature so an
  // identical board snapshot can't re-trigger the same hand-off twice.
  const firedRef = useRef<Map<string, string>>(new Map())

  /**
   * Kill the reviewer's independent PTY session (does not affect the executor).
   * Called when transitioning out of the reviewing stage.
   */
  const killReviewerSession = (taskId: string) => {
    termKill(reviewSessionKey(taskId))
    setReviewerLaunch((prev) => {
      if (!prev[taskId]) return prev
      const next = { ...prev }
      delete next[taskId]
      return next
    })
  }

  /**
   * Arm (or re-arm) the reviewer's independent PTY slot (`${taskId}:review`).
   * Expand + mount the card so the reviewer pane is visible, then bump the
   * nonce to fire the launch command. Extracted so both `advanceToReview` (auto
   * orchestrator) and the manual "啟動 Reviewer" button (post-reload recovery)
   * share the same arming logic.
   */
  const armReviewer = (task: Task) => {
    setExpanded((prev) => new Set(prev).add(task.id))
    markMounted(task.id)
    setReviewerLaunch((prev) => ({
      ...prev,
      [task.id]: {
        command: buildReviewCommand(task, roleById(task.reviewerRoleId)),
        nonce: (prev[task.id]?.nonce ?? 0) + 1,
      },
    }))
  }

  /**
   * Transition to the reviewing stage and arm the reviewer launch in its
   * dedicated PTY slot. The executor session is left running (but idle) while
   * reviewing; the two PTYs coexist via the composite session key.
   */
  const advanceToReview = (task: Task) => {
    const next = { ...task.pipeline!, stage: 'reviewing' as const }
    patchTask(task.id, { pipeline: next })
    armReviewer(task)
  }

  const advanceToRevise = (task: Task, review: ReviewVerdict) => {
    const next = {
      ...task.pipeline!,
      stage: 'revising' as const,
      round: task.pipeline!.round + 1,
      lastReview: review,
    }
    patchTask(task.id, { pipeline: next })
    // Kill the reviewer session before re-launching the executor.
    killReviewerSession(task.id)
    // Arm the executor fresh launch (--continue) for the revise stage.
    armCommand(
      task.id,
      buildReviseCommand(task, roleById(task.roleId), review.comments)
    )
  }

  useEffect(() => {
    if (!autoMode) return
    // Act on at most one transition per pass; the resulting board change
    // re-runs this effect to handle any remaining tasks, avoiding clobbered
    // onBoardChange writes from a stale closure.
    for (const task of board.in_progress) {
      const p = task.pipeline
      if (!p || !task.reviewerRoleId) continue
      if (p.stage === 'approved' || p.stage === 'blocked') continue

      const allDone = isTaskComplete(task)
      const review = task.progress?.review
      const sig = `${p.stage}|${allDone}|${review?.verdict ?? 'none'}|${p.round}`
      if (firedRef.current.get(task.id) === sig) continue

      // Executor finished (and hasn't yet been reviewed this round) → review.
      if ((p.stage === 'developing' || p.stage === 'revising') && allDone && !review) {
        firedRef.current.set(task.id, sig)
        advanceToReview(task)
        break
      }
      // Reviewer produced a verdict → approve, send back, or escalate.
      if (p.stage === 'reviewing' && review) {
        firedRef.current.set(task.id, sig)
        if (review.verdict === 'approve') {
          // Kill the reviewer session — it's done; executor session stays.
          killReviewerSession(task.id)
          patchTask(task.id, {
            pipeline: { ...p, stage: 'approved', lastReview: review },
          })
        } else if (p.round + 1 > p.maxRounds) {
          // Blocked: kill reviewer, require manual intervention.
          killReviewerSession(task.id)
          patchTask(task.id, {
            pipeline: { ...p, stage: 'blocked', lastReview: review },
          })
        } else {
          // advanceToRevise kills the reviewer session internally before
          // arming the executor revise command.
          advanceToRevise(task, review)
        }
        break
      }
    }
    // eslint/exhaustive-deps not configured here; the board snapshot + the
    // automation switch are the only inputs that should retrigger evaluation.
  }, [board, autoMode, systemPrompt, roles])

  // Manual run (▶ on an In Progress card): (re-)launches in place, resuming the
  // prior session when the task has run before, and stamps launchedAt once.
  const runTask = (task: Task) => {
    armLaunch(task, { resume: wasLaunched(task) })
    if (!task.launchedAt) {
      const stamp = Date.now()
      onBoardChange({
        backlog: board.backlog.map((t) =>
          t.id === task.id ? { ...t, launchedAt: stamp } : t
        ),
        in_progress: board.in_progress.map((t) =>
          t.id === task.id ? { ...t, launchedAt: stamp } : t
        ),
        done: board.done.map((t) =>
          t.id === task.id ? { ...t, launchedAt: stamp } : t
        ),
      })
    }
  }

  // Cross-column move; preserves the semantics the drag-and-drop board had:
  // entering In Progress auto-runs once (Auto Mode), entering Done finalizes.
  const moveTask = (
    task: Task,
    to: ColumnId,
    opts?: { forceLaunch?: boolean }
  ) => {
    // A finished task is never auto-run on entering In Progress — it just keeps
    // its terminal available (per the resume spec: completed → no auto command).
    const willLaunch =
      to === 'in_progress' &&
      !isTaskComplete(task) &&
      (opts?.forceLaunch === true || (autoMode && !task.launchedAt))
    const toInsert =
      willLaunch && !task.launchedAt
        ? { ...task, launchedAt: Date.now() }
        : task

    const next: BoardState = {
      backlog: board.backlog.filter((t) => t.id !== task.id),
      in_progress: board.in_progress.filter((t) => t.id !== task.id),
      done: board.done.filter((t) => t.id !== task.id),
    }
    next[to] = [toInsert, ...next[to]]
    onBoardChange(next)

    // Moving a card into Done finalizes it: tear down PTY + worktree, and
    // auto-collapse the terminal — a finished card no longer needs it open.
    if (to === 'done') {
      setExpanded((prev) => {
        if (!prev.has(task.id)) return prev
        const collapsed = new Set(prev)
        collapsed.delete(task.id)
        return collapsed
      })
      onTaskDone(task.id)
    }
    if (willLaunch) armLaunch(toInsert, { resume: wasLaunched(task) })
  }

  // ▶ on a Backlog card: pull it into In Progress, switch there, and launch.
  const startTask = (task: Task) => {
    moveTask(task, 'in_progress', { forceLaunch: true })
    setView('in_progress')
  }

  const completeTask = (task: Task) => moveTask(task, 'done')
  const moveBackTask = (task: Task) => moveTask(task, 'backlog')

  return (
    <div className="min-h-screen bg-background p-6 text-foreground">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">VibeFlow</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            意圖驅動的本地開發看板 · 可同時管理多個專案
          </p>
        </div>

        {/* Segmented view switcher — pill grammar per DESIGN.md: the full-pill
            radius is the action signal, with the single blue accent. */}
        <nav
          role="tablist"
          aria-label="看板分頁"
          className="inline-flex items-center gap-1 rounded-full border border-border/40 bg-card p-1"
        >
          {VIEWS.map((v) => {
            const active = view === v.id
            return (
              <button
                key={v.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setView(v.id)}
                className={cn(
                  'flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm transition-colors active:scale-95',
                  active
                    ? 'bg-primary font-semibold text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {v.title}
                <span
                  className={cn(
                    'text-[11px] tabular-nums',
                    active
                      ? 'text-primary-foreground/75'
                      : 'text-muted-foreground'
                  )}
                >
                  {board[v.id].length}
                </span>
              </button>
            )
          })}
        </nav>

        <div className="flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={autoMode}
            onClick={onToggleAutoMode}
            title="開啟時：將卡片移至 In Progress 會自動執行 Agent"
            className="flex items-center gap-2 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <span
              className={cn(
                'relative inline-block h-4 w-7 shrink-0 rounded-full transition-colors',
                autoMode ? 'bg-primary' : 'bg-muted'
              )}
            >
              <span
                className={cn(
                  'absolute left-0 top-0.5 size-3 rounded-full bg-white transition-transform',
                  autoMode ? 'translate-x-3.5' : 'translate-x-0.5'
                )}
              />
            </span>
            Auto Mode
          </button>
          <button
            type="button"
            onClick={onManageRoles}
            title="管理角色"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Users className="size-4" />
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            title="設定（System Prompt）"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Settings className="size-4" />
          </button>
          <Button
            size="sm"
            className="rounded-full active:scale-95"
            onClick={onNewTask}
          >
            <Plus />
            新增任務
          </Button>
        </div>
      </header>

      {/* All panels stay mounted; only visibility toggles, so In Progress
          terminals keep running while browsing Backlog / Done. */}
      <main>
        {VIEWS.map((v) => (
          <section
            key={v.id}
            role="tabpanel"
            aria-label={v.title}
            className={cn(view !== v.id && 'hidden')}
          >
            {board[v.id].length === 0 ? (
              <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed border-border/40 text-sm text-muted-foreground">
                {EMPTY_HINTS[v.id]}
              </div>
            ) : (
              <div
                className={cn(
                  'grid grid-cols-1 items-start gap-4',
                  v.id === 'in_progress'
                    ? 'lg:grid-cols-2 2xl:grid-cols-3'
                    : 'md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'
                )}
              >
                {board[v.id].map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    column={v.id}
                    role={roleById(task.roleId)}
                    reviewerRole={roleById(task.reviewerRoleId)}
                    subAgents={subAgents[task.id] ?? []}
                    isExpanded={expanded.has(task.id)}
                    isMounted={mounted.has(task.id)}
                    launch={launch[task.id]}
                    reviewerLaunch={reviewerLaunch[task.id]}
                    onToggleExpanded={toggleExpanded}
                    onOpenSubAgents={setSubAgentTaskId}
                    onRun={runTask}
                    onStart={startTask}
                    onMoveBack={moveBackTask}
                    onComplete={completeTask}
                    onReview={onReview}
                    onEdit={onEditTask}
                    onDelete={onDeleteTask}
                    onReviewerRun={armReviewer}
                  />
                ))}
              </div>
            )}
          </section>
        ))}
      </main>

      <SubAgentDrawer
        open={subAgentTaskId !== null}
        taskTitle={
          (subAgentTaskId &&
            Object.values(board)
              .flat()
              .find((t) => t.id === subAgentTaskId)?.title) ||
          ''
        }
        runs={(subAgentTaskId && subAgents[subAgentTaskId]) || []}
        onClose={() => setSubAgentTaskId(null)}
      />
    </div>
  )
}
