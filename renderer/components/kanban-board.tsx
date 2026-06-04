import { useState } from 'react'
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  FolderGit2,
  GitBranch,
  GitCompare,
  ListChecks,
  Pencil,
  Play,
  Plus,
  Settings,
  Terminal as TerminalIcon,
  Trash2,
  Undo2,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { TaskTerminal } from '@/components/task-terminal'
import { AGENT_NAMES, buildAgentCommand, taskAgent } from '@/lib/claude'
import { cn } from '@/lib/utils'
import type { BoardState, ColumnId, Task } from '@/lib/types'

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
}

interface LaunchEntry {
  command: string
  nonce: number
}

interface TaskCardProps {
  task: Task
  column: ColumnId
  isExpanded: boolean
  isMounted: boolean
  launch?: LaunchEntry
  onToggleExpanded: (taskId: string) => void
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
}

// Module-level component (not defined inside KanbanBoard) so its identity is
// stable across renders — an inline component type would remount the subtree
// every render and kill the embedded terminal.
function TaskCard({
  task,
  column,
  isExpanded,
  isMounted,
  launch,
  onToggleExpanded,
  onRun,
  onStart,
  onMoveBack,
  onComplete,
  onReview,
  onEdit,
  onDelete,
}: TaskCardProps) {
  const cwd = task.worktreePath ?? task.projectPath ?? null
  const agentName = AGENT_NAMES[taskAgent(task)]
  const progress = task.progress
  const totalSteps = progress?.steps.length ?? 0
  const doneSteps = progress?.steps.filter((s) => s.done).length ?? 0
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {task.projectName && (
            <span className="mb-1.5 inline-flex max-w-full items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground">
              <FolderGit2 className="size-2.5 shrink-0" />
              <span className="truncate">{task.projectName}</span>
            </span>
          )}
          <p className="mb-2 break-words text-sm font-medium">{task.title}</p>
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
          card width instead of being squeezed beside the action buttons. */}
      {progress && totalSteps > 0 && (
        <div className="mt-2 space-y-1">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <ListChecks className="size-3 shrink-0" />
              進度
            </span>
            <span className="tabular-nums">
              {doneSteps}/{totalSteps}
            </span>
          </div>
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
        <div className={cn(!isExpanded && 'hidden')}>
          {progress && totalSteps > 0 && (
            <ul className="mt-2 space-y-1 rounded-md bg-muted/40 p-2.5 text-xs">
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
            <p className="mt-2 whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2.5 text-xs text-muted-foreground">
              {task.description}
            </p>
          )}
          <TaskTerminal
            taskId={task.id}
            cwd={cwd}
            launchCommand={launch?.command}
            launchNonce={launch?.nonce ?? 0}
            launchLabel={`啟動 ${agentName}`}
            onLaunchRequest={() => onRun(task)}
            readOnly={column === 'done'}
          />
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
}: KanbanBoardProps) {
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

  const markMounted = (taskId: string) =>
    setMounted((prev) => (prev.has(taskId) ? prev : new Set(prev).add(taskId)))

  const toggleExpanded = (taskId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
    markMounted(taskId)
  }

  // Expand the card and arm (or re-arm) its Claude launch command.
  const armLaunch = (task: Task) => {
    setExpanded((prev) => new Set(prev).add(task.id))
    markMounted(task.id)
    setLaunch((prev) => ({
      ...prev,
      [task.id]: {
        command: buildAgentCommand(task, systemPrompt),
        nonce: (prev[task.id]?.nonce ?? 0) + 1,
      },
    }))
  }

  // Manual run (▶ on an In Progress card): always (re-)launches in place, and
  // stamps launchedAt once.
  const runTask = (task: Task) => {
    armLaunch(task)
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
    const willLaunch =
      to === 'in_progress' &&
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
    if (willLaunch) armLaunch(toInsert)
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
                    isExpanded={expanded.has(task.id)}
                    isMounted={mounted.has(task.id)}
                    launch={launch[task.id]}
                    onToggleExpanded={toggleExpanded}
                    onRun={runTask}
                    onStart={startTask}
                    onMoveBack={moveBackTask}
                    onComplete={completeTask}
                    onReview={onReview}
                    onEdit={onEditTask}
                    onDelete={onDeleteTask}
                  />
                ))}
              </div>
            )}
          </section>
        ))}
      </main>
    </div>
  )
}
