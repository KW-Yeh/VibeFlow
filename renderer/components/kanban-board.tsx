import { useEffect, useRef, useState } from 'react'
import { Plus, Settings, Users } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { SubAgentDrawer } from '@/components/sub-agent-drawer'
import { TaskDetailPanel } from '@/components/task-detail-panel'
import { ReviewTerminalPanel } from '@/components/review-terminal-panel'
import { NewTaskForm } from '@/components/new-task-dialog'
import {
  buildAgentCommand,
  buildReviewCommand,
  buildReviseCommand,
  isTaskComplete,
} from '@/lib/claude'
import { termKill } from '@/lib/api'
import { cn } from '@/lib/utils'
import type {
  AgentCli,
  AgentCliId,
  BoardState,
  ColumnId,
  GitInfo,
  ReviewVerdict,
  Role,
  SubAgentRun,
  Task,
  Workspace,
} from '@/lib/types'

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
  /** Currently selected task id (shown in pipeline view). */
  selectedTaskId?: string | null
  /** Deselect the current task (shows inline new-task form). */
  onDeselectTask: () => void
  /** Available workspaces for context injection. */
  workspaces?: Workspace[]
  /** Props forwarded to the inline NewTaskForm when no task is selected. */
  creating: boolean
  createError: string | null
  pickFolder: () => Promise<string | null>
  loadGitInfo: (projectPath: string) => Promise<GitInfo | null>
  initRepository: (projectPath: string) => Promise<GitInfo | null>
  detectAgents: () => Promise<AgentCli[]>
  onCreateTask: (
    title: string,
    description: string,
    projectPath: string,
    baseBranch: string | null,
    mode: 'existing' | 'new',
    agentCli: AgentCliId,
    model: string,
    roleId: string,
    reviewerRoleId: string,
    workspaceId: string
  ) => void
}

interface LaunchEntry {
  command: string
  nonce: number
}

