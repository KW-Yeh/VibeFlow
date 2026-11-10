import {
  AnimatePresence,
  motion,
  useAnimationControls,
  useReducedMotion,
} from 'motion/react'
import { AlertTriangle, Loader2, Plus } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { BoardColumns } from '@/components/board-columns'
import { NewTaskButton } from '@/components/new-task-button'
import type { GridTerminal } from '@/components/terminal-grid'
import { TaskWorkspacePanel } from '@/components/task-workspace-panel'
import { WorkspaceTaskRail } from '@/components/workspace-task-rail'
import { ViewTabs, type BoardView } from '@/components/ui/view-tabs'
import { Button } from '@/components/ui/button'
import { DialogShell } from '@/components/ui/dialog-shell'
import {
  resetTaskRun,
  termSessionExists,
} from '@/lib/api'
import { cardMove } from '@/lib/board-moves'
import { createEnterVariants } from '@/lib/motion'
import { cn } from '@/lib/utils'
import {
  readWorkspaceRailCollapsed,
  writeWorkspaceRailCollapsed,
} from '@/lib/view-persistence'
import type {
  BoardState,
  ColumnId,
  GithubTaskLinks,
  LaunchIntent,
  Task,
  TaskProgress,
} from '@/lib/types'

interface KanbanBoardProps {
  board: BoardState
  onBoardChange: (board: BoardState) => void
  onEditTask: (taskId: string) => void
  onTaskDone: (taskId: string) => Promise<void> | void
  onDeleteTask: (taskId: string) => void
  onOpenTaskTerminal: (taskId: string) => void
  taskTerminals: GridTerminal[]
  onShowTaskTerminal: (sessionKey: string) => void
  /** Live progress of running cards keyed by task id (from core's transcript reader). */
  progress: Record<string, TaskProgress>
  /** Currently selected task id (shown on the workspace page). */
  selectedTaskId?: string | null
  /** Select a task and show its workspace. */
  onSelectTask: (taskId: string) => void
  /** A click on a board card: its sheet, not the workspace. */
  onOpenTaskSheet: (taskId: string) => void
  /** A Backlog card to start, staying on the current page; null once taken. */
  startRequest: string | null
  onStartRequest: (taskId: string | null) => void
  /** Open the new-task dialog. */
  onNewTask: () => void
  /** 'workspace' shows the task workspace; 'board' and 'github' show the board page. */
  view: BoardView
  onViewChange: (next: BoardView) => void
  /** Rendered instead of the board columns while `view` is 'github'. */
  githubView: ReactNode
  /** Each card's Issue/PR, keyed by task id. */
  taskLinks: Record<string, GithubTaskLinks>
}

interface LaunchEntry {
  launch: LaunchIntent
  nonce: number
}

/** Below this width the task rail starts folded: open beside a docked inspector, it would leave the terminal narrower than its toolbar. */
const RAIL_ROOMY_QUERY = '(min-width: 1280px)'

/** A drag backwards, waiting for the user to accept what it costs. */
interface PullBack {
  task: Task
  from: ColumnId
  to: ColumnId
}

function pullBackCopy({ task, from, to }: PullBack) {
  if (from === 'in_progress') {
    return {
      title: `退回「${task.title}」到 Backlog？`,
      body: '這會停止 Agent，並捨棄這張卡在本地的 commit、未 commit 的變更、artifacts 與對話（遠端分支不動）。此操作無法復原。',
      confirm: '退回 Backlog',
      destructive: true,
    }
  }
  if (to === 'backlog') {
    return {
      title: `把「${task.title}」移回 Backlog？`,
      body: '卡片回到 Backlog 後可以再編輯。之後開始時會重新建立 worktree，並重新跑一次任務。',
      confirm: '移回 Backlog',
      destructive: false,
    }
  }
  return {
    title: `重新執行「${task.title}」？`,
    body: '這會重新建立 worktree，並用同樣的標題與描述重新啟動 Agent。',
    confirm: '重新執行',
    destructive: false,
  }
}

function initialRailCollapsed(): boolean {
  if (typeof window === 'undefined') return false
  return readWorkspaceRailCollapsed() ?? !window.matchMedia(RAIL_ROOMY_QUERY).matches
}

