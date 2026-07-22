import React, { useEffect, useState } from 'react'
import Head from 'next/head'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

import { KanbanBoard } from '@/components/kanban-board'
import { EditTaskDialog, type EditTaskPayload } from '@/components/edit-task-dialog'
import { SettingsDialog } from '@/components/settings-dialog'
import { RolesDialog } from '@/components/roles-dialog'
import { SideMenu } from '@/components/side-menu'
import { RemoteShareDialog } from '@/components/remote-share-dialog'
import { DialogShell } from '@/components/ui/dialog-shell'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { useRemoteHost } from '@/hooks/use-remote-host'
import {
  cleanupTask,
  checkForRemoteUpdate,
  connectAgent,
  refreshAgentModels,
  createRole,
  createTask,
  deleteTask,
  detectAgents,
  downloadRemoteUpdate,
  getGitInfo,
  getRemoteUpdateState,
  initRepository,
  installRemoteUpdate,
  loadState,
  onProgressUpdate,
  onRemoteUpdateState,
  onStateChanged,
  onSubAgentsUpdate,
  onUpdateAvailable,
  persistBoard,
  pickFolder,
  relaunchApp,
  removeRole,
  setSettings,
  updateRole,
  updateTask,
} from '@/lib/api'
import { Button } from '@/components/ui/button'
import { createEnterVariants } from '@/lib/motion'
import type {
  AgentCliId,
  AgentConnections,
  AttachmentInput,
  BoardState,
  ConnectableAgentId,
  Role,
  RemoteUpdateSnapshot,
  SubAgentRun,
  Task,
} from '@/lib/types'

// Rendered until the persisted state loads, and as a fallback when the
// Electron bridge is unavailable (plain browser / static export preview).
const FALLBACK_BOARD: BoardState = {
  backlog: [],
  in_progress: [],
  done: [],
}

function findTask(board: BoardState, taskId: string): Task | null {
  for (const column of Object.values(board)) {
    const found = column.find((t) => t.id === taskId)
    if (found) return found
  }
  return null
}

