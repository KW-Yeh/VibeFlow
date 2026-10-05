import React, { useCallback, useEffect, useRef, useState } from 'react'
import Head from 'next/head'
import { AnimatePresence } from 'motion/react'

import { KanbanBoard } from '@/components/kanban-board'
import { EditTaskDialog, type EditTaskPayload } from '@/components/edit-task-dialog'
import { SettingsDialog } from '@/components/settings-dialog'
import { SideMenu } from '@/components/side-menu'
import {
  TerminalTabBar,
  type TerminalTab,
  type TerminalTabEntry,
} from '@/components/terminal-tab-bar'
import { RemoteShareDialog } from '@/components/remote-share-dialog'
import { NotificationToaster, type Toast } from '@/components/notification-toaster'
import { withNotificationDefaults } from '@/components/notification-settings'
import { DialogShell } from '@/components/ui/dialog-shell'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { useRemoteHost } from '@/hooks/use-remote-host'
import {
  cleanupTask,
  createTask,
  deleteTask,
  detectAgents,
  getGitInfo,
  getProgress,
  initRepository,
  listRecentProjects,
  loadState,
  onProgressNotify,
  onProgressUpdate,
  onStateChanged,
  onSubAgentsUpdate,
  persistBoard,
  pickFolder,
  setSettings,
  updateTask,
} from '@/lib/api'
import { Button } from '@/components/ui/button'
import type {
  AgentCliId,
  AgentEffort,
  AttachmentInput,
  BoardState,
  NotificationSettings,
  ProgressNotification,
  SubAgentRun,
  Task,
  TaskProgress,
} from '@/lib/types'

// Rendered until the persisted state loads, and as a fallback when core is
// unreachable (static export preview).
const FALLBACK_BOARD: BoardState = {
  backlog: [],
  in_progress: [],
  done: [],
}

const TAB_COLUMN_ORDER = ['in_progress', 'backlog', 'done'] as const

/** One notification as the line under the card title. */
function notificationText(n: ProgressNotification): string {
  switch (n.kind) {
    case 'step_completed':
      return `完成 ${n.done}/${n.total} — ${n.item ?? ''}`
    case 'all_completed':
      return '所有步驟已完成'
    case 'waiting_input':
      return n.waitingFor === 'permission' ? '等待你允許權限' : '等待你的輸入'
  }
}

function findTask(board: BoardState, taskId: string): Task | null {
  for (const column of Object.values(board)) {
    const found = column.find((t) => t.id === taskId)
    if (found) return found
  }
  return null
}