function WorkspaceSurface({
  active,
  children,
}: {
  active: boolean
  children: ReactNode
}) {
  const controls = useAnimationControls()
  const reducedMotion = useReducedMotion() ?? false
  const variants = createEnterVariants({
    timing: 'standard',
    initialOpacity: 0.96,
    transform: { x: 4 },
    reducedMotion,
  })

  useEffect(() => {
    controls.stop()
    controls.set('hidden')
    if (active) void controls.start('visible')
  }, [active, controls, reducedMotion])

  return (
    <motion.div
      initial="hidden"
      animate={controls}
      variants={variants}
      inert={!active}
      aria-hidden={!active || undefined}
      className={cn('h-full', !active && 'hidden pointer-events-none')}
    >
      {children}
    </motion.div>
  )
}

export function KanbanBoard({
  board,
  onBoardChange,
  onEditTask,
  onTaskDone,
  onDeleteTask,
  onOpenTaskTerminal,
  taskTerminals,
  onShowTaskTerminal,
  progress,
  selectedTaskId,
  onSelectTask,
  onOpenTaskSheet,
  startRequest,
  onStartRequest,
  onNewTask,
  view,
  onViewChange,
  githubView,
  taskLinks,
}: KanbanBoardProps) {
  // Tasks whose terminal has ever been opened. A mounted TaskTerminal stays in
  // the DOM (just hidden) while the card is in progress, so PTY state survives
  // switching tasks and pages.
  const [mounted, setMounted] = useState<Set<string>>(new Set())
  // Per-task armed terminal launch command; bumping `nonce` fires a new launch.
  const [terminalLaunch, setTerminalLaunch] = useState<Record<string, LaunchEntry>>({})
  // Always-current ref so async callbacks (termSessionExists .then) read the
  // latest terminalLaunch without depending on a stale closure.
  const terminalLaunchRef = useRef(terminalLaunch)
  terminalLaunchRef.current = terminalLaunch
  const reducedMotion = useReducedMotion() ?? false
  const surfaceEnterVariants = createEnterVariants({
    timing: 'standard',
    initialOpacity: 0.96,
    transform: { x: 4 },
    reducedMotion,
  })

  const markMounted = (taskId: string) =>
    setMounted((prev) => (prev.has(taskId) ? prev : new Set(prev).add(taskId)))

  const [confirmDone, setConfirmDone] = useState<Task | null>(null)
  const [completeSlaves, setCompleteSlaves] = useState(false)
  const [pullBack, setPullBack] = useState<PullBack | null>(null)
  const [pullingBack, setPullingBack] = useState(false)
  const [pullBackError, setPullBackError] = useState<string | null>(null)

  const wasLaunched = (task: Task) => task.launchedAt != null

  // Arm a launch for the task's terminal; bumping the nonce fires it. Core
  // builds the command (library, board CLI, prompts) at launch time, so an
  // entry enabled in the library takes effect on the very next run.
  const armLaunch = async (task: Task, launch: LaunchIntent = {}) => {
    markMounted(task.id)
    setTerminalLaunch((prev) => ({
      ...prev,
      [task.id]: { launch, nonce: (prev[task.id]?.nonce ?? 0) + 1 },
    }))
  }

  // Auto-mount the selected task terminal so TaskWorkspacePanel renders it immediately.
  useEffect(() => {
    if (!selectedTaskId) return
    markMounted(selectedTaskId)
    // Resume in-progress tasks that were previously launched (app restart recovery).
    // Only arm a resume if the terminal hasn't already received a pending command
    // in this session — avoids double-sending on re-selection.
    if (terminalLaunch[selectedTaskId]) return
    const task = board.in_progress.find((t) => t.id === selectedTaskId)
    if (!task || !wasLaunched(task)) return
    const cwd = task.worktreePath
    if (!cwd) return
    // Selecting a task must not start a fresh run. Auto-resume only when the
    // pinned conversation actually exists on disk; otherwise leave it for the
    // user with an interactive terminal for manual commands.
    let cancelled = false
    void termSessionExists(task.id).then((exists) => {
      if (cancelled || !exists || terminalLaunchRef.current[task.id]) return
      void armLaunch(task, { resume: true })
    })
    return () => {
      cancelled = true
    }
  }, [selectedTaskId]) // eslint-disable-line react-hooks/exhaustive-deps

  const moveTask = (task: Task, to: ColumnId) => {
    const next: BoardState = {
      backlog: board.backlog.filter((t) => t.id !== task.id),
      in_progress: board.in_progress.filter((t) => t.id !== task.id),
      done: board.done.filter((t) => t.id !== task.id),
    }
    next[to] = [task, ...next[to]]
    onBoardChange(next)

    if (to === 'done') {
      onTaskDone(task.id)
    }
  }

  const startTask = (task: Task) => {
    const withStamp = { ...task, launchedAt: Date.now() }
    onBoardChange({
      backlog: board.backlog.filter((t) => t.id !== task.id),
      in_progress: [withStamp, ...board.in_progress],
      done: board.done,
    })
    void armLaunch(withStamp)
  }

  useEffect(() => {
    if (!startRequest) return
    const task = board.backlog.find((t) => t.id === startRequest)
    if (task) startTask(task)
    onStartRequest(null)
  }, [startRequest]) // eslint-disable-line react-hooks/exhaustive-deps

  // Send a running card back to Backlog instead of relaunching it on the spot.
  // Everything the run produced is thrown away — code, artifacts,
  // conversation — so the later 開始 starts over from the base branch. The
  // control that calls this is held to confirm, so no dialog asks again.
  const returnTaskToBacklog = async (task: Task) => {
    await resetTaskBackToBacklog(task)
    return true
  }

  const resetTaskBackToBacklog = async (task: Task) => {
    const result = await resetTaskRun(task.id)
    if (!result) throw new Error('未連線到 VibeFlow core')
    const next = result.state.board
    onBoardChange({
      backlog: [result.task, ...next.backlog.filter((t) => t.id !== task.id)],
      in_progress: next.in_progress.filter((t) => t.id !== task.id),
      done: next.done.filter((t) => t.id !== task.id),
    })
  }

  const launchAgentOnly = async (task: Task) => {
    await armLaunch(task, { includeTaskPrompt: false })
  }

  // Completing a card tears down the worktree that holds the work, so the user
  // confirms before anything is moved — the card stays put until they do.
  const completeTask = (task: Task) => {
    setCompleteSlaves(false)
    setConfirmDone(task)
  }

  // Only running slaves are offered: a Backlog slave has no worktree to clean up
  // and can still be handed to another master.
  const runningSlaves = confirmDone?.role === 'master'
    ? board.in_progress.filter((t) => t.masterId === confirmDone.id)
    : []
  const backlogSlaves = confirmDone?.role === 'master'
    ? board.backlog.filter((t) => t.masterId === confirmDone.id)
    : []

  const confirmTaskDone = async () => {
    if (!confirmDone) return
    const task = confirmDone
    const finishing = completeSlaves ? [task, ...runningSlaves] : [task]
    setConfirmDone(null)
    if (finishing.length === 1) {
      moveTask(task, 'done')
      return
    }
    const ids = new Set(finishing.map((t) => t.id))
    onBoardChange({
      backlog: board.backlog,
      in_progress: board.in_progress.filter((t) => !ids.has(t.id)),
      done: [...finishing, ...board.done],
    })
    // Slaves usually share a project checkout, and cleanup switches and pulls
    // its base branch, so they must not be cleaned up concurrently.
    for (const t of finishing) await onTaskDone(t.id)
  }

  const dropCard = (task: Task, from: ColumnId, to: ColumnId) => {
    const move = cardMove(from, to)
    if (move === 'start') startTask(task)
    else if (move === 'complete') completeTask(task)
    else if (move) {
      setPullBackError(null)
      setPullBack({ task, from, to })
    }
  }

  const confirmPullBack = async () => {
    if (!pullBack) return
    setPullingBack(true)
    setPullBackError(null)
    try {
      await resetTaskBackToBacklog(pullBack.task)
      if (pullBack.to === 'in_progress') onStartRequest(pullBack.task.id)
      setPullBack(null)
    } catch (err) {
      setPullBackError(err instanceof Error ? err.message : String(err))
    } finally {
      setPullingBack(false)
    }
  }

  const pullBackText = pullBack ? pullBackCopy(pullBack) : null

  const [railCollapsed, setRailCollapsed] = useState(initialRailCollapsed)
  const changeRailCollapsed = (collapsed: boolean) => {
    setRailCollapsed(collapsed)
    writeWorkspaceRailCollapsed(collapsed)
  }

  const onWorkspace = view === 'workspace'

  return (
    <div className="flex h-full overflow-hidden bg-background text-foreground">
      <div className={cn('min-h-0 min-w-0 flex-1 overflow-hidden', onWorkspace && 'hidden')}>
        {view === 'github' ? (
          githubView
        ) : (
          <BoardColumns
            board={board}
            progress={progress}
            selectedTaskId={selectedTaskId ?? null}
            onSelectTask={onOpenTaskSheet}
            onDropCard={dropCard}
            onEditTask={onEditTask}
            onDeleteTask={onDeleteTask}
            onOpenTaskTerminal={onOpenTaskTerminal}
            taskTerminals={taskTerminals}
            onShowTaskTerminal={onShowTaskTerminal}
            onNewTask={onNewTask}
            view={view}
            onViewChange={onViewChange}
            taskLinks={taskLinks}
          />
        )}
      </div>

      {(() => {
        const allTasks: { task: Task; column: ColumnId }[] = [
          ...board.in_progress.map((t) => ({
            task: t,
            column: 'in_progress' as const,
          })),
          ...board.backlog.map((t) => ({
            task: t,
            column: 'backlog' as const,
          })),
          ...board.done.map((t) => ({
            task: t,
            column: 'done' as const,
          })),
        ]

        const selected = selectedTaskId
          ? allTasks.find(({ task, column }) => column === 'in_progress' && task.id === selectedTaskId)
          : null

        // The workspace is for running cards only. A mounted panel stays in the
        // DOM (hidden when not selected) so its PTY survives switching tasks or
        // pages; a card that leaves In Progress drops its panel, which kills its
        // shell and stops the pollers every panel runs.
        const renderIds = new Set<string>()
        for (const taskId of mounted) {
          const entry = allTasks.find(({ task }) => task.id === taskId)
          if (entry?.column === 'in_progress') renderIds.add(taskId)
        }
        if (selected) renderIds.add(selected.task.id)

        return (
          <div className={cn('min-h-0 min-w-0 flex-1 flex-col', onWorkspace ? 'flex' : 'hidden')}>
            <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-5">
              <ViewTabs value={view} onChange={onViewChange} />
              <NewTaskButton onClick={onNewTask} />
            </div>
            <div className="flex min-h-0 min-w-0 flex-1">
            <WorkspaceTaskRail
              running={board.in_progress}
              selectedTaskId={selectedTaskId ?? null}
              progress={progress}
              onSelect={onSelectTask}
              collapsed={railCollapsed}
              onCollapsedChange={changeRailCollapsed}
            />
            <main className="min-h-0 min-w-0 flex-1">
              {Array.from(renderIds).map((taskId) => {
                const entry = allTasks.find(({ task }) => task.id === taskId)
                if (!entry) return null
                const isSelected = taskId === selectedTaskId
                return (
                  <WorkspaceSurface key={taskId} active={isSelected}>
                    <TaskWorkspacePanel
                      task={entry.task}
                      active={isSelected && onWorkspace}
                      progress={progress[entry.task.id] ?? null}
                      progressById={progress}
                      slaves={
                        entry.task.role === 'master'
                          ? allTasks.filter(({ task }) => task.masterId === entry.task.id)
                          : undefined
                      }
                      master={
                        entry.task.masterId
                          ? allTasks.find(({ task }) => task.id === entry.task.masterId)?.task ?? null
                          : null
                      }
                      onSelectTask={onSelectTask}
                      launch={terminalLaunch[taskId]}
                      onReturnToBacklog={returnTaskToBacklog}
                      onLaunchAgent={launchAgentOnly}
                      onComplete={completeTask}
                      onDelete={onDeleteTask}
                    />
                  </WorkspaceSurface>
                )
              })}

              {!selected && (
                <motion.div
                  initial="hidden"
                  animate="visible"
                  variants={surfaceEnterVariants}
                  className="flex h-full items-center justify-center p-8"
                >
                  <div className="flex flex-col items-center gap-3 text-center">
                    <p className="text-base text-muted-foreground">
                      {board.in_progress.length > 0
                        ? '從左側選一張執行中的卡片。'
                        : '目前沒有執行中的卡片，到看板開始一個任務，或建立新的任務。'}
                    </p>
                    <Button size="sm" onClick={onNewTask} className="rounded-full px-4">
                      <Plus />
                      新增任務
                    </Button>
                  </div>
                </motion.div>
              )}
            </main>
            </div>
          </div>
        )
      })()}

      <AnimatePresence>
        {confirmDone && (
          <DialogShell
            key="confirm-done-dialog"
            title="完成任務"
            onClose={() => setConfirmDone(null)}
            contentClassName="max-w-md rounded-lg p-5"
          >
            <div className="space-y-5">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive">
                  <AlertTriangle className="size-5" />
                </span>
                <div className="min-w-0 space-y-1">
                  <h2 className="text-lg font-semibold tracking-tight">
                    完成「{confirmDone.title}」？
                  </h2>
                  <p className="text-base leading-6 text-muted-foreground">
                    這會刪除這張卡的 worktree（尚未 commit 的變更會一起消失）、本地分支
                    {confirmDone.branch ? `「${confirmDone.branch}」` : ''}與 artifacts，
                    並把專案切回
                    {confirmDone.baseBranch ? `「${confirmDone.baseBranch}」` : '基準分支'}
                    後更新。此操作無法復原，請先確認要保留的變更都已經 commit 或 push。
                  </p>
                </div>
              </div>
              {(runningSlaves.length > 0 || backlogSlaves.length > 0) && (
                <div className="space-y-3 rounded-md border border-border bg-muted/40 p-3">
                  <p className="text-sm leading-5 text-muted-foreground">
                    這張 master 還有 {runningSlaves.length + backlogSlaves.length} 張未完成的子卡
                    {backlogSlaves.length > 0 ? `，其中 ${backlogSlaves.length} 張在 Backlog 會保留不動` : ''}。
                  </p>
                  {runningSlaves.length > 0 && (
                    <>
                      <ul className="max-h-32 space-y-1 overflow-y-auto text-sm">
                        {runningSlaves.map((t) => (
                          <li key={t.id} className="truncate">
                            <span className="text-muted-foreground">執行中 · </span>
                            {t.title}
                          </li>
                        ))}
                      </ul>
                      <label className="flex cursor-pointer items-start gap-2 text-sm leading-5">
                        <input
                          type="checkbox"
                          className="mt-0.5 size-4 shrink-0 accent-primary"
                          checked={completeSlaves}
                          onChange={(e) => setCompleteSlaves(e.target.checked)}
                        />
                        <span>
                          一併完成這 {runningSlaves.length} 張執行中的子卡（各自的 worktree、本地分支與未 commit 的變更也會一起刪除）
                        </span>
                      </label>
                    </>
                  )}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-full"
                  onClick={() => setConfirmDone(null)}
                >
                  取消
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="rounded-full active:scale-95 motion-reduce:transform-none"
                  onClick={() => void confirmTaskDone()}
                >
                  {completeSlaves && runningSlaves.length > 0
                    ? `完成並清理 ${runningSlaves.length + 1} 張`
                    : '完成並清理'}
                </Button>
              </div>
            </div>
          </DialogShell>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {pullBack && pullBackText && (
          <DialogShell
            key="confirm-pull-back-dialog"
            title="移動任務"
            saving={pullingBack}
            onClose={() => setPullBack(null)}
            contentClassName="max-w-md rounded-lg p-5"
          >
            <div className="space-y-5">
              <div className="flex items-start gap-3">
                {pullBackText.destructive && (
                  <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive">
                    <AlertTriangle className="size-5" />
                  </span>
                )}
                <div className="min-w-0 space-y-1">
                  <h2 className="text-lg font-semibold tracking-tight">{pullBackText.title}</h2>
                  <p className="text-base leading-6 text-muted-foreground">{pullBackText.body}</p>
                </div>
              </div>
              {pullBackError && (
                <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                  {pullBackError}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-full"
                  disabled={pullingBack}
                  onClick={() => setPullBack(null)}
                >
                  取消
                </Button>
                <Button
                  variant={pullBackText.destructive ? 'destructive' : 'default'}
                  size="sm"
                  className="rounded-full active:scale-95 motion-reduce:transform-none"
                  disabled={pullingBack}
                  onClick={() => void confirmPullBack()}
                >
                  {pullingBack && <Loader2 className="animate-spin" />}
                  {pullBackText.confirm}
                </Button>
              </div>
            </div>
          </DialogShell>
        )}
      </AnimatePresence>

    </div>
  )
}
