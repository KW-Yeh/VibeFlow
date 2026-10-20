import React, { useCallback, useEffect, useRef, useState } from 'react'
import Head from 'next/head'
import { AnimatePresence } from 'motion/react'

import { KanbanBoard } from '@/components/kanban-board'
import { TerminalGrid, type GridTerminal } from '@/components/terminal-grid'
import { EditTaskDialog, type EditTaskPayload } from '@/components/edit-task-dialog'
import { SettingsDialog } from '@/components/settings-dialog'
import { SideMenu } from '@/components/side-menu'
import { InboxView, type InboxTab } from '@/components/inbox-view'
import type { BoardView } from '@/components/ui/view-tabs'
import {
  TerminalTabBar,
  type TerminalTab,
  type TerminalTabEntry,
} from '@/components/terminal-tab-bar'
import { RemoteShareDialog } from '@/components/remote-share-dialog'
import { NotificationToaster, type Toast } from '@/components/notification-toaster'
import { withNotificationDefaults } from '@/components/notification-settings'
import { DialogShell } from '@/components/ui/dialog-shell'
import { Loader2, X } from 'lucide-react'
import { useRemoteHost } from '@/hooks/use-remote-host'
import {
  cleanupTask,
  createTask,
  deleteTask,
  detectAgents,
  getGitInfo,
  getUpdateStatus,
  getProgress,
  initRepository,
  listRecentProjects,
  loadState,
  onProgressNotify,
  onProgressUpdate,
  onUpdateAvailable,
  openUpdateTerminal,
  onStateChanged,
  persistBoard,
  pickFolder,
  setSettings,
  standaloneTermRename,
  termKill,
  updateTask,
} from '@/lib/api'
import { boardGithubCards, draftFromItem } from '@/lib/github-display'
import { EMPTY_GITHUB_FILTERS, type GithubFilters } from '@/lib/github-filter'
import { useGithubInbox, useGithubTaskLinks } from '@/lib/use-github'
import { useJiraInbox } from '@/lib/use-jira'
import { boardJiraCards, draftFromTicket } from '@/lib/jira-display'
import { basenameFromPath } from '@/lib/workspace-path'
import {
  readGithubFilters,
  readInboxTab,
  readTerminalTabs,
  readViewUrl,
  writeGithubFilters,
  writeInboxTab,
  writeTerminalTabs,
  writeViewUrl,
} from '@/lib/view-persistence'
import type {
  AgentCliId,
  AvailableUpdate,
  AgentEffort,
  AttachmentInput,
  BoardState,
  GithubItem,
  JiraTicket,
  RecentProjectEntry,
  NotificationSettings,
  ProgressNotification,
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

type PaneTerminal = GridTerminal & { pending?: true }

const storedTerminal = ({ pending: _pending, ...entry }: PaneTerminal): GridTerminal => entry

/** Core's list, plus this page's panes whose start has not returned yet. */
function withStoredTerminals(current: PaneTerminal[], stored: GridTerminal[]): PaneTerminal[] {
  const keys = new Set(stored.map((t) => t.sessionKey))
  return [...stored, ...current.filter((t) => t.pending && !keys.has(t.sessionKey))]
}

export default function HomePage() {
  const [board, setBoard] = useState<BoardState>(FALLBACK_BOARD)
  // Live progress of running cards, read by core from each agent's transcript.
  // Session-only; a done card shows its stored Task.usage.
  const [progress, setProgress] = useState<Record<string, TaskProgress>>({})
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>(
    withNotificationDefaults()
  )
  const [toasts, setToasts] = useState<Toast[]>([])
  const [availableUpdate, setAvailableUpdate] = useState<AvailableUpdate | null>(null)
  const [dismissedUpdate, setDismissedUpdate] = useState<string | null>(null)
  const [updateLaunchError, setUpdateLaunchError] = useState<string | null>(null)
  const [openingUpdateTerminal, setOpeningUpdateTerminal] = useState(false)
  const [autoMode, setAutoMode] = useState(true)
  // Custom system prompt ('' = no additional system prompt).
  const [systemPrompt, setSystemPrompt] = useState('')
  // Global workstation path ('' = the ~/Desktop default is in effect).
  const [workstationPath, setWorkstationPath] = useState('')
  const [jiraStoryPointsFields, setJiraStoryPointsFields] = useState<string[]>([])
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

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  // Open terminal tabs, in bar order. Kept per browser (view-persistence), so a
  // reload brings the bar back.
  const [tabs, setTabs] = useState<TerminalTab[]>([])
  // The 終端機 page's shells live in core's store. A pane opened here shows at
  // once as pending; core has saved it once its start returns, and only then
  // can a rename reach core.
  const [gridTerminals, setGridTerminals] = useState<PaneTerminal[]>([])
  const gridTerminalsRef = useRef(gridTerminals)
  gridTerminalsRef.current = gridTerminals
  const [focusedGridTerminal, setFocusedGridTerminal] = useState<string | null>(null)
  // Existing-project folder to prefill in the inline new-task form (null = blank form).
  const [newTaskInitialProject, setNewTaskInitialProject] = useState<string | null>(null)
  const [newTaskNonce, setNewTaskNonce] = useState(0)

  // Which view the top pane shows, and what the Issues & PRs view is narrowed to.
  const [view, setView] = useState<BoardView>('board')
  const [githubFilters, setGithubFilters] = useState<Record<'issues' | 'prs', GithubFilters>>({
    issues: EMPTY_GITHUB_FILTERS, prs: EMPTY_GITHUB_FILTERS,
  })
  const [inboxTab, setInboxTab] = useState<InboxTab | null>(null)
  const [recentProjects, setRecentProjects] = useState<RecentProjectEntry[]>([])

  useEffect(() => {
    let active = true
    loadState().then((state) => {
      if (!active) return
      if (state) {
        setBoard(state.board)
        setAutoMode(state.settings.autoMode)
        setSystemPrompt(state.settings.systemPrompt ?? '')
        setWorkstationPath(state.settings.workstationPath ?? '')
        setJiraStoryPointsFields(state.settings.jira?.storyPointsFields ?? [])
        setNotificationSettings(withNotificationDefaults(state.settings.notifications))
        setGridTerminals((prev) => withStoredTerminals(prev, state.terminals ?? []))
      }
      const where = readViewUrl()
      setView(where.view)
      setSelectedTaskId(where.taskId)
      const savedTabs = readTerminalTabs()
      setTabs(where.taskId && !savedTabs.some((t) => t.taskId === where.taskId)
        ? [...savedTabs, { taskId: where.taskId, preview: true }]
        : savedTabs)
      setInboxTab(readInboxTab())
      setGithubFilters(readGithubFilters())
      setLoaded(true)
    })
    return () => {
      active = false
    }
  }, [])

  // Refresh board when the CLI (or any external writer) changes the store file.
  useEffect(() => {
    return onStateChanged((state) => {
      setBoard(state.board)
      setAutoMode(state.settings.autoMode)
      setSystemPrompt(state.settings.systemPrompt ?? '')
      setWorkstationPath(state.settings.workstationPath ?? '')
      setJiraStoryPointsFields(state.settings.jira?.storyPointsFields ?? [])
      setNotificationSettings(withNotificationDefaults(state.settings.notifications))
      setGridTerminals((prev) => withStoredTerminals(prev, state.terminals ?? []))
    })
  }, [])

  // Written only once restored, so the first render cannot overwrite what a reload should bring back.
  useEffect(() => { if (loaded) writeViewUrl(view, selectedTaskId) }, [loaded, view, selectedTaskId])
  useEffect(() => { if (loaded) writeTerminalTabs(tabs) }, [loaded, tabs])
  useEffect(() => { if (loaded) writeInboxTab(inboxTab) }, [loaded, inboxTab])
  useEffect(() => { if (loaded) writeGithubFilters(githubFilters) }, [loaded, githubFilters])

  useEffect(() => {
    return onProgressUpdate(({ taskId, progress: value }) => {
      setProgress((prev) => ({ ...prev, [taskId]: value }))
    })
  }, [])

  useEffect(() => {
    let active = true
    const unsubscribe = onUpdateAvailable(setAvailableUpdate)
    void getUpdateStatus().then((update) => { if (active) setAvailableUpdate(update) }).catch(() => {})
    return () => { active = false; unsubscribe() }
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

  const openGridTerminal = (projectPath: string, taskId?: string) => {
    const sessionKey = `terminal_${window.crypto.randomUUID()}`
    setFocusedGridTerminal(sessionKey)
    setGridTerminals((current) => [...current, {
      pending: true,
      sessionKey,
      title: basenameFromPath(projectPath),
      projectPath,
      ...(taskId ? { taskId } : {}),
    }])
    setView('terminals')
  }

  const renameGridTerminal = (sessionKey: string, title: string) => {
    const entry = gridTerminalsRef.current.find((t) => t.sessionKey === sessionKey)
    setGridTerminals((current) => current.map((t) => (t.sessionKey === sessionKey ? { ...t, title } : t)))
    if (entry && !entry.pending) void standaloneTermRename(sessionKey, title).catch(() => {})
  }

  // A title changed while the start was in flight is sent now; core ignores an unchanged one.
  const gridTerminalStarted = (sessionKey: string) => {
    const entry = gridTerminalsRef.current.find((t) => t.sessionKey === sessionKey)
    if (!entry?.pending) return
    setGridTerminals((current) => current.map((t) => (t.sessionKey === sessionKey ? storedTerminal(t) : t)))
    void standaloneTermRename(sessionKey, entry.title).catch(() => {})
  }

  const closeGridTerminal = (sessionKey: string) => {
    termKill(sessionKey)
    setGridTerminals((current) => current.filter((t) => t.sessionKey !== sessionKey))
    setFocusedGridTerminal((current) => (current === sessionKey ? null : current))
  }

  const openTaskGridTerminal = (taskId: string) => {
    const task = findTask(board, taskId)
    if (task?.projectPath) openGridTerminal(task.projectPath, taskId)
  }

  const showGridTerminal = (sessionKey: string) => {
    setFocusedGridTerminal(sessionKey)
    setView('terminals')
  }

  const handleBoardChange = (next: BoardState) => {
    setBoard(next)
    void persistBoard(next)
  }

  // Open (or focus) a task's tab. A preview tab replaces the existing preview
  // tab in place — VSCode's single-click behaviour — while a pinned open always
  // gets its own slot at the end of the bar.
  const openTab = (taskId: string, opts?: { pin?: boolean }) => {
    setView('board')
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
    setView('board')
    setCreateError(null)
    setNewTaskInitialProject(null)
    setNewTaskNonce((nonce) => nonce + 1)
    setSelectedTaskId(null)
  }

  const handleConvertGithubItem = async (item: GithubItem, projectPath: string): Promise<string> => {
    const result = await createTask({ baseBranch: null, ...draftFromItem(item), projectPath, autoMode })
    if (!result) throw new Error('未連線到 VibeFlow core')
    setBoard(result.state.board)
    return result.task.id
  }

  const handleSaveSettings = async (
    nextPrompt: string,
    nextWorkstation: string,
    nextAutoMode: boolean,
    nextNotifications: NotificationSettings,
    nextJiraStoryPointsFields: string[]
  ) => {
    setSavingSettings(true)
    setSettingsError(null)
    try {
      await setSettings({
        systemPrompt: nextPrompt,
        workstationPath: nextWorkstation || undefined,
        autoMode: nextAutoMode,
        notifications: nextNotifications,
        jira: { storyPointsFields: nextJiraStoryPointsFields },
      })
      setSystemPrompt(nextPrompt)
      setWorkstationPath(nextWorkstation)
      setAutoMode(nextAutoMode)
      setNotificationSettings(nextNotifications)
      setJiraStoryPointsFields(nextJiraStoryPointsFields)
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
  const github = useGithubInbox(board, loaded)
  const jira = useJiraInbox(loaded)
  const taskLinks = useGithubTaskLinks(board, loaded)
  const allTasks = [...board.in_progress, ...board.backlog, ...board.done]
  const githubCards = boardGithubCards(allTasks)
  const jiraCards = boardJiraCards(allTasks)
  const currentInboxTab = inboxTab ?? (jira.inbox?.status === 'ok' ? 'jira' : 'issues')
  const projects = Array.from(new Map([
    ...allTasks.filter((task) => task.projectPath).map((task) => [task.projectPath!, { path: task.projectPath!, name: task.projectName ?? task.projectPath! }] as const),
    ...recentProjects.filter((project) => !project.missing).map((project) => [project.path, { path: project.path, name: project.name }] as const),
  ]).values()).sort((a, b) => a.name.localeCompare(b.name))
  useEffect(() => {
    if (loaded) void listRecentProjects().then(setRecentProjects)
  }, [loaded, board.backlog.length])
  const createJiraTask = async (ticket: JiraTicket, projectPath: string): Promise<string> => {
    const draft = draftFromTicket(ticket)
    const result = await createTask({ ...draft, projectPath, baseBranch: null, autoMode })
    if (!result) throw new Error('未連線到 VibeFlow core')
    setBoard(result.state.board)
    return result.task.id
  }

  const goToTask = (taskId: string) => {
    setView('board')
    openTab(taskId, { pin: true })
  }

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
                view={view}
                onSelectView={setView}
                onNewTask={handleOpenNewTask}
                remoteActive={!!remoteHost.roomCode}
                onOpenSettings={() => {
                  setSettingsError(null)
                  setSettingsOpen(true)
                }}
              />
              <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                {availableUpdate && dismissedUpdate !== availableUpdate.latestVersion && (
                  <div role="status" className="flex items-center gap-3 border-b border-border bg-primary/10 px-4 py-2 text-sm">
                    <span className="min-w-0 flex-1">
                      {availableUpdate.installedVersion ? (
                        <>
                          VibeFlow v{availableUpdate.installedVersion} 已安裝，但 host 沒有自動重新啟動：{availableUpdate.restartBlocked}。
                          要立即使用新版，請執行 <code>vibeflow shutdown</code> 後再執行 <code>vibeflow</code>。
                        </>
                      ) : (
                        <>
                          VibeFlow v{availableUpdate.latestVersion} 已發布（目前 v{availableUpdate.currentVersion}）。
                          按下更新會開啟系統終端機執行更新指令（Windows：<code>vibeflow update</code>；其他平台：<code>sudo vibeflow update</code>）。安裝完成後 host 會自動重新啟動。
                        </>
                      )}
                      {updateLaunchError && <span role="alert" className="block text-destructive">{updateLaunchError}</span>}
                    </span>
                    {!availableUpdate.installedVersion && <button type="button" disabled={openingUpdateTerminal} onClick={() => {
                      setOpeningUpdateTerminal(true)
                      setUpdateLaunchError(null)
                      void openUpdateTerminal().catch((error) => {
                        setUpdateLaunchError(error instanceof Error ? error.message : '無法開啟更新終端機')
                      }).finally(() => setOpeningUpdateTerminal(false))
                    }} className="shrink-0 rounded-sm border border-border bg-background px-3 py-1 hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50">
                      {openingUpdateTerminal ? '開啟中…' : '更新 VibeFlow'}
                    </button>}
                    <button type="button" aria-label="關閉更新提示" onClick={() => setDismissedUpdate(availableUpdate.latestVersion)}
                      className="rounded-sm p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                      <X className="size-4" />
                    </button>
                  </div>
                )}
                <div className="min-h-0 flex-1">
                <div className={view === 'terminals' ? 'hidden' : 'h-full'}>
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
                  onOpenTaskTerminal={openTaskGridTerminal}
                  taskTerminals={gridTerminals}
                  onShowTaskTerminal={showGridTerminal}
                  autoMode={autoMode}
                  workstationPath={workstationPath}
                  progress={progress}
                  selectedTaskId={selectedTaskId}
                  onTaskInteract={pinTab}
                  openTabIds={tabs.map((t) => t.taskId)}
                  initialProjectPath={newTaskInitialProject}
                  newTaskNonce={newTaskNonce}
                  view={view}
                  onViewChange={setView}
                  taskLinks={taskLinks.links}
                  githubView={
                    <InboxView
                      view={view}
                      onViewChange={setView}
                      tab={currentInboxTab}
                      onTabChange={setInboxTab}
                      jira={jira}
                      github={{ ...github, refresh: () => { void github.refresh(); void taskLinks.refresh() } }}
                      githubFilters={githubFilters}
                      onGithubFiltersChange={(kind, filters) => setGithubFilters((previous) => ({ ...previous, [kind]: filters }))}
                      jiraCards={jiraCards}
                      githubCards={githubCards}
                      projects={projects}
                      onBrowseProject={pickProjectFolder}
                      onCreateJira={createJiraTask}
                      onConvertGithub={handleConvertGithubItem}
                      onOpenTask={goToTask}
                      onOpenSettings={() => {
                        setSettingsError(null)
                        setSettingsOpen(true)
                      }}
                    />
                  }
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
                <div className={view === 'terminals' ? 'h-full' : 'hidden'}>
                  <TerminalGrid
                    view={view}
                    onViewChange={setView}
                    terminals={gridTerminals}
                    taskWorktreePaths={Object.fromEntries([...board.in_progress, ...board.done]
                      .filter((task) => task.worktreePath)
                      .map((task) => [task.id, task.worktreePath!]))}
                    focusedSessionKey={focusedGridTerminal}
                    recentProjects={recentProjects}
                    onCreate={(projectPath) => openGridTerminal(projectPath)}
                    onRename={renameGridTerminal}
                    onStarted={gridTerminalStarted}
                    onClose={closeGridTerminal}
                    onBrowse={pickProjectFolder}
                  />
                </div>
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
              jiraStoryPointsFields={jiraStoryPointsFields}
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