/** Derive the reviewer session key from a task id (mirrors main/helpers/pty.ts). */
function reviewSessionKey(taskId: string): string {
  return `${taskId}:review`
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
  selectedTaskId,
  onDeselectTask,
  workspaces,
  creating,
  createError,
  pickFolder,
  loadGitInfo,
  initRepository,
  detectAgents,
  onCreateTask,
}: KanbanBoardProps) {
  const roleById = (id?: string): Role | null =>
    (id && roles.find((r) => r.id === id)) || null

  // Task whose sub-agent drawer is open (null = closed).
  const [subAgentTaskId, setSubAgentTaskId] = useState<string | null>(null)
  // Tasks whose terminal has ever been opened. Once mounted, TaskTerminal stays
  // mounted (just hidden) so its PTY + scrollback survive switching tasks.
  const [mounted, setMounted] = useState<Set<string>>(new Set())
  // Per-task armed launch command; bumping `nonce` (re-)fires it in the terminal.
  const [launch, setLaunch] = useState<Record<string, LaunchEntry>>({})
  // Per-task armed reviewer launch command.
  const [reviewerLaunch, setReviewerLaunch] = useState<Record<string, LaunchEntry>>({})
  // Reviewer side panel state.
  const [reviewPanelTaskId, setReviewPanelTaskId] = useState<string | null>(null)
  const [activeReviewerIds, setActiveReviewerIds] = useState<Set<string>>(new Set())

  const markMounted = (taskId: string) =>
    setMounted((prev) => (prev.has(taskId) ? prev : new Set(prev).add(taskId)))

  const wasLaunched = (task: Task) => task.launchedAt != null

  // Expand the card, mount its terminal, and arm a (re-)launch of `command`.
  const armCommand = (taskId: string, command: string) => {
    markMounted(taskId)
    setLaunch((prev) => ({
      ...prev,
      [taskId]: { command, nonce: (prev[taskId]?.nonce ?? 0) + 1 },
    }))
  }

  const resolveWorkspacePath = (workspaceId?: string): string | undefined =>
    workspaceId ? workspaces?.find((w) => w.id === workspaceId)?.path : undefined

  const armLaunch = (task: Task, opts?: { resume?: boolean }) => {
    armCommand(
      task.id,
      buildAgentCommand(task, systemPrompt, roleById(task.roleId), opts, resolveWorkspacePath(task.workspaceId))
    )
  }

  // Merge a patch into a task across all columns and persist.
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
  // drive the executor → reviewer → (revise → reviewer)* → approve loop.
  // `firedRef` dedupes by a (stage, allDone, verdict, round) signature.
  const firedRef = useRef<Map<string, string>>(new Map())

  const killReviewerSession = (taskId: string) => {
    termKill(reviewSessionKey(taskId))
    setReviewerLaunch((prev) => {
      if (!prev[taskId]) return prev
      const next = { ...prev }
      delete next[taskId]
      return next
    })
    setActiveReviewerIds((prev) => {
      if (!prev.has(taskId)) return prev
      const next = new Set(prev)
      next.delete(taskId)
      return next
    })
    setReviewPanelTaskId((prev) => (prev === taskId ? null : prev))
  }

  const armReviewer = (task: Task) => {
    markMounted(task.id)
    setReviewerLaunch((prev) => ({
      ...prev,
      [task.id]: {
        command: buildReviewCommand(task, roleById(task.reviewerRoleId), resolveWorkspacePath(task.workspaceId)),
        nonce: (prev[task.id]?.nonce ?? 0) + 1,
      },
    }))
    setActiveReviewerIds((prev) =>
      prev.has(task.id) ? prev : new Set(prev).add(task.id)
    )
  }

  const openReviewPanel = (taskId: string) => {
    setActiveReviewerIds((prev) =>
      prev.has(taskId) ? prev : new Set(prev).add(taskId)
    )
    setReviewPanelTaskId(taskId)
  }

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
    killReviewerSession(task.id)
    armCommand(
      task.id,
      buildReviseCommand(task, roleById(task.roleId), review.comments, resolveWorkspacePath(task.workspaceId))
    )
  }

  useEffect(() => {
    if (!autoMode) return
    for (const task of board.in_progress) {
      const p = task.pipeline
      if (!p || !task.reviewerRoleId) continue
      if (p.stage === 'approved' || p.stage === 'blocked') continue

      const allDone = isTaskComplete(task)
      const review = task.progress?.review
      const sig = `${p.stage}|${allDone}|${review?.verdict ?? 'none'}|${p.round}`
      if (firedRef.current.get(task.id) === sig) continue

      if ((p.stage === 'developing' || p.stage === 'revising') && allDone && !review) {
        firedRef.current.set(task.id, sig)
        advanceToReview(task)
        break
      }
      if (p.stage === 'reviewing' && review) {
        firedRef.current.set(task.id, sig)
        if (review.verdict === 'approve') {
          killReviewerSession(task.id)
          patchTask(task.id, {
            pipeline: { ...p, stage: 'approved', lastReview: review },
          })
        } else if (p.round + 1 > p.maxRounds) {
          killReviewerSession(task.id)
          patchTask(task.id, {
            pipeline: { ...p, stage: 'blocked', lastReview: review },
          })
        } else {
          advanceToRevise(task, review)
        }
        break
      }
    }
  }, [board, autoMode, systemPrompt, roles]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-mount terminal for the selected task so TaskDetailPanel renders it immediately.
  useEffect(() => {
    if (!selectedTaskId) return
    markMounted(selectedTaskId)
    // Resume in-progress tasks that were previously launched (app restart recovery).
    if (!launch[selectedTaskId]) {
      const task = board.in_progress.find((t) => t.id === selectedTaskId)
      if (task && wasLaunched(task) && !isTaskComplete(task)) {
        armLaunch(task, { resume: true })
      }
    }
  }, [selectedTaskId]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const moveTask = (
    task: Task,
    to: ColumnId,
    opts?: { forceLaunch?: boolean }
  ) => {
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

    if (to === 'done') {
      onTaskDone(task.id)
    }
    if (willLaunch) armLaunch(toInsert, { resume: wasLaunched(task) })
  }

  const startTask = (task: Task) => {
    moveTask(task, 'in_progress', { forceLaunch: true })
  }

  const completeTask = (task: Task) => moveTask(task, 'done')
  const moveBackTask = (task: Task) => moveTask(task, 'backlog')

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      {/* Toolbar header — branding is in the side menu; this row holds action controls */}
      <header className="flex shrink-0 items-center justify-end gap-3 border-b border-border px-6 py-3">
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
          onClick={selectedTaskId ? onDeselectTask : onNewTask}
        >
          <Plus />
          新增任務
        </Button>
      </header>

      <main className="min-h-0 flex-1">
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
            ? allTasks.find(({ task }) => task.id === selectedTaskId)
            : null

          if (!selected) {
            return (
              <div className="flex h-full overflow-y-auto p-6">
                <div className="mx-auto w-full max-w-3xl rounded-lg border bg-card p-5 text-card-foreground shadow-sm">
                  <NewTaskForm
                    inline
                    creating={creating}
                    error={createError}
                    pickFolder={pickFolder}
                    loadGitInfo={loadGitInfo}
                    initRepository={initRepository}
                    detectAgents={detectAgents}
                    roles={roles}
                    onManageRoles={onManageRoles}
                    workspaces={workspaces}
                    onSubmit={onCreateTask}
                  />
                </div>
              </div>
            )
          }

          // Include the currently selected task even if not yet in `mounted`
          // (useEffect runs after render, so the first render cycle after
          // selection hasn't called markMounted yet).
          const renderIds = new Set(mounted)
          renderIds.add(selected.task.id)

          return (
            <>
              {Array.from(renderIds).map((taskId) => {
                const entry = allTasks.find(({ task }) => task.id === taskId)
                if (!entry) return null
                const isSelected = taskId === selectedTaskId
                return (
                  <div key={taskId} className={cn('h-full', !isSelected && 'hidden')}>
                    <TaskDetailPanel
                      task={entry.task}
                      column={entry.column}
                      role={roleById(entry.task.roleId)}
                      reviewerRole={roleById(entry.task.reviewerRoleId)}
                      subAgents={subAgents[entry.task.id] ?? []}
                      isMounted={mounted.has(taskId)}
                      launch={launch[taskId]}
                      onRun={runTask}
                      onStart={startTask}
                      onMoveBack={moveBackTask}
                      onComplete={completeTask}
                      onReview={onReview}
                      onEdit={onEditTask}
                      onDelete={onDeleteTask}
                      onOpenReviewPanel={openReviewPanel}
                      onOpenSubAgents={setSubAgentTaskId}
                      onClose={onDeselectTask}
                    />
                  </div>
                )
              })}
            </>
          )
        })()}
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

      {/* Reviewer terminal side panel — keeps PTY alive for all activeReviewerIds,
          visibleTaskId controls which one is shown. */}
      {(() => {
        const allTasks = Object.values(board).flat()
        const entries = Array.from(activeReviewerIds).flatMap((id) => {
          const task = allTasks.find((t) => t.id === id)
          if (!task) return []
          return [
            {
              task,
              sessionKey: reviewSessionKey(id),
              cwd: task.worktreePath ?? task.projectPath ?? null,
              launchCommand: reviewerLaunch[id]?.command,
              launchNonce: reviewerLaunch[id]?.nonce,
              reviewerRoleName: roleById(task.reviewerRoleId)?.name ?? undefined,
            },
          ]
        })
        return (
          <ReviewTerminalPanel
            entries={entries}
            visibleTaskId={reviewPanelTaskId}
            onClose={() => setReviewPanelTaskId(null)}
            onLaunchRequest={(taskId) => {
              const task = allTasks.find((t) => t.id === taskId)
              if (task) armReviewer(task)
            }}
          />
        )
      })()}
    </div>
  )
}
