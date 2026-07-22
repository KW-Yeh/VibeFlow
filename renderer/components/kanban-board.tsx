import {
  motion,
  useAnimationControls,
  useReducedMotion,
} from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

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
  executorSessionId,
  isTaskComplete,
  planningSessionId,
  PLANNING_ROLE,
  REVIEWER_ROLE,
} from '@/lib/claude'
import { getMemoryLaunchInfo, termKill, termSessionExists } from '@/lib/api'
import { createEnterVariants } from '@/lib/motion'
import { cn } from '@/lib/utils'
import type {
  AgentCli,
  AgentCliId,
  AgentConnections,
  AttachmentInput,
  BoardState,
  ColumnId,
  GitInfo,
  MemoryLaunchInfo,
  ReviewVerdict,
  Role,
  SubAgentRun,
  Task,
} from '@/lib/types'

interface KanbanBoardProps {
  board: BoardState
  onBoardChange: (board: BoardState) => void
  onEditTask: (taskId: string) => void
  onTaskDone: (taskId: string) => void
  onDeleteTask: (taskId: string) => void
  /** Global Auto Mode: auto-run a card's Claude execution on entering In Progress. */
  autoMode: boolean
  /** Custom system prompt for launches ('' = use the built-in default). */
  systemPrompt: string
  /** Roles available for assignment / display. */
  roles: Role[]
  onManageRoles: () => void
  /** Live sub-agent runs keyed by task id (session-only, not persisted). */
  subAgents: Record<string, SubAgentRun[]>
  /** Currently selected task id (shown in pipeline view). */
  selectedTaskId?: string | null
  /** Pre-fill the inline new-task form with this existing project folder. */
  initialProjectPath?: string | null
  newTaskNonce: number
  /** Props forwarded to the inline NewTaskForm when no task is selected. */
  creating: boolean
  createError: string | null
  pickFolder: () => Promise<string | null>
  loadGitInfo: (projectPath: string) => Promise<GitInfo | null>
  initRepository: (projectPath: string) => Promise<GitInfo | null>
  detectAgents: () => Promise<AgentCli[]>
  agentConnections?: AgentConnections
  onCreateTask: (
    title: string,
    description: string,
    projectPath: string,
    baseBranch: string | null,
    mode: 'existing' | 'new',
    agentCli: AgentCliId,
    executionAgentCli: AgentCliId,
    model: string,
    executionModel: string,
    roleId: string,
    reviewerRoleId: string,
    attachments: AttachmentInput[]
  ) => void
}

interface LaunchEntry {
  command: string
  nonce: number
}

