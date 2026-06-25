import React, { useEffect, useState } from 'react'
import Head from 'next/head'

import { KanbanBoard } from '@/components/kanban-board'
import { EditTaskDialog, type EditTaskPayload } from '@/components/edit-task-dialog'
import { SettingsDialog } from '@/components/settings-dialog'
import { RolesDialog } from '@/components/roles-dialog'
import { SideMenu } from '@/components/side-menu'
import { WorkspaceDialog } from '@/components/workspace-dialog'
import { RemoteShareDialog } from '@/components/remote-share-dialog'
import { useRemoteHost } from '@/hooks/use-remote-host'
import {
  cleanupTask,
  createRole,
  createTask,
  createWorkspace,
  deleteTask,
  detectAgents,
  getGitInfo,
  initRepository,
  loadState,
  onProgressUpdate,
  onStateChanged,
  onSubAgentsUpdate,
  onUpdateAvailable,
  persistBoard,
  pickFolder,
  relaunchApp,
  refreshWorkspaces,
  removeRole,
  removeWorkspace,
  setSettings,
  updateRole,
  updateTask,
  updateWorkspace,
} from '@/lib/api'
import { Button } from '@/components/ui/button'
import type {
  AgentCliId,
  BoardState,
  Role,
  SubAgentRun,
  Task,
  Workspace,
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
  const [board, setBoard] = useState<BoardState>(FALLBACK_BOARD)
  // Sub-agent runs are session-only (never persisted to the store), so they
  // live in their own state keyed by task id — kept out of `board` so a
  // persistBoard write can't leak them to disk.
  const [subAgents, setSubAgents] = useState<Record<string, SubAgentRun[]>>({})
  const [autoMode, setAutoMode] = useState(true)
  // Custom system prompt ('' = the built-in default is in effect).
  const [systemPrompt, setSystemPrompt] = useState('')
  const [loaded, setLoaded] = useState(false)

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

  // Workspaces + side menu state
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [sideMenuCollapsed, setSideMenuCollapsed] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [refreshingWorkspaces, setRefreshingWorkspaces] = useState(false)
  const [workspaceDialogOpen, setWorkspaceDialogOpen] = useState(false)
  const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(null)
  const [savingWorkspace, setSavingWorkspace] = useState(false)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    loadState().then((state) => {
      if (!active) return
      if (state) {
        setBoard(state.board)
        setAutoMode(state.settings.autoMode)
        setSystemPrompt(state.settings.systemPrompt ?? '')
        setRoles(state.roles ?? [])
        setWorkspaces(state.workspaces ?? [])
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

  // Refresh board when the CLI (or any external writer) changes the store file.
  useEffect(() => {
    return onStateChanged((state) => {
      setBoard(state.board)
      setAutoMode(state.settings.autoMode)
      setSystemPrompt(state.settings.systemPrompt ?? '')
      setRoles(state.roles ?? [])
      setWorkspaces(state.workspaces ?? [])
    })
  }, [])

  const handleRelaunch = () => {
    setRelaunching(true)
    void relaunchApp()
  }

  const handleBoardChange = (next: BoardState) => {
    setBoard(next)
    void persistBoard(next)
  }

  const handleOpenNewTask = () => {
    setCreateError(null)
    setSelectedTaskId(null)
  }

  const handleToggleAutoMode = () => {
    const next = !autoMode
    setAutoMode(next) // optimistic; persisted below
    void setSettings({ autoMode: next })
  }

  const handleSaveSettings = async (nextPrompt: string) => {
    setSavingSettings(true)
    setSettingsError(null)
    try {
      await setSettings({ systemPrompt: nextPrompt })
      setSystemPrompt(nextPrompt)
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
    mode: 'existing' | 'new',
    agentCli: AgentCliId,
    model: string,
    executionAgentCli: AgentCliId,
    executionModel: string,
    roleId: string,
    reviewerRoleId: string,
    workspaceId: string
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
        workspaceId: workspaceId || undefined,
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
        workspaceId: payload.workspaceId || undefined,
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

  const handleAddWorkspace = () => {
    setEditingWorkspace(null)
    setWorkspaceError(null)
    setWorkspaceDialogOpen(true)
  }

  const handleEditWorkspace = (ws: Workspace) => {
    setEditingWorkspace(ws)
    setWorkspaceError(null)
    setWorkspaceDialogOpen(true)
  }

  const handleRefreshWorkspaces = async () => {
    setRefreshingWorkspaces(true)
    try {
      const state = await refreshWorkspaces()
      if (state) setWorkspaces(state.workspaces ?? [])
    } finally {
      setRefreshingWorkspaces(false)
    }
  }

  const handleSaveWorkspace = async (name: string, path: string) => {
    setSavingWorkspace(true)
    setWorkspaceError(null)
    try {
      if (editingWorkspace) {
        const state = await updateWorkspace(editingWorkspace.id, { name, path })
        if (state) setWorkspaces(state.workspaces ?? [])
      } else {
        const res = await createWorkspace({ name, path })
        if (res) setWorkspaces(res.state.workspaces ?? [])
      }
      setWorkspaceDialogOpen(false)
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingWorkspace(false)
    }
  }

  const handleDeleteWorkspace = async () => {
    if (!editingWorkspace) return
    setSavingWorkspace(true)
    setWorkspaceError(null)
    try {
      const state = await removeWorkspace(editingWorkspace.id)
      if (state) setWorkspaces(state.workspaces ?? [])
      setWorkspaceDialogOpen(false)
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingWorkspace(false)
    }
  }

  const remoteHost = useRemoteHost({
    board,
    workspaces,
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
      <div className="dark">
        {loaded ? (
          <>
            <div className="flex h-screen overflow-hidden">
              <SideMenu
                collapsed={sideMenuCollapsed}
                onToggleCollapse={() => setSideMenuCollapsed((v) => !v)}
                board={board}
                workspaces={workspaces}
                selectedTaskId={selectedTaskId}
                onSelectTask={setSelectedTaskId}
                onNewTask={handleOpenNewTask}
                onAddWorkspace={handleAddWorkspace}
                onEditWorkspace={handleEditWorkspace}
                onRefreshWorkspaces={handleRefreshWorkspaces}
                refreshing={refreshingWorkspaces}
              />
              <div className="flex flex-1 flex-col overflow-hidden">
                <KanbanBoard
                  board={board}
                  onBoardChange={handleBoardChange}
                  onNewTask={handleOpenNewTask}
                  onEditTask={handleOpenEditTask}
                  onTaskDone={handleTaskDone}
                  onDeleteTask={handleDeleteTask}
                  autoMode={autoMode}
                  onToggleAutoMode={handleToggleAutoMode}
                  systemPrompt={systemPrompt}
                  onOpenSettings={() => {
                    setSettingsError(null)
                    setSettingsOpen(true)
                  }}
                  roles={roles}
                  onManageRoles={handleOpenRoles}
                  onRemoteShare={() => {
                    if (!remoteHost.roomCode) remoteHost.startSharing()
                    setRemoteShareOpen(true)
                  }}
                  remoteActive={!!remoteHost.roomCode}
                  subAgents={subAgents}
                  selectedTaskId={selectedTaskId}
                  onDeselectTask={() => setSelectedTaskId(null)}
                  workspaces={workspaces}
                  creating={creating}
                  createError={createError}
                  pickFolder={pickFolder}
                  loadGitInfo={getGitInfo}
                  initRepository={initRepository}
                  detectAgents={detectAgents}
                  onCreateTask={handleCreateTask}
                />
              </div>
            </div>
            <EditTaskDialog
              task={editTask}
              roles={roles}
              workspaces={workspaces}
              detectAgents={detectAgents}
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
              saving={savingSettings}
              error={settingsError}
              onSave={handleSaveSettings}
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
            <WorkspaceDialog
              open={workspaceDialogOpen}
              workspace={editingWorkspace}
              pickFolder={pickFolder}
              saving={savingWorkspace}
              error={workspaceError}
              onSubmit={handleSaveWorkspace}
              onDelete={editingWorkspace ? handleDeleteWorkspace : undefined}
              onClose={() => setWorkspaceDialogOpen(false)}
            />
            {remoteShareOpen && remoteHost.roomCode && (
              <RemoteShareDialog
                roomCode={remoteHost.roomCode}
                peerCount={remoteHost.peerCount}
                onClose={() => setRemoteShareOpen(false)}
                onStop={() => {
                  remoteHost.stopSharing()
                  setRemoteShareOpen(false)
                }}
              />
            )}
            {updateReady && (
              <div
                role="status"
                className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-full border border-border/40 bg-card py-2 pl-4 pr-2 text-sm shadow-lg"
              >
                <span className="text-foreground">
                  新版本已建置完成
                  <span className="ml-1.5 text-muted-foreground">
                    重新啟動以套用
                  </span>
                </span>
                <Button
                  size="sm"
                  className="rounded-full active:scale-95"
                  disabled={relaunching}
                  onClick={handleRelaunch}
                >
                  {relaunching ? '重新啟動中…' : '立即重啟'}
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
            載入中…
          </div>
        )}
      </div>
    </React.Fragment>
  )
}
