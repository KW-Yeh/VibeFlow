import { useEffect, useRef, useState } from 'react'
import { Bot, Loader2, Plus, Settings, Smartphone, Users } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { DialogShell } from '@/components/ui/dialog-shell'
import { IconButton } from '@/components/ui/icon-button'
import { SubAgentDrawer } from '@/components/sub-agent-drawer'
import {
  TaskWorkspacePanel,
  buildWorkspaceLaunchCommand,
} from '@/components/task-workspace-panel'
import { ReviewTerminalPanel } from '@/components/review-terminal-panel'
import { NewTaskForm } from '@/components/new-task-dialog'
import {
  buildReviseCommand,
  buildReviewCommand,
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
  onRemoteShare?: () => void
  remoteActive?: boolean
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
    executionAgentCli: AgentCliId,
    roleId: string,
    reviewerRoleId: string,
    workspaceId: string
  ) => void
}

interface PendingModelPick {
  task: Task
  phase: 'planning' | 'execution'
  moveToInProgress: boolean
  resume: boolean
}

function ModelPickerDialog({
  pick,
  agents,
  onConfirm,
  onCancel,
}: {
  pick: PendingModelPick
  agents: AgentCli[] | null
  onConfirm: (model: string) => void
  onCancel: () => void
}) {
  const agentId = pick.phase === 'execution'
    ? (pick.task.executionAgentCli ?? pick.task.agentCli ?? 'claude')
    : (pick.task.agentCli ?? 'claude')
  const agent = agents?.find((a) => a.id === agentId) ?? null
  const models = agent?.models ?? []
  const [selected, setSelected] = useState(models[0]?.id ?? '')

  useEffect(() => {
    if (models.length > 0 && !selected) setSelected(models[0].id)
  }, [models, selected])

  const isPlanning = pick.phase === 'planning'

  return (
    <DialogShell
      title={isPlanning ? '選擇規劃 Model' : '選擇執行 Model'}
      onClose={onCancel}
      showHeader
      contentClassName="max-w-sm"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            取消
          </Button>
          <Button size="sm" onClick={() => onConfirm(selected)} disabled={!selected || agents === null}>
            {isPlanning ? '開始規劃' : '開始執行'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Bot className="size-3.5" />
          <span>{agent?.name ?? agentId}</span>
          <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px]">
            {pick.task.title}
          </span>
        </div>
        {agents === null ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            偵測 Agent CLI 中…
          </p>
        ) : models.length === 0 ? (
          <p className="text-xs text-muted-foreground">無可用 model。</p>
        ) : (
          <div className="space-y-1.5">
            {models.map((m) => (
              <label
                key={m.id}
                className="flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent"
              >
                <input
                  type="radio"
                  name="model-pick"
                  value={m.id}
                  checked={selected === m.id}
                  onChange={() => setSelected(m.id)}
                  className="accent-primary"
                />
                <span>{m.label}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    </DialogShell>
  )
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
  onEditTask,
  onTaskDone,
  onDeleteTask,
  autoMode,
  onToggleAutoMode,
  systemPrompt,
  onOpenSettings,
  roles,
  onManageRoles,
  onRemoteShare,
  remoteActive,
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
  // in the DOM (just hidden) so PTY state survives switching tasks.
  const [mounted, setMounted] = useState<Set<string>>(new Set())
  // Per-task armed terminal launch command; bumping `nonce` (re-)fires it.
  const [terminalLaunch, setTerminalLaunch] = useState<Record<string, LaunchEntry>>({})
  // Per-task armed reviewer launch command (PTY-based, unchanged).
  const [reviewerLaunch, setReviewerLaunch] = useState<Record<string, LaunchEntry>>({})
  // Reviewer side panel state.
  const [reviewPanelTaskId, setReviewPanelTaskId] = useState<string | null>(null)
  const [activeReviewerIds, setActiveReviewerIds] = useState<Set<string>>(new Set())
  const executionStartedRef = useRef<Set<string>>(new Set())
  // Model picker: shown before planning or execution launches.
  const [pendingModelPick, setPendingModelPick] = useState<PendingModelPick | null>(null)
  // Detected agents for the model picker (loaded once on mount).
  const [pickerAgents, setPickerAgents] = useState<AgentCli[] | null>(null)

  // Load agents once so the model picker has models ready.
  useEffect(() => {
    void detectAgents().then(setPickerAgents)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const markMounted = (taskId: string) =>
    setMounted((prev) => (prev.has(taskId) ? prev : new Set(prev).add(taskId)))

  const wasLaunched = (task: Task) => task.launchedAt != null

  // Prefer the workspace folder recorded on the task (now always set at creation,
  // including the auto-created sibling); fall back to the assigned workspace's
  // path for legacy tasks predating task.workspacePath.
  const resolveWorkspacePath = (task: Task): string | undefined =>
    task.workspacePath ??
    (task.workspaceId ? workspaces?.find((w) => w.id === task.workspaceId)?.path : undefined)

  const armTerminalCommand = (taskId: string, command: string) => {
    markMounted(taskId)
    setTerminalLaunch((prev) => ({
      ...prev,
      [taskId]: { command, nonce: (prev[taskId]?.nonce ?? 0) + 1 },
    }))
  }

  const armLaunch = (task: Task, opts?: { resume?: boolean }) => {
    const role = roleById(task.roleId)
    armTerminalCommand(
      task.id,
      buildWorkspaceLaunchCommand({
        task,
        role,
        systemPrompt,
        workspacePath: resolveWorkspacePath(task),
        resume: opts?.resume,
      })
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
  // Tracks the previous board so we can detect allDone transitions within the
  // current session and skip auto-review advances on app restart.
  const prevBoardRef = useRef<typeof board | null>(null)

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
        command: buildReviewCommand(task, roleById(task.reviewerRoleId), resolveWorkspacePath(task)),
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
    setReviewPanelTaskId(task.id)
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
    armTerminalCommand(
      task.id,
      buildReviseCommand(
        task,
        roleById(task.roleId) ?? undefined,
        review.comments,
        resolveWorkspacePath(task)
      )
    )
  }

  useEffect(() => {
    if (!autoMode) return
    const prevBoard = prevBoardRef.current
    prevBoardRef.current = board
    for (const task of board.in_progress) {
      const p = task.pipeline
      if (!p || !task.reviewerRoleId) continue
      if (p.stage === 'approved' || p.stage === 'blocked') continue

      const allDone = isTaskComplete(task)
      const review = task.progress?.review
      const sig = `${p.stage}|${allDone}|${review?.verdict ?? 'none'}|${p.round}`
      if (firedRef.current.get(task.id) === sig) continue

      if ((p.stage === 'developing' || p.stage === 'revising') && allDone && !review) {
        // Only advance to review when allDone just became true in this session.
        // On app restart prevBoard is null/empty, so tasks already done in a prior
        // session are skipped — preventing a spurious re-review on reopen.
        const prevTask = prevBoard?.in_progress.find((t) => t.id === task.id)
        if (!prevTask || isTaskComplete(prevTask)) continue
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

  // Auto-mount the selected task terminal so TaskWorkspacePanel renders it immediately.
  useEffect(() => {
    if (!selectedTaskId) return
    markMounted(selectedTaskId)
    // Resume in-progress tasks that were previously launched (app restart recovery).
    // Only arm a resume if the terminal hasn't already received a pending command
    // in this session — avoids double-sending on re-selection.
    if (!terminalLaunch[selectedTaskId]) {
      const task = board.in_progress.find((t) => t.id === selectedTaskId)
      if (task && wasLaunched(task) && !isTaskComplete(task)) {
        if (task.progress?.needsUserInput) return
        if (task.progress?.planDone === true && !task.progress?.needsUserInput) {
          executionStartedRef.current.add(task.id)
        }
        armLaunch(task, { resume: true })
      }
    }
  }, [selectedTaskId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    for (const task of board.in_progress) {
      if (!task.launchedAt) continue
      if (task.progress?.planDone !== true) continue
      if (task.progress?.needsUserInput) continue
      if (isTaskComplete(task)) continue
      if (executionStartedRef.current.has(task.id)) continue
      executionStartedRef.current.add(task.id)
      setPendingModelPick({ task, phase: 'execution', moveToInProgress: false, resume: false })
      break
    }
  }, [board]) // eslint-disable-line react-hooks/exhaustive-deps

  const onConfirmModelPick = (pickedModel: string) => {
    if (!pendingModelPick) return
    const { task, phase, moveToInProgress, resume } = pendingModelPick
    setPendingModelPick(null)

    const modelPatch = phase === 'planning'
      ? { model: pickedModel }
      : { executionModel: pickedModel }
    const withModel = { ...task, ...modelPatch }

    if (moveToInProgress) {
      const withStamp = { ...withModel, launchedAt: Date.now() }
      onBoardChange({
        backlog: board.backlog.filter((t) => t.id !== task.id),
        in_progress: [withStamp, ...board.in_progress.filter((t) => t.id !== task.id)],
        done: board.done.filter((t) => t.id !== task.id),
      })
      markMounted(task.id)
      armLaunch(withStamp)
    } else {
      const fullPatch = { ...modelPatch, ...(!task.launchedAt ? { launchedAt: Date.now() } : {}) }
      patchTask(task.id, fullPatch)
      armLaunch({ ...withModel, ...fullPatch }, { resume })
    }
  }

  const runTask = (task: Task) => {
    const phase = task.progress?.planDone === true ? 'execution' : 'planning'
    setPendingModelPick({ task, phase, moveToInProgress: false, resume: wasLaunched(task) })
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
    if (willLaunch) {
      // moveToInProgress=false: task is already in the board at this point.
      const phase = toInsert.progress?.planDone === true ? 'execution' : 'planning'
      setPendingModelPick({ task: toInsert, phase, moveToInProgress: false, resume: wasLaunched(task) })
    }
  }

  const startTask = (task: Task) => {
    // Show model picker before moving the task; confirm handler does the move + launch.
    setPendingModelPick({ task, phase: 'planning', moveToInProgress: true, resume: false })
  }

  const completeTask = (task: Task) => moveTask(task, 'done')
  return (
    <>
    {pendingModelPick && (
      <ModelPickerDialog
        pick={pendingModelPick}
        agents={pickerAgents}
        onConfirm={onConfirmModelPick}
        onCancel={() => setPendingModelPick(null)}
      />
    )}
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-6 py-3">
        <span className="mr-auto text-sm font-semibold tracking-tight">VibeFlow</span>
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
        <IconButton
          aria-label="管理角色"
          onClick={onManageRoles}
          title="管理角色"
        >
          <Users className="size-4" />
        </IconButton>
        {onRemoteShare && (
          <IconButton
            aria-label="遠端控制"
            onClick={onRemoteShare}
            title="遠端控制"
            className={cn(
              remoteActive
                ? 'text-primary hover:text-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Smartphone className="size-4" />
          </IconButton>
        )}
        <IconButton
          aria-label="設定 System Prompt"
          onClick={onOpenSettings}
          title="設定（System Prompt）"
        >
          <Settings className="size-4" />
        </IconButton>
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

          // Keep all previously mounted panels in the DOM (hidden when not selected)
          // so PTY sessions survive switching tasks or deselecting to the new-task form.
          const renderIds = new Set(mounted)
          if (selected) renderIds.add(selected.task.id)

          return (
            <>
              {Array.from(renderIds).map((taskId) => {
                const entry = allTasks.find(({ task }) => task.id === taskId)
                if (!entry) return null
                const isSelected = taskId === selectedTaskId
                return (
                  <div key={taskId} className={cn('h-full', !isSelected && 'hidden')}>
                    <TaskWorkspacePanel
                      task={entry.task}
                      column={entry.column}
                      role={roleById(entry.task.roleId)}
                      reviewerRole={roleById(entry.task.reviewerRoleId)}
                      subAgents={subAgents[entry.task.id] ?? []}
                      launch={terminalLaunch[taskId]}
                      onRun={runTask}
                      onStart={startTask}
                      onComplete={completeTask}
                      onEdit={onEditTask}
                      onDelete={onDeleteTask}
                      onOpenReviewPanel={openReviewPanel}
                      onOpenSubAgents={setSubAgentTaskId}
                    />
                  </div>
                )
              })}

              {!selected && (
                <div className="flex h-full overflow-y-auto p-8">
                  <div className="mx-auto w-full max-w-5xl">
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
              )}
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
    </>
  )
}
