import React, { useCallback, useEffect, useRef, useState } from 'react'
import Head from 'next/head'
import { AnimatePresence } from 'motion/react'

import { KanbanBoard } from '@/components/kanban-board'
import { TerminalGrid, type GridTerminal } from '@/components/terminal-grid'
import { EditTaskDialog, type EditTaskPayload } from '@/components/edit-task-dialog'
import { NewTaskDialog, type NewTaskDraft, type NewTaskInitial } from '@/components/new-task-dialog'
import { SettingsDialog } from '@/components/settings-dialog'
import { SideMenu } from '@/components/side-menu'
import { InboxView, type InboxTab } from '@/components/inbox-view'
import type { BoardView } from '@/components/ui/view-tabs'
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
  clearRetiredKeys,
  readGithubFilters,
  readInboxTab,
  readJiraScope,
  readViewUrl,
  writeGithubFilters,
  writeInboxTab,
  writeJiraScope,
  writeViewUrl,
} from '@/lib/view-persistence'
import type {
  AvailableUpdate,
  BoardState,
  ColumnId,
  GithubItem,
  JiraTicket,
  JiraScope,
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

function columnOf(board: BoardState, taskId: string): ColumnId | null {
  for (const column of Object.keys(board) as ColumnId[]) {
    if (board[column].some((t) => t.id === taskId)) return column
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
  // A card to start once the board that holds its latest state has rendered.
  const [startRequest, setStartRequest] = useState<string | null>(null)

  // Remote share state
  const [remoteShareOpen, setRemoteShareOpen] = useState(false)

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  // The 終端機 page's shells live in core's store. A pane opened here shows at
  // once as pending; core has saved it once its start returns, and only then
  // can a rename reach core.
  const [gridTerminals, setGridTerminals] = useState<PaneTerminal[]>([])
  const gridTerminalsRef = useRef(gridTerminals)
  gridTerminalsRef.current = gridTerminals
  const [focusedGridTerminal, setFocusedGridTerminal] = useState<string | null>(null)
  const [newTaskOpen, setNewTaskOpen] = useState(false)
  /** Set when the sheet was opened from an inbox item. */
  const [newTaskInitial, setNewTaskInitial] = useState<NewTaskInitial | null>(null)

  // Which page is shown, and what the Issues & PRs view is narrowed to.
  const [view, setView] = useState<BoardView>('board')
  const [githubFilters, setGithubFilters] = useState<Record<'issues' | 'prs', GithubFilters>>({
    issues: EMPTY_GITHUB_FILTERS, prs: EMPTY_GITHUB_FILTERS,
  })
  const [inboxTab, setInboxTab] = useState<InboxTab | null>(null)
  const [jiraScope, setJiraScope] = useState<JiraScope>('sprint')
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
      clearRetiredKeys()
      setInboxTab(readInboxTab())
      setJiraScope(readJiraScope())
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
  useEffect(() => { if (loaded) writeInboxTab(inboxTab) }, [loaded, inboxTab])
  useEffect(() => { if (loaded) writeJiraScope(jiraScope) }, [loaded, jiraScope])
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

  // A card deleted here, by the CLI or by another writer leaves nothing selected.
  useEffect(() => {
    const ids = new Set(Object.values(board).flat().map((t) => t.id))
    setSelectedTaskId((current) => (current && !ids.has(current) ? null : current))
  }, [board])

  const pickProjectFolder = () => pickFolder('選擇專案資料夾')

  const openGridTerminal = (projectPath?: string, taskId?: string) => {
    const sessionKey = `terminal_${window.crypto.randomUUID()}`
    setFocusedGridTerminal(sessionKey)
    setGridTerminals((current) => [...current, {
      pending: true,
      sessionKey,
      title: projectPath ? basenameFromPath(projectPath) : '~',
      ...(projectPath ? { projectPath } : {}),
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

  const openTask = (taskId: string) => {
    setSelectedTaskId(taskId)
    setView('workspace')
  }

  // The workspace with nothing picked yet opens on the first running card.
  const selectView = (next: BoardView) => {
    if (next === 'workspace' && !selectedTaskId && board.in_progress[0]) {
      setSelectedTaskId(board.in_progress[0].id)
    }
    setView(next)
  }

  // Stage notifications. Core already applied the per-kind switches; whether
  // the user is looking at the card is a UI fact, so that check lives here.
  const openTaskRef = useRef(openTask)
  openTaskRef.current = openTask
  const selectedRef = useRef(selectedTaskId)
  selectedRef.current = selectedTaskId
  const viewRef = useRef(view)
  viewRef.current = view
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
      const watching = document.visibilityState === 'visible' && document.hasFocus() &&
        viewRef.current === 'workspace' && selectedRef.current === taskId
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
            openTaskRef.current(taskId)
            n.close()
          }
        }
      }
    })
  }, [])

  const openNewTaskSheet = (initial: NewTaskInitial | null) => {
    setCreateError(null)
    setNewTaskInitial(initial)
    setNewTaskOpen(true)
  }
  const handleOpenNewTask = () => openNewTaskSheet(null)

  const handleConvertGithubItem = (item: GithubItem, projectPath?: string) => {
    openNewTaskSheet({ ...draftFromItem(item), ...(projectPath ? { projectPath } : {}) })
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

  const handleCreateTask = async (draft: NewTaskDraft) => {
    setCreating(true)
    setCreateError(null)
    try {
      const result = await createTask({
        ...draft,
        branch: draft.branch || undefined,
        model: draft.model || undefined,
      })
      if (result) {
        setBoard(result.state.board)
        setNewTaskOpen(false)
        // A card made from the inbox keeps the user on the inbox.
        if (!newTaskInitial) openTask(result.task.id)
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  const handleOpenEditTask = (taskId: string) => {
    setEditError(null)
    setEditTask(findTask(board, taskId))
  }

  // The sheet keeps the snapshot it opened with so a board push does not wipe
  // unsaved edits; its column follows the board, so a card started meanwhile
  // turns read-only, and a deleted one closes it.
  const editColumn = editTask ? columnOf(board, editTask.id) : null
  useEffect(() => {
    if (editTask && !editColumn) setEditTask(null)
  }, [editTask, editColumn])

  const saveEdit = async (payload: EditTaskPayload): Promise<boolean> => {
    if (!editTask) return false
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
        masterId: payload.masterId,
      })
      if (state) setBoard(state.board)
      return true
    } catch (err) {
      setEditError(err instanceof Error ? err.message : String(err))
      return false
    } finally {
      setSavingEdit(false)
    }
  }

  const handleSaveEdit = async (payload: EditTaskPayload) => {
    if (await saveEdit(payload)) setEditTask(null)
  }

  const handleStartFromSheet = async (edits: EditTaskPayload | null) => {
    if (!editTask) return
    if (edits && !(await saveEdit(edits))) return
    setEditTask(null)
    setStartRequest(editTask.id)
  }

  const handleTaskDone = async (taskId: string) => {
    const state = await cleanupTask(taskId)
    if (state) setBoard(state.board)
  }

  const handleDeleteTask = async (taskId: string) => {
    const state = await deleteTask(taskId)
    if (state) {
      setBoard(state.board)
      setSelectedTaskId((current) => (current === taskId ? null : current))
    }
  }

  // Remote control has no entry point for now: nothing calls startSharing, so
  // the host never registers with the public PeerJS broker. The dialog and the
  // host stay wired up so the feature can be handed back with one prop.
  const github = useGithubInbox(board, loaded)
  const jira = useJiraInbox(loaded, jiraScope)
  const taskLinks = useGithubTaskLinks(board, loaded)
  const allTasks = [...board.in_progress, ...board.backlog, ...board.done]
  const githubCards = boardGithubCards(allTasks)
  const jiraCards = boardJiraCards(allTasks)
  const currentInboxTab = inboxTab ?? (jira.inbox?.status === 'ok' ? 'jira' : 'issues')
  useEffect(() => {
    if (loaded) void listRecentProjects().then(setRecentProjects)
  }, [loaded, board.backlog.length])
  const createJiraTask = (ticket: JiraTicket) => openNewTaskSheet(draftFromTicket(ticket))


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
                onSelectView={selectView}
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
                  onSelectTask={openTask}
                  onOpenTaskSheet={handleOpenEditTask}
                  startRequest={startRequest}
                  onStartRequest={setStartRequest}
                  onNewTask={handleOpenNewTask}
                  board={board}
                  onBoardChange={handleBoardChange}
                  onEditTask={handleOpenEditTask}
                  onTaskDone={handleTaskDone}
                  onDeleteTask={handleDeleteTask}
                  onOpenTaskTerminal={openTaskGridTerminal}
                  taskTerminals={gridTerminals}
                  onShowTaskTerminal={showGridTerminal}
                  progress={progress}
                  selectedTaskId={selectedTaskId}
                  view={view}
                  onViewChange={selectView}
                  taskLinks={taskLinks.links}
                  githubView={
                    <InboxView
                      view={view}
                      onViewChange={selectView}
                      tab={currentInboxTab}
                      onTabChange={setInboxTab}
                      jira={{ ...jira, scope: jiraScope, onScopeChange: setJiraScope }}
                      github={{ ...github, refresh: () => { void github.refresh(); void taskLinks.refresh() } }}
                      githubFilters={githubFilters}
                      onGithubFiltersChange={(kind, filters) => setGithubFilters((previous) => ({ ...previous, [kind]: filters }))}
                      jiraCards={jiraCards}
                      githubCards={githubCards}
                      onCreateJira={createJiraTask}
                      onConvertGithub={handleConvertGithubItem}
                      onOpenTask={openTask}
                      onOpenSettings={() => {
                        setSettingsError(null)
                        setSettingsOpen(true)
                      }}
                      onNewTask={handleOpenNewTask}
                    />
                  }
                />
                </div>
                <div className={view === 'terminals' ? 'h-full' : 'hidden'}>
                  <TerminalGrid
                    view={view}
                    onViewChange={selectView}
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
                    onNewTask={handleOpenNewTask}
                  />
                </div>
                </div>
              </div>
            </div>
            <AnimatePresence>
              {newTaskOpen && (
                <NewTaskDialog
                  key="new-task-dialog"
                  initial={newTaskInitial ?? undefined}
                  creating={creating}
                  error={createError}
                  pickFolder={pickProjectFolder}
                  loadRecentProjects={listRecentProjects}
                  loadGitInfo={getGitInfo}
                  initRepository={initRepository}
                  detectAgents={detectAgents}
                  defaultAutoMode={autoMode}
                  workstationPath={workstationPath}
                  masters={[...board.in_progress, ...board.backlog]
                    .filter((t) => t.role === 'master')
                    .map((t) => ({ id: t.id, title: t.title }))}
                  onSubmit={handleCreateTask}
                  onClose={() => setNewTaskOpen(false)}
                />
              )}
            </AnimatePresence>
            <EditTaskDialog
              task={editTask}
              column={editColumn ?? 'backlog'}
              onDelete={() => {
                if (!editTask) return
                setEditTask(null)
                void handleDeleteTask(editTask.id)
              }}
              onOpenWorkspace={() => {
                if (!editTask) return
                setEditTask(null)
                openTask(editTask.id)
              }}
              defaultAutoMode={autoMode}
              detectAgents={detectAgents}
              pickFolder={pickProjectFolder}
              loadRecentProjects={listRecentProjects}
              loadGitInfo={getGitInfo}
              saving={savingEdit}
              error={editError}
              masters={[...board.in_progress, ...board.backlog]
                .filter((t) => t.role === 'master')
                .map((t) => ({ id: t.id, title: t.title }))}
              onSubmit={handleSaveEdit}
              onStart={(edits) => void handleStartFromSheet(edits)}
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
              onOpen={(taskId) => openTaskRef.current(taskId)}
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