export default function HomePage() {
  const [board, setBoard] = useState<BoardState>(FALLBACK_BOARD)
  // Sub-agent runs are session-only (never persisted to the store), so they
  // live in their own state keyed by task id — kept out of `board` so a
  // persistBoard write can't leak them to disk.
  const [subAgents, setSubAgents] = useState<Record<string, SubAgentRun[]>>({})
  // Live progress of running cards, read by core from each agent's transcript.
  // Session-only like sub-agents; a done card shows its stored Task.usage.
  const [progress, setProgress] = useState<Record<string, TaskProgress>>({})
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>(
    withNotificationDefaults()
  )
  const [toasts, setToasts] = useState<Toast[]>([])
  const [autoMode, setAutoMode] = useState(true)
  // Custom system prompt ('' = only the built-in Artifact instructions).
  const [systemPrompt, setSystemPrompt] = useState('')
  // Global workstation path ('' = the ~/Desktop default is in effect).
  const [workstationPath, setWorkstationPath] = useState('')
  const [loaded, setLoaded] = useState(false)

  // Settings dialog state
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)


  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Edit dialog state
  const [editTask, setEditTask] = useState<Task | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // Remote share state
  const [remoteShareOpen, setRemoteShareOpen] = useState(false)

  // Side menu state
  const [sideMenuCollapsed, setSideMenuCollapsed] = useState(true)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  // Open terminal tabs, in bar order. Session-only by design — nothing here is
  // persisted, so a restart starts from an empty bar.
  const [tabs, setTabs] = useState<TerminalTab[]>([])
  // Existing-project folder to prefill in the inline new-task form (null = blank form).
  const [newTaskInitialProject, setNewTaskInitialProject] = useState<string | null>(null)
  const [newTaskNonce, setNewTaskNonce] = useState(0)

  // Delete-project confirmation modal state.
  const [deleteProjectTarget, setDeleteProjectTarget] = useState<{
    name: string
    taskIds: string[]
  } | null>(null)
  const [deletingProject, setDeletingProject] = useState(false)

  useEffect(() => {
    let active = true
    loadState().then((state) => {
      if (!active) return
      if (state) {
        setBoard(state.board)
        setAutoMode(state.settings.autoMode)
        setSystemPrompt(state.settings.systemPrompt ?? '')
        setWorkstationPath(state.settings.workstationPath ?? '')
        setNotificationSettings(withNotificationDefaults(state.settings.notifications))
      }
      setLoaded(true)
    })
    return () => {
      active = false
    }
  }, [])

  // The sidebar no longer auto-opens: the board's three columns already list
  // every task, so an expanded sidebar would repeat them. It stays collapsed to
  // its icon rail (projects, settings) until opened by hand.

  // Live sub-agent updates pushed from main while sessions run. Kept in a
  // dedicated state map (not merged into `board`) so they stay session-only.
  useEffect(() => {
    return onSubAgentsUpdate(({ taskId, subAgents: runs }) => {
      setSubAgents((prev) => ({ ...prev, [taskId]: runs }))
    })
  }, [])

  // Refresh board when the CLI (or any external writer) changes the store file.
  useEffect(() => {
    return onStateChanged((state) => {
      setBoard(state.board)
      setAutoMode(state.settings.autoMode)
      setSystemPrompt(state.settings.systemPrompt ?? '')
      setWorkstationPath(state.settings.workstationPath ?? '')
      setNotificationSettings(withNotificationDefaults(state.settings.notifications))
    })
  }, [])

  useEffect(() => {
    return onProgressUpdate(({ taskId, progress: value }) => {
      setProgress((prev) => ({ ...prev, [taskId]: value }))
    })
  }, [])

  // A frontend that connects mid-run asks once per running card; updates follow on the bus.
  const runningIds = board.in_progress.map((t) => t.id).join(',')
  useEffect(() => {
    let active = true
    for (const id of runningIds ? runningIds.split(',') : []) {
      void getProgress(id).then((value) => {
        if (active && value) setProgress((prev) => (prev[id] ? prev : { ...prev, [id]: value }))
      })
    }
    return () => {
      active = false
    }
  }, [runningIds])

  // Drop tabs whose task no longer exists. Deletions made in this window are
  // handled by closeTabs (which also picks the next tab); this covers tasks
  // removed by the CLI or another writer, where there is no local handler.
  useEffect(() => {
    const ids = new Set(Object.values(board).flat().map((t) => t.id))
    setTabs((prev) =>
      prev.every((t) => ids.has(t.taskId))
        ? prev
        : prev.filter((t) => ids.has(t.taskId))
    )
    setSelectedTaskId((current) => (current && !ids.has(current) ? null : current))
  }, [board])

  const pickProjectFolder = () => pickFolder('選擇專案資料夾')

  const handleBoardChange = (next: BoardState) => {
    setBoard(next)
    void persistBoard(next)
  }

  // Open (or focus) a task's tab. A preview tab replaces the existing preview
  // tab in place — VSCode's single-click behaviour — while a pinned open always
  // gets its own slot at the end of the bar.
  const openTab = (taskId: string, opts?: { pin?: boolean }) => {
    setTabs((prev) => {
      const existing = prev.find((t) => t.taskId === taskId)
      if (existing) {
        if (!opts?.pin || !existing.preview) return prev
        return prev.map((t) => (t.taskId === taskId ? { ...t, preview: false } : t))
      }
      const next: TerminalTab = { taskId, preview: opts?.pin !== true }
      const previewIndex = prev.findIndex((t) => t.preview)
      if (next.preview && previewIndex !== -1) {
        const copy = [...prev]
        copy[previewIndex] = next
        return copy
      }
      return [...prev, next]
    })
    setSelectedTaskId(taskId)
  }

  // Stage notifications. Core already applied the per-kind switches; whether
  // the user is looking at the card is a UI fact, so that check lives here.
  const openTabRef = useRef(openTab)
  openTabRef.current = openTab
  const selectedRef = useRef(selectedTaskId)
  selectedRef.current = selectedTaskId
  const notificationsRef = useRef(notificationSettings)
  notificationsRef.current = notificationSettings
  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])
  useEffect(() => {
    let seq = 0
    return onProgressNotify(({ taskId, title, notifications }) => {
      const prefs = notificationsRef.current
      if (!prefs.enabled) return
      const watching = document.visibilityState === 'visible' && document.hasFocus() && selectedRef.current === taskId
      if (watching) return
      const fresh: Toast[] = notifications.map((n) => ({
        id: `${Date.now()}-${seq++}`,
        taskId,
        title,
        body: notificationText(n),
      }))
      setToasts((prev) => [...prev, ...fresh].slice(-5))
      const canDesktop = prefs.desktop && typeof Notification !== 'undefined' && Notification.permission === 'granted'
      if (canDesktop && !document.hasFocus()) {
        for (const toast of fresh) {
          const n = new Notification(toast.title, { body: toast.body, tag: `${taskId}:${toast.body}` })
          n.onclick = () => {
            window.focus()
            openTabRef.current(taskId)
            n.close()
          }
        }
      }
    })
  }, [])

  const pinTab = (taskId: string) => {
    setTabs((prev) =>
      prev.some((t) => t.taskId === taskId && t.preview)
        ? prev.map((t) => (t.taskId === taskId ? { ...t, preview: false } : t))
        : prev
    )
  }

  // Closing is purely a bar operation: the TaskWorkspacePanel stays mounted
  // (see kanban-board's `mounted` set), so a running agent's PTY is untouched
  // and reopening the tab shows the full scrollback.
  const closeTabs = (taskIds: string[]) => {
    const removing = new Set(taskIds)
    if (selectedTaskId && removing.has(selectedTaskId)) {
      const index = tabs.findIndex((t) => t.taskId === selectedTaskId)
      const after = tabs.slice(index + 1).find((t) => !removing.has(t.taskId))
      const before = tabs
        .slice(0, Math.max(index, 0))
        .reverse()
        .find((t) => !removing.has(t.taskId))
      setSelectedTaskId(after?.taskId ?? before?.taskId ?? null)
    }
    setTabs((prev) => prev.filter((t) => !removing.has(t.taskId)))
  }

  const handleOpenNewTask = () => {
    setCreateError(null)
    setNewTaskInitialProject(null)
    setNewTaskNonce((nonce) => nonce + 1)
    setSelectedTaskId(null)
  }

  // Sidebar per-project「新增任務」: open the inline form prefilled with that
  // project's folder (null path falls back to a blank form).
  const handleNewTaskForProject = (projectPath: string | null) => {
    setCreateError(null)
    setNewTaskInitialProject(projectPath)
    setNewTaskNonce((nonce) => nonce + 1)
    setSelectedTaskId(null)
  }

  const handleSaveSettings = async (
    nextPrompt: string,
    nextWorkstation: string,
    nextAutoMode: boolean,
    nextNotifications: NotificationSettings
  ) => {
    setSavingSettings(true)
    setSettingsError(null)
    try {
      await setSettings({
        systemPrompt: nextPrompt,
        workstationPath: nextWorkstation || undefined,
        autoMode: nextAutoMode,
        notifications: nextNotifications,
      })
      setSystemPrompt(nextPrompt)
      setWorkstationPath(nextWorkstation)
      setAutoMode(nextAutoMode)
      setNotificationSettings(nextNotifications)
      setSettingsOpen(false)
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingSettings(false)
    }
  }

  const handleCreateTask = async (
    title: string,
    description: string,
    projectPath: string,
    baseBranch: string | null,
    branch: string,
    agentCli: AgentCliId,
    model: string,
    effort: AgentEffort,
    taskAutoMode: boolean,
    attachments: AttachmentInput[]
  ) => {
    setCreating(true)
    setCreateError(null)
    try {
      const result = await createTask({
        title,
        description,
        projectPath,
        baseBranch,
        branch: branch || undefined,
        agentCli,
        model: model || undefined,
        effort,
        autoMode: taskAutoMode,
        attachments,
      })
      if (result) {
        setBoard(result.state.board)
        // A task the user just created is never throwaway — open it pinned so
        // the next single-click elsewhere can't discard it.
        openTab(result.task.id, { pin: true })
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  const handleOpenEditTask = (taskId: string) => {
    setEditError(null)
    // Started and finished cards are read-only.
    if (!board.backlog.some((t) => t.id === taskId)) return
    setEditTask(findTask(board, taskId))
  }

  const handleSaveEdit = async (payload: EditTaskPayload) => {
    if (!editTask) return
    setSavingEdit(true)
    setEditError(null)
    try {
      const state = await updateTask({
        taskId: editTask.id,
        title: payload.title,
        description: payload.description,
        agentCli: payload.agentCli,
        model: payload.model || undefined,
        effort: payload.effort,
        autoMode: payload.autoMode,
        projectPath: payload.projectPath,
        baseBranch: payload.baseBranch,
        branch: payload.branch,
      })
      if (state) setBoard(state.board)
      setEditTask(null)
    } catch (err) {
      setEditError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingEdit(false)
    }
  }

  const handleTaskDone = async (taskId: string) => {
    const state = await cleanupTask(taskId)
    if (state) setBoard(state.board)
  }

  const handleDeleteTask = async (taskId: string) => {
    const state = await deleteTask(taskId)
    if (state) {
      setBoard(state.board)
      closeTabs([taskId])
    }
  }

  const handleDeleteProject = (name: string, taskIds: string[]) => {
    if (taskIds.length === 0) return
    setDeleteProjectTarget({ name, taskIds })
  }

  // Delete every task under the project (each deleteTask clears its PTY +
  // worktree + branch + conversation and drops the card). Runs sequentially so
  // git worktree operations on the shared repo don't race one another.
  const confirmDeleteProject = async () => {
    if (!deleteProjectTarget) return
    setDeletingProject(true)
    try {
      let latest: BoardState | null = null
      for (const id of deleteProjectTarget.taskIds) {
        const state = await deleteTask(id)
        if (state) latest = state.board
      }
      if (latest) setBoard(latest)
      closeTabs(deleteProjectTarget.taskIds)
      setDeleteProjectTarget(null)
    } finally {
      setDeletingProject(false)
    }
  }

  // Titles/status are read from the board each render, so editing a task or
  // moving its card updates the tab without any tab-state bookkeeping.
  const tabEntries: TerminalTabEntry[] = tabs.flatMap((tab) => {
    for (const column of TAB_COLUMN_ORDER) {
      const task = board[column].find((t) => t.id === tab.taskId)
      if (task) return [{ ...tab, title: task.title, column }]
    }
    return []
  })

  // Remote control has no entry point for now: nothing calls startSharing, so
  // the host never registers with the public PeerJS broker. The dialog and the
  // host stay wired up so the feature can be handed back with one prop.
  const remoteHost = useRemoteHost({
    board,
    autoMode,
    onStateChange: (next) => {
      setBoard(next)
      void persistBoard(next)
    },
  })

  return (
    <React.Fragment>
      <Head>
        <title>VibeFlow</title>
      </Head>
      <div className="bg-background text-foreground">
        {loaded ? (
          <>
            <div className="flex h-screen overflow-hidden">
              <SideMenu
                collapsed={sideMenuCollapsed}
                onToggleCollapse={() => setSideMenuCollapsed((v) => !v)}
                board={board}
                selectedTaskId={selectedTaskId}
                onSelectTask={openTab}
                onNewTask={handleOpenNewTask}
                onNewTaskForProject={handleNewTaskForProject}
                onDeleteProject={handleDeleteProject}
                remoteActive={!!remoteHost.roomCode}
                onOpenSettings={() => {
                  setSettingsError(null)
                  setSettingsOpen(true)
                }}
              />
              <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <div className="min-h-0 flex-1">
                <KanbanBoard
                  tabBar={
                    <TerminalTabBar
                      entries={tabEntries}
                      activeTaskId={selectedTaskId}
                      onSelect={openTab}
                      onPin={pinTab}
                      onClose={(taskId) => closeTabs([taskId])}
                    />
                  }
                  onSelectTask={openTab}
                  onNewTask={handleOpenNewTask}
                  board={board}
                  onBoardChange={handleBoardChange}
                  onEditTask={handleOpenEditTask}
                  onTaskDone={handleTaskDone}
                  onDeleteTask={handleDeleteTask}
                  autoMode={autoMode}
                  workstationPath={workstationPath}
                  subAgents={subAgents}
                  progress={progress}
                  selectedTaskId={selectedTaskId}
                  onTaskInteract={pinTab}
                  openTabIds={tabs.map((t) => t.taskId)}
                  initialProjectPath={newTaskInitialProject}
                  newTaskNonce={newTaskNonce}
                  creating={creating}
                  createError={createError}
                  pickFolder={pickProjectFolder}
                  loadRecentProjects={listRecentProjects}
                  loadGitInfo={getGitInfo}
                  initRepository={initRepository}
                  detectAgents={detectAgents}
                  onCreateTask={handleCreateTask}
                />
                </div>
              </div>
            </div>
            <EditTaskDialog
              task={editTask}
              defaultAutoMode={autoMode}
              detectAgents={detectAgents}
              pickFolder={pickProjectFolder}
              loadRecentProjects={listRecentProjects}
              loadGitInfo={getGitInfo}
              saving={savingEdit}
              error={editError}
              onSubmit={handleSaveEdit}
              onClose={() => setEditTask(null)}
            />
            <SettingsDialog
              open={settingsOpen}
              systemPrompt={systemPrompt}
              workstationPath={workstationPath}
              autoMode={autoMode}
              notifications={notificationSettings}
              saving={savingSettings}
              error={settingsError}
              onSave={handleSaveSettings}
              onPickFolder={() => pickFolder('選擇工作區資料夾')}
              onClose={() => setSettingsOpen(false)}
            />
            <AnimatePresence>
              {creating && (
                <DialogShell
                  key="creating-task-dialog"
                title="建立任務中"
                saving
                onClose={() => {}}
                contentClassName="max-w-sm rounded-lg p-5"
              >
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                      <Loader2 className="size-5 animate-spin" />
                    </span>
                    <div className="min-w-0 space-y-1">
                      <h2 className="text-lg font-semibold tracking-tight">
                        正在建立 workspace
                      </h2>
                      <p className="text-base leading-6 text-muted-foreground">
                        正在建立 git worktree、分支與任務資料。完成前請先不要切換或操作其他任務。
                      </p>
                    </div>
                  </div>
                </div>
                </DialogShell>
              )}
            </AnimatePresence>
            <AnimatePresence>
              {deleteProjectTarget && (
                <DialogShell
                  key="delete-project-dialog"
                title="刪除專案"
                saving={deletingProject}
                onClose={() => {
                  if (!deletingProject) setDeleteProjectTarget(null)
                }}
                contentClassName="max-w-md rounded-lg p-5"
              >
                <div className="space-y-5">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive">
                      <AlertTriangle className="size-5" />
                    </span>
                    <div className="min-w-0 space-y-1">
                      <h2 className="text-lg font-semibold tracking-tight">
                        刪除專案「{deleteProjectTarget.name}」？
                      </h2>
                      <p className="text-base leading-6 text-muted-foreground">
                        這會刪除此專案底下的 {deleteProjectTarget.taskIds.length}{' '}
                        個任務，包含它們的 worktree、branch 與對話紀錄。此操作無法復原。
                      </p>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="rounded-full"
                      disabled={deletingProject}
                      onClick={() => setDeleteProjectTarget(null)}
                    >
                      取消
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="rounded-full active:scale-95 motion-reduce:transform-none"
                      disabled={deletingProject}
                      onClick={confirmDeleteProject}
                    >
                      {deletingProject ? '刪除中…' : '刪除專案'}
                    </Button>
                  </div>
                </div>
                </DialogShell>
              )}
            </AnimatePresence>
            <AnimatePresence>
              {remoteShareOpen && remoteHost.roomCode && (
                <RemoteShareDialog
                  key="remote-share-dialog"
                  roomCode={remoteHost.roomCode}
                  peerCount={remoteHost.peerCount}
                  onClose={() => setRemoteShareOpen(false)}
                  onStop={() => {
                    remoteHost.stopSharing()
                    setRemoteShareOpen(false)
                  }}
                />
              )}
            </AnimatePresence>
            <NotificationToaster
              toasts={toasts}
              onOpen={(taskId) => openTabRef.current(taskId)}
              onDismiss={dismissToast}
            />
          </>
        ) : (
          <div className="flex min-h-screen items-center justify-center bg-background text-base text-muted-foreground">
            載入中…
          </div>
        )}
      </div>
    </React.Fragment>
  )
}