interface SubAgentDrawerSnapshot {
  taskId: string
  taskTitle: string
  runs: SubAgentRun[]
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

/** Derive the reviewer session key from a task id (mirrors main/helpers/pty.ts). */
function reviewSessionKey(taskId: string): string {
  return `${taskId}:review`
}

export function KanbanBoard({
  board,
  onBoardChange,
  onEditTask,
  onTaskDone,
  onDeleteTask,
  autoMode,
  systemPrompt,
  roles,
  onManageRoles,
  subAgents,
  selectedTaskId,
  initialProjectPath,
  newTaskNonce,
  creating,
  createError,
  pickFolder,
  loadGitInfo,
  initRepository,
  detectAgents,
  agentConnections,
  onCreateTask,
}: KanbanBoardProps) {
  const roleById = (id?: string): Role | null =>
    (id && roles.find((r) => r.id === id)) || null

  // Auto-assigned personas: prefer the user's (editable) store role by id so
  // edits in the role manager take effect; fall back to the built-in preset
  // when the store lacks it (e.g. users predating the seeded 6-role set).
  const planningRole = (): Role => roleById(PLANNING_ROLE.id) ?? PLANNING_ROLE
  const reviewerRole = (): Role => roleById(REVIEWER_ROLE.id) ?? REVIEWER_ROLE

  // Task whose sub-agent drawer is open (null = closed).
  const [subAgentTaskId, setSubAgentTaskId] = useState<string | null>(null)
  const subAgentDrawerSnapshotRef = useRef<SubAgentDrawerSnapshot | null>(null)
  // Tasks whose terminal has ever been opened. Once mounted, TaskTerminal stays
  // in the DOM (just hidden) so PTY state survives switching tasks.
  const [mounted, setMounted] = useState<Set<string>>(new Set())
  // Per-task armed terminal launch command; bumping `nonce` (re-)fires it.
  const [terminalLaunch, setTerminalLaunch] = useState<Record<string, LaunchEntry>>({})
  // Always-current ref so async callbacks (termSessionExists .then) read the
  // latest terminalLaunch without depending on a stale closure.
  const terminalLaunchRef = useRef(terminalLaunch)
  terminalLaunchRef.current = terminalLaunch
  // Per-task armed reviewer launch command (PTY-based, unchanged).
  const [reviewerLaunch, setReviewerLaunch] = useState<Record<string, LaunchEntry>>({})
  // Reviewer side panel state.
  const [reviewPanelTaskId, setReviewPanelTaskId] = useState<string | null>(null)
  const [activeReviewerIds, setActiveReviewerIds] = useState<Set<string>>(new Set())
  const executionStartedRef = useRef<Set<string>>(new Set())
  const reducedMotion = useReducedMotion() ?? false
  const surfaceEnterVariants = createEnterVariants({
    timing: 'standard',
    initialOpacity: 0.96,
    transform: { x: 4 },
    reducedMotion,
  })

  // Built-in agent-memory server + unified db paths are constant for the app
  // session, so fetch once and reuse for every launch command.
  const memoryLaunchRef = useRef<MemoryLaunchInfo | null>(null)
  useEffect(() => {
    getMemoryLaunchInfo().then((info) => {
      if (info) memoryLaunchRef.current = info
    })
  }, [])

  const markMounted = (taskId: string) =>
    setMounted((prev) => (prev.has(taskId) ? prev : new Set(prev).add(taskId)))

  const wasLaunched = (task: Task) => task.launchedAt != null

  // Direct command dispatch — used by revise (which needs its own full command).
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
        planningRole: planningRole(),
        systemPrompt,
        workspacePath: task.workspacePath,
        resume: opts?.resume,
        memory: memoryLaunchRef.current ?? undefined,
        autoMode,
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
  // Every task drives the executor → reviewer → (revise → reviewer)* → approve
  // loop; the reviewer persona is always the fixed 測試工程師 (REVIEWER_ROLE).
  // `firedRef` dedupes by a (stage, allDone, verdict, round) signature.
  const firedRef = useRef<Map<string, string>>(new Map())
  // Tracks the previous board so we can detect allDone transitions within the
  // current session and skip auto-review advances on app restart.
  const prevBoardRef = useRef<typeof board | null>(null)
  // Same idea for the planning→execution handoff: only auto-start execution when
  // planDone flips within this session, never on app reopen.
  const prevExecBoardRef = useRef<typeof board | null>(null)

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
        command: buildReviewCommand(
          task,
          task.workspacePath,
          reviewerRole(),
          autoMode
        ),
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
        task.workspacePath,
        autoMode
      )
    )
  }

  useEffect(() => {
    if (!autoMode) return
    const prevBoard = prevBoardRef.current
    prevBoardRef.current = board
    for (const task of board.in_progress) {
      const p = task.pipeline
      if (!p) continue
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
    if (terminalLaunch[selectedTaskId]) return
    const task = board.in_progress.find((t) => t.id === selectedTaskId)
    if (!task || !wasLaunched(task) || isTaskComplete(task)) return
    if (task.progress?.needsUserInput) return
    const cwd = task.worktreePath
    if (!cwd) return
    // Selecting a task must not start a fresh run. Auto-resume only when the
    // pinned conversation actually exists on disk; otherwise leave it for the
    // user to press 重跑.
    const isExecution = task.progress?.planDone === true
    const sessionId = isExecution
      ? executorSessionId(task.id)
      : planningSessionId(task.id)
    let cancelled = false
    void termSessionExists(cwd, sessionId).then((exists) => {
      if (cancelled || !exists || terminalLaunchRef.current[task.id]) return
      if (isExecution) executionStartedRef.current.add(task.id)
      armLaunch(task, { resume: true })
    })
    return () => {
      cancelled = true
    }
  }, [selectedTaskId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const prev = prevExecBoardRef.current
    prevExecBoardRef.current = board
    for (const task of board.in_progress) {
      if (!task.launchedAt) continue
      if (task.progress?.planDone !== true) continue
      if (task.progress?.needsUserInput) continue
      if (isTaskComplete(task)) continue
      if (executionStartedRef.current.has(task.id)) continue
      // Only auto-start execution when planning JUST completed in this session
      // (planDone flipped false→true). On app reopen there is no prior board, so
      // an already-planDone task is left for the user to press 重跑.
      const prevTask = prev?.in_progress.find((t) => t.id === task.id)
      if (!prevTask || prevTask.progress?.planDone === true) continue
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
  const subAgentTask = subAgentTaskId
    ? Object.values(board)
        .flat()
        .find((task) => task.id === subAgentTaskId)
    : null
  const liveSubAgentRuns = subAgentTaskId
    ? subAgents[subAgentTaskId]
    : undefined
  const liveSubAgentDrawer =
    subAgentTaskId && subAgentTask
      ? {
          taskId: subAgentTaskId,
          taskTitle: subAgentTask.title,
          runs: liveSubAgentRuns ?? [],
        }
      : null

  useEffect(() => {
    if (!subAgentTaskId || !subAgentTask) return
    subAgentDrawerSnapshotRef.current = {
      taskId: subAgentTaskId,
      taskTitle: subAgentTask.title,
      runs: liveSubAgentRuns ?? [],
    }
  }, [subAgentTaskId, subAgentTask, liveSubAgentRuns])

  const subAgentDrawerSnapshot =
    liveSubAgentDrawer ?? subAgentDrawerSnapshotRef.current

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
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
                  <WorkspaceSurface key={taskId} active={isSelected}>
                    <TaskWorkspacePanel
                      task={entry.task}
                      column={entry.column}
                      role={roleById(entry.task.roleId)}
                      reviewerRole={reviewerRole()}
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
                  </WorkspaceSurface>
                )
              })}

              {!selected && (
                <motion.div
                  initial="hidden"
                  animate="visible"
                  variants={surfaceEnterVariants}
                  className="flex h-full overflow-y-auto p-8"
                >
                  <div className="mx-auto w-full max-w-5xl pb-8">
                    <NewTaskForm
                      key={`${initialProjectPath ?? 'new'}:${newTaskNonce}`}
                      inline
                      initialProjectPath={initialProjectPath}
                      creating={creating}
                      error={createError}
                      pickFolder={pickFolder}
                      loadGitInfo={loadGitInfo}
                      initRepository={initRepository}
                      detectAgents={detectAgents}
                      agentConnections={agentConnections}
                      roles={roles}
                      onManageRoles={onManageRoles}
                      onSubmit={onCreateTask}
                    />
                  </div>
                </motion.div>
              )}
            </>
          )
        })()}
      </main>

      <SubAgentDrawer
        open={subAgentTaskId !== null}
        taskId={subAgentDrawerSnapshot?.taskId ?? ''}
        taskTitle={subAgentDrawerSnapshot?.taskTitle ?? ''}
        runs={subAgentDrawerSnapshot?.runs ?? []}
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
              reviewerRoleName: reviewerRole().name,
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