export default function HomePage() {
  const reducedMotion = useReducedMotion() ?? false
  const [board, setBoard] = useState<BoardState>(FALLBACK_BOARD)
  // Sub-agent runs are session-only (never persisted to the store), so they
  // live in their own state keyed by task id — kept out of `board` so a
  // persistBoard write can't leak them to disk.
  const [subAgents, setSubAgents] = useState<Record<string, SubAgentRun[]>>({})
  const [autoMode, setAutoMode] = useState(true)
  // Custom system prompt ('' = the built-in default is in effect).
  const [systemPrompt, setSystemPrompt] = useState('')
  // Global workstation path ('' = the ~/Desktop default is in effect).
  const [workstationPath, setWorkstationPath] = useState('')
  const [agentConnections, setAgentConnections] = useState<AgentConnections>({})
  const [loaded, setLoaded] = useState(false)
  const [remoteUpdate, setRemoteUpdate] = useState<RemoteUpdateSnapshot | null>(null)

  // Settings dialog state
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)

  // Roles state + dialog
  const [roles, setRoles] = useState<Role[]>([])
  const [rolesOpen, setRolesOpen] = useState(false)
  const [savingRole, setSavingRole] = useState(false)
  const [roleError, setRoleError] = useState<string | null>(null)

  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Edit dialog state
  const [editTask, setEditTask] = useState<Task | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // A newer build has replaced the running bundle (rebuild.sh --install);
  // offer a one-click restart instead of requiring a manual quit + reopen.
  const [updateReady, setUpdateReady] = useState(false)
  const [relaunching, setRelaunching] = useState(false)

  // Remote share state
  const [remoteShareOpen, setRemoteShareOpen] = useState(false)

  // Side menu state
  const [sideMenuCollapsed, setSideMenuCollapsed] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
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
        setAgentConnections(state.settings.agentConnections ?? {})
        setRoles(state.roles ?? [])
      }
      setLoaded(true)
    })
    return () => {
      active = false
    }
  }, [])

  // Mirror live progress updates (pushed from main while sessions run) into
  // the local board copy. Main already persisted them — no persistBoard here.
  useEffect(() => {
    return onProgressUpdate(({ taskId, progress }) => {
      setBoard((prev) => ({
        backlog: prev.backlog.map((t) =>
          t.id === taskId ? { ...t, progress } : t
        ),
        in_progress: prev.in_progress.map((t) =>
          t.id === taskId ? { ...t, progress } : t
        ),
        done: prev.done.map((t) => (t.id === taskId ? { ...t, progress } : t)),
      }))
    })
  }, [])

  // Live sub-agent updates pushed from main while sessions run. Kept in a
  // dedicated state map (not merged into `board`) so they stay session-only.
  useEffect(() => {
    return onSubAgentsUpdate(({ taskId, subAgents: runs }) => {
      setSubAgents((prev) => ({ ...prev, [taskId]: runs }))
    })
  }, [])

  useEffect(() => {
    return onUpdateAvailable(() => setUpdateReady(true))
  }, [])

  useEffect(() => {
    let active = true
    void getRemoteUpdateState().then((state) => {
      if (active && state) setRemoteUpdate(state)
    })
    const unsubscribe = onRemoteUpdateState((state) => setRemoteUpdate(state))
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  // Refresh board when the CLI (or any external writer) changes the store file.
  useEffect(() => {
    return onStateChanged((state) => {
      setBoard(state.board)
      setAutoMode(state.settings.autoMode)
      setSystemPrompt(state.settings.systemPrompt ?? '')
      setWorkstationPath(state.settings.workstationPath ?? '')
      setAgentConnections(state.settings.agentConnections ?? {})
      setRoles(state.roles ?? [])
    })
  }, [])

  const handleRelaunch = () => {
    setRelaunching(true)
    void relaunchApp()
  }

  const handleCheckForRemoteUpdate = () => {
    void checkForRemoteUpdate().then((state) => {
      if (state) setRemoteUpdate(state)
    })
  }

  const handleDownloadRemoteUpdate = () => {
    void downloadRemoteUpdate().then((state) => {
      if (state) setRemoteUpdate(state)
    })
  }

  const handleInstallRemoteUpdate = () => {
    void installRemoteUpdate()
  }

  const handleBoardChange = (next: BoardState) => {
    setBoard(next)
    void persistBoard(next)
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

  const handleToggleAutoMode = () => {
    const next = !autoMode
    setAutoMode(next) // optimistic; persisted below
    void setSettings({ autoMode: next })
  }

  const handleSaveSettings = async (nextPrompt: string, nextWorkstation: string) => {
    setSavingSettings(true)
    setSettingsError(null)
    try {
      await setSettings({
        systemPrompt: nextPrompt,
        workstationPath: nextWorkstation || undefined,
      })
      setSystemPrompt(nextPrompt)
      setWorkstationPath(nextWorkstation)
      setSettingsOpen(false)
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingSettings(false)
    }
  }

  const handleConnectAgent = async (
    agentId: ConnectableAgentId,
    apiKey: string
  ): Promise<string | null> => {
    setSavingSettings(true)
    setSettingsError(null)
    try {
      const state = await connectAgent(agentId, apiKey)
      if (state) {
        setAgentConnections(state.settings.agentConnections ?? {})
      }
      return null
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setSettingsError(message)
      return message
    } finally {
      setSavingSettings(false)
    }
  }

  const handleRefreshAgentModels = async (agentId: ConnectableAgentId): Promise<void> => {
    const state = await refreshAgentModels(agentId)
    if (state) setAgentConnections(state.settings.agentConnections ?? {})
  }

  const handleCreateTask = async (
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
  ) => {
    setCreating(true)
    setCreateError(null)
    try {
      const result = await createTask({
        title,
        description,
        projectPath,
        baseBranch,
        mode,
        agentCli,
        model: model || undefined,
        executionAgentCli,
        executionModel: executionModel || undefined,
        roleId: roleId || undefined,
        reviewerRoleId: reviewerRoleId || undefined,
        attachments,
      })
      if (result) {
        setBoard(result.state.board)
        setSelectedTaskId(result.task.id)
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

  const handleSaveEdit = async (payload: EditTaskPayload) => {
    if (!editTask) return
    setSavingEdit(true)
    setEditError(null)
    try {
      const state = await updateTask({
        taskId: editTask.id,
        title: payload.title,
        description: payload.description,
        roleId: payload.roleId || undefined,
        reviewerRoleId: payload.reviewerRoleId || undefined,
        agentCli: payload.agentCli,
        model: payload.model || undefined,
        executionAgentCli: payload.executionAgentCli,
        executionModel: payload.executionModel || undefined,
        projectPath: payload.projectPath,
        baseBranch: payload.baseBranch,
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
      if (taskId === selectedTaskId) setSelectedTaskId(null)
    }
  }

  const handleOpenRoles = () => {
    setRoleError(null)
    setRolesOpen(true)
  }

  const roleNameTaken = (name: string, excludeId?: string) => {
    const target = name.trim().toLowerCase()
    return roles.some(
      (r) => r.id !== excludeId && r.name.trim().toLowerCase() === target
    )
  }

  const handleCreateRole = async (
    input: Omit<Role, 'id'>
  ): Promise<boolean> => {
    if (roleNameTaken(input.name)) {
      setRoleError(`已存在名稱為「${input.name.trim()}」的角色`)
      return false
    }
    setSavingRole(true)
    setRoleError(null)
    try {
      const res = await createRole(input)
      if (res) setRoles(res.state.roles)
      return true
    } catch (err) {
      setRoleError(err instanceof Error ? err.message : String(err))
      return false
    } finally {
      setSavingRole(false)
    }
  }

  const handleUpdateRole = async (
    roleId: string,
    patch: Omit<Role, 'id'>
  ): Promise<boolean> => {
    if (roleNameTaken(patch.name, roleId)) {
      setRoleError(`已存在名稱為「${patch.name.trim()}」的角色`)
      return false
    }
    setSavingRole(true)
    setRoleError(null)
    try {
      const state = await updateRole(roleId, patch)
      if (state) setRoles(state.roles)
      return true
    } catch (err) {
      setRoleError(err instanceof Error ? err.message : String(err))
      return false
    } finally {
      setSavingRole(false)
    }
  }

  const handleDeleteRole = async (roleId: string) => {
    setSavingRole(true)
    setRoleError(null)
    try {
      const state = await removeRole(roleId)
      if (state) setRoles(state.roles)
    } catch (err) {
      setRoleError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingRole(false)
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
      if (selectedTaskId && deleteProjectTarget.taskIds.includes(selectedTaskId)) {
        setSelectedTaskId(null)
      }
      setDeleteProjectTarget(null)
    } finally {
      setDeletingProject(false)
    }
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
                collapsed={sideMenuCollapsed}
                onToggleCollapse={() => setSideMenuCollapsed((v) => !v)}
                board={board}
                selectedTaskId={selectedTaskId}
                onSelectTask={setSelectedTaskId}
                onNewTask={handleOpenNewTask}
                onNewTaskForProject={handleNewTaskForProject}
                onDeleteProject={handleDeleteProject}
                autoMode={autoMode}
                onToggleAutoMode={handleToggleAutoMode}
                onManageRoles={handleOpenRoles}
                onRemoteShare={() => {
                  if (!remoteHost.roomCode) remoteHost.startSharing()
                  setRemoteShareOpen(true)
                }}
                remoteActive={!!remoteHost.roomCode}
                onOpenSettings={() => {
                  setSettingsError(null)
                  setSettingsOpen(true)
                }}
                remoteUpdate={remoteUpdate}
                onCheckForUpdate={handleCheckForRemoteUpdate}
                onDownloadUpdate={handleDownloadRemoteUpdate}
                onInstallUpdate={handleInstallRemoteUpdate}
              />
              <div className="flex flex-1 flex-col overflow-hidden">
                <KanbanBoard
                  board={board}
                  onBoardChange={handleBoardChange}
                  onEditTask={handleOpenEditTask}
                  onTaskDone={handleTaskDone}
                  onDeleteTask={handleDeleteTask}
                  autoMode={autoMode}
                  systemPrompt={systemPrompt}
                  roles={roles}
                  onManageRoles={handleOpenRoles}
                  subAgents={subAgents}
                  selectedTaskId={selectedTaskId}
                  initialProjectPath={newTaskInitialProject}
                  newTaskNonce={newTaskNonce}
                  creating={creating}
                  createError={createError}
                  pickFolder={pickFolder}
                  loadGitInfo={getGitInfo}
                  initRepository={initRepository}
                  detectAgents={detectAgents}
                  agentConnections={agentConnections}
                  onCreateTask={handleCreateTask}
                />
              </div>
            </div>
            <EditTaskDialog
              task={editTask}
              roles={roles}
              detectAgents={detectAgents}
              agentConnections={agentConnections}
              pickFolder={pickFolder}
              loadGitInfo={getGitInfo}
              onManageRoles={handleOpenRoles}
              saving={savingEdit}
              error={editError}
              onSubmit={handleSaveEdit}
              onClose={() => setEditTask(null)}
            />
            <SettingsDialog
              open={settingsOpen}
              systemPrompt={systemPrompt}
              workstationPath={workstationPath}
              agentConnections={agentConnections}
              saving={savingSettings}
              error={settingsError}
              onSave={handleSaveSettings}
              onConnectAgent={handleConnectAgent}
              onRefreshModels={handleRefreshAgentModels}
              onPickFolder={pickFolder}
              onClose={() => setSettingsOpen(false)}
            />
            <RolesDialog
              open={rolesOpen}
              roles={roles}
              saving={savingRole}
              error={roleError}
              onCreate={handleCreateRole}
              onUpdate={handleUpdateRole}
              onDelete={handleDeleteRole}
              onClose={() => setRolesOpen(false)}
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
            {updateReady && (
              <motion.div
                role="status"
                initial="hidden"
                animate="visible"
                variants={createEnterVariants({
                  timing: 'standard',
                  transform: { y: 8 },
                  reducedMotion,
                })}
                className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-full border border-border/40 bg-card py-2 pl-4 pr-2 text-base shadow-lg"
              >
                <span className="text-foreground">
                  新版本已建置完成
                  <span className="ml-1.5 text-muted-foreground">
                    重新啟動以套用
                  </span>
                </span>
                <Button
                  size="sm"
                  className="rounded-full active:scale-95 motion-reduce:transform-none"
                  disabled={relaunching}
                  onClick={handleRelaunch}
                >
                  {relaunching ? '重新啟動中…' : '立即重啟'}
                </Button>
              </motion.div>
            )}
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
