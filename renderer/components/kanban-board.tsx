import { useEffect, useRef, useState } from 'react'
import { Plus, Settings, Smartphone, Users } from 'lucide-react'

import { Button } from '@/components/ui/button'
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
  taskAgent,
  taskExecutionAgent,
} from '@/lib/claude'
import { onTermData, termInput, termKill } from '@/lib/api'
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

interface LaunchEntry {
  command: string
  nonce: number
  modelSelection?: boolean
}

interface ModelStatusProbe {
  buffer: string
}

interface ModelSelectionLaunch {
  resume: boolean
}

/** Derive the reviewer session key from a task id (mirrors main/helpers/pty.ts). */
function reviewSessionKey(taskId: string): string {
  return `${taskId}:review`
}

function stripAnsi(input: string): string {
  return input
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
}

function normalizeClaudeModel(raw: string): string | null {
  const value = raw
    .trim()
    .replace(/[│┃║|].*$/, '')
    .replace(/[()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
  if (!value) return null
  const id = value
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9.-]/g, '')
  if (id.startsWith('claude-')) return id
  if (/opus/.test(value)) return 'opus'
  if (/haiku/.test(value)) return 'haiku'
  if (/sonnet/.test(value)) return 'sonnet'
  return id || null
}

function parseClaudeStatusModel(output: string): string | null {
  const text = stripAnsi(output)
  const patterns = [
    /(?:current\s+)?model\s*[:：]\s*([^\r\n]+)/i,
    /(?:^|\n)\s*model\s+([^\r\n]+)/i,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) return normalizeClaudeModel(match[1])
  }
  return null
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
  const modelStatusProbeRef = useRef<Record<string, ModelStatusProbe>>({})
  const modelSelectionLaunchRef = useRef<Record<string, ModelSelectionLaunch>>({})

  useEffect(() => {
    return onTermData(({ sessionKey, data }) => {
      const probe = modelStatusProbeRef.current[sessionKey]
      if (probe) probe.buffer += data
    })
  }, [])

  const markMounted = (taskId: string) =>
    setMounted((prev) => (prev.has(taskId) ? prev : new Set(prev).add(taskId)))

  const wasLaunched = (task: Task) => task.launchedAt != null

  // Prefer the workspace folder recorded on the task (now always set at creation,
  // including the auto-created sibling); fall back to the assigned workspace's
  // path for legacy tasks predating task.workspacePath.
  const resolveWorkspacePath = (task: Task): string | undefined =>
    task.workspacePath ??
    (task.workspaceId ? workspaces?.find((w) => w.id === task.workspaceId)?.path : undefined)

  // Direct command dispatch — used by revise (which needs its own full command).
  const armTerminalCommand = (taskId: string, command: string) => {
    markMounted(taskId)
    setTerminalLaunch((prev) => ({
      ...prev,
      [taskId]: { command, nonce: (prev[taskId]?.nonce ?? 0) + 1 },
    }))
  }

  const currentPhaseAgent = (task: Task): AgentCliId =>
    task.progress?.planDone === true ? taskExecutionAgent(task) : taskAgent(task)

  const currentPhaseModel = (task: Task): string | undefined =>
    task.progress?.planDone === true
      ? task.executionModel
      : task.model

  const shouldSelectClaudeModel = (task: Task): boolean =>
    currentPhaseAgent(task) === 'claude' && !currentPhaseModel(task)

  const armModelSelection = (task: Task, opts?: { resume?: boolean }) => {
    modelSelectionLaunchRef.current[task.id] = { resume: opts?.resume === true }
    markMounted(task.id)
    setTerminalLaunch((prev) => ({
      ...prev,
      [task.id]: {
        command: 'claude --permission-mode auto\r/model\r',
        nonce: (prev[task.id]?.nonce ?? 0) + 1,
        modelSelection: true,
      },
    }))
  }

  // Send one complete launch command. Splitting Claude into boot + `/model` +
  // prompt injection can race with long shell-quoted system prompts and leave
  // the shell stuck at `quote>`.
  const armLaunch = (task: Task, opts?: { resume?: boolean }) => {
    if (shouldSelectClaudeModel(task)) {
      armModelSelection(task, opts)
      return
    }
    const workspacePath = resolveWorkspacePath(task)
    const role = roleById(task.roleId)
    armTerminalCommand(
      task.id,
      buildWorkspaceLaunchCommand({ task, role, systemPrompt, workspacePath, resume: opts?.resume })
    )
  }

  const armFormalLaunch = (
    task: Task,
    opts?: { resume?: boolean; omitModel?: boolean }
  ) => {
    const workspacePath = resolveWorkspacePath(task)
    const role = roleById(task.roleId)
    armTerminalCommand(
      task.id,
      buildWorkspaceLaunchCommand({
        task,
        role,
        systemPrompt,
        workspacePath,
        resume: opts?.resume,
        omitModel: opts?.omitModel,
      })
    )
  }

  const handleConfirmModelSelection = (task: Task) => {
    modelStatusProbeRef.current[task.id] = { buffer: '' }
    termInput(task.id, '/status\r')
    setTimeout(() => {
      const probe = modelStatusProbeRef.current[task.id]
      delete modelStatusProbeRef.current[task.id]
      const selectionLaunch = modelSelectionLaunchRef.current[task.id]
      delete modelSelectionLaunchRef.current[task.id]
      const model = parseClaudeStatusModel(probe?.buffer ?? '')
      termKill(task.id)
      const nextTask = model ? patchClaudeModel(task, model) : task
      setTimeout(() => {
        armFormalLaunch(nextTask, {
          resume: selectionLaunch?.resume === true,
          omitModel: !model,
        })
      }, 150)
    }, 900)
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

  const patchClaudeModel = (task: Task, model: string): Task => {
    const patch: Partial<Task> = task.progress?.planDone === true
      ? { executionModel: model }
      : {
          model,
          ...(taskExecutionAgent(task) === 'claude' && !task.executionModel
            ? { executionModel: model }
            : {}),
        }
    patchTask(task.id, patch)
    return { ...task, ...patch }
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
      armLaunch(task)
      break
    }
  }, [board]) // eslint-disable-line react-hooks/exhaustive-deps

  const runTask = (task: Task) => {
    if (!task.launchedAt) patchTask(task.id, { launchedAt: Date.now() })
    armLaunch(task, { resume: wasLaunched(task) })
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
      armLaunch(toInsert, { resume: wasLaunched(task) })
    }
  }

  const startTask = (task: Task) => {
    const withStamp = { ...task, launchedAt: Date.now() }
    onBoardChange({
      backlog: board.backlog.filter((t) => t.id !== task.id),
      in_progress: [withStamp, ...board.in_progress],
      done: board.done,
    })
    armLaunch(withStamp)
  }

  const completeTask = (task: Task) => moveTask(task, 'done')
  return (
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
                      onConfirmModelSelection={handleConfirmModelSelection}
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
  )
}
