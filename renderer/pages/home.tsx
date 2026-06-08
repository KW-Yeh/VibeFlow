import React, { useEffect, useState } from 'react'
import Head from 'next/head'

import { KanbanBoard } from '@/components/kanban-board'
import { NewTaskDialog } from '@/components/new-task-dialog'
import { EditTaskDialog } from '@/components/edit-task-dialog'
import { ReviewDialog } from '@/components/review-dialog'
import { SettingsDialog } from '@/components/settings-dialog'
import { RolesDialog } from '@/components/roles-dialog'
import {
  approve,
  cleanupTask,
  createRole,
  createTask,
  deleteTask,
  detectAgents,
  getDiff,
  getGitInfo,
  loadState,
  onProgressUpdate,
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
import type { AgentCliId, BoardState, DiffFile, Role, Task } from '@/lib/types'

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

  const [dialogOpen, setDialogOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Edit dialog state
  const [editTask, setEditTask] = useState<Task | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // Review dialog state
  const [reviewTaskId, setReviewTaskId] = useState<string | null>(null)
  const [reviewTitle, setReviewTitle] = useState('')
  const [reviewFiles, setReviewFiles] = useState<DiffFile[]>([])
  const [reviewLoading, setReviewLoading] = useState(false)
  const [finalizing, setFinalizing] = useState(false)
  const [reviewResult, setReviewResult] = useState<{
    committed: boolean
    pushed: boolean
  } | null>(null)
  const [reviewError, setReviewError] = useState<string | null>(null)

  // A newer build has replaced the running bundle (rebuild.sh --install);
  // offer a one-click restart instead of requiring a manual quit + reopen.
  const [updateReady, setUpdateReady] = useState(false)
  const [relaunching, setRelaunching] = useState(false)

  useEffect(() => {
    let active = true
    loadState().then((state) => {
      if (!active) return
      if (state) {
        setBoard(state.board)
        setAutoMode(state.settings.autoMode)
        setSystemPrompt(state.settings.systemPrompt ?? '')
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

  useEffect(() => {
    return onUpdateAvailable(() => setUpdateReady(true))
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
    setDialogOpen(true)
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
    agentCli: AgentCliId,
    roleId: string
  ) => {
    setCreating(true)
    setCreateError(null)
    try {
      const result = await createTask({
        title,
        description,
        projectPath,
        baseBranch,
        agentCli,
        roleId: roleId || undefined,
      })
      if (result) {
        setBoard(result.state.board)
        setDialogOpen(false)
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

  const handleSaveEdit = async (
    title: string,
    description: string,
    roleId: string
  ) => {
    if (!editTask) return
    setSavingEdit(true)
    setEditError(null)
    try {
      const state = await updateTask({
        taskId: editTask.id,
        title,
        description,
        roleId: roleId || undefined,
      })
      if (state) setBoard(state.board)
      setEditTask(null)
    } catch (err) {
      setEditError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingEdit(false)
    }
  }

  const handleReview = async (taskId: string) => {
    const task = findTask(board, taskId)
    setReviewTaskId(taskId)
    setReviewTitle(task?.title ?? taskId)
    setReviewResult(null)
    setReviewError(null)
    setReviewFiles([])
    setReviewLoading(true)
    try {
      setReviewFiles(await getDiff(taskId))
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : String(err))
    } finally {
      setReviewLoading(false)
    }
  }

  const handleApprove = async (message: string) => {
    if (!reviewTaskId) return
    setFinalizing(true)
    setReviewError(null)
    try {
      const res = await approve(reviewTaskId, message)
      if (res) {
        setReviewResult(res.result)
        setBoard(res.state.board)
      }
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : String(err))
    } finally {
      setFinalizing(false)
    }
  }

  const handleTaskDone = async (taskId: string) => {
    const state = await cleanupTask(taskId)
    if (state) setBoard(state.board)
  }

  const handleDeleteTask = async (taskId: string) => {
    const state = await deleteTask(taskId)
    if (state) setBoard(state.board)
  }

  const handleOpenRoles = () => {
    setRoleError(null)
    setRolesOpen(true)
  }

  const handleCreateRole = async (input: Omit<Role, 'id'>) => {
    setSavingRole(true)
    setRoleError(null)
    try {
      const res = await createRole(input)
      if (res) setRoles(res.state.roles)
    } catch (err) {
      setRoleError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingRole(false)
    }
  }

  const handleUpdateRole = async (
    roleId: string,
    patch: Omit<Role, 'id'>
  ) => {
    setSavingRole(true)
    setRoleError(null)
    try {
      const state = await updateRole(roleId, patch)
      if (state) setRoles(state.roles)
    } catch (err) {
      setRoleError(err instanceof Error ? err.message : String(err))
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

  return (
    <React.Fragment>
      <Head>
        <title>VibeFlow</title>
      </Head>
      <div className="dark">
        {loaded ? (
          <>
            <KanbanBoard
              board={board}
              onBoardChange={handleBoardChange}
              onNewTask={handleOpenNewTask}
              onReview={handleReview}
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
            />
            <NewTaskDialog
              open={dialogOpen}
              creating={creating}
              error={createError}
              pickFolder={pickFolder}
              loadGitInfo={getGitInfo}
              detectAgents={detectAgents}
              roles={roles}
              onManageRoles={handleOpenRoles}
              onSubmit={handleCreateTask}
              onClose={() => setDialogOpen(false)}
            />
            <EditTaskDialog
              task={editTask}
              roles={roles}
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
            <ReviewDialog
              open={reviewTaskId !== null}
              taskTitle={reviewTitle}
              files={reviewFiles}
              loading={reviewLoading}
              finalizing={finalizing}
              result={reviewResult}
              error={reviewError}
              onApprove={handleApprove}
              onClose={() => setReviewTaskId(null)}
            />
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
