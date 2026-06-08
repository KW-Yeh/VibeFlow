import path from 'path'
import { randomUUID } from 'crypto'
import { app, dialog, ipcMain, type BrowserWindow } from 'electron'
import serve from 'electron-serve'
import { createWindow } from './helpers/create-window'
import {
  addRole,
  addTask,
  findTask,
  getState,
  removeRole,
  removeTask,
  setBoard,
  setSettings,
  updateRole,
  updateTask,
  DEFAULT_MAX_REVIEW_ROUNDS,
  type AppSettings,
  type BoardState,
  type PipelineRun,
  type Role,
  type Task,
} from './helpers/store'
import { detectAgents, type AgentCliId } from './helpers/agents'
import { generateBranchName } from './helpers/branch-name'
import {
  commitAndPush,
  deleteBranch,
  fallbackBranchName,
  getGitInfo,
  getWorktreeDiff,
  provisionWorktree,
  removeWorktree,
  syncBaseBranch,
} from './helpers/git'
import {
  killAllSessions,
  killSession,
  resizeSession,
  startSession,
  writeSession,
} from './helpers/pty'
import {
  unwatchAllProgress,
  unwatchProgress,
  watchProgress,
} from './helpers/progress'
import {
  relaunchApp,
  stopUpdateWatcher,
  watchForNewBuild,
} from './helpers/update'

const isProd = process.env.NODE_ENV === 'production'

if (isProd) {
  serve({ directory: 'app' })
} else {
  app.setPath('userData', `${app.getPath('userData')} (development)`)
}

/** Short, URL/branch-safe id derived from a UUID (tasks and roles share it). */
function generateShortId(): string {
  return randomUUID().slice(0, 8)
}

/** Tear down a task's live session: stop the PTY and the progress watcher
 *  (the watcher runs a final sync on its way out). */
function teardownSession(taskId: string): void {
  killSession(taskId)
  unwatchProgress(taskId)
}

function registerIpcHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle('vibeflow:getState', () => getState())

  // --- App self-update (local hot update) ---

  ipcMain.handle('app:getVersion', () => app.getVersion())

  // Restart into the build currently on disk (after rebuild.sh --install
  // replaced the bundle). app.relaunch re-executes the same .app path, so
  // the new code is picked up.
  ipcMain.handle('app:relaunch', () => {
    relaunchApp()
  })

  ipcMain.handle('vibeflow:setBoard', (_event, board: BoardState) => {
    setBoard(board)
    return getState()
  })

  ipcMain.handle(
    'vibeflow:setSettings',
    (_event, patch: Partial<AppSettings>) => {
      setSettings(patch)
      return getState()
    }
  )

  // Open a native folder picker and return the chosen path (no global state).
  ipcMain.handle('dialog:pickFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '選擇本地專案資料夾',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // Detect which agent CLIs (claude / codex / gemini) exist on PATH, so the
  // new-task dialog can offer only the agents actually installed.
  ipcMain.handle('env:detectAgents', () => detectAgents())

  // --- Git automation (Phase 2) ---

  // Inspect a specific folder (per-task project selection).
  ipcMain.handle('git:getInfo', async (_event, projectPath: string) => {
    return getGitInfo(projectPath || '')
  })

  // Create a task in the chosen project: provision an isolated worktree, persist.
  ipcMain.handle(
    'vibeflow:createTask',
    async (
      _event,
      payload: {
        title: string
        description?: string
        projectPath: string
        baseBranch: string | null
        agentCli?: AgentCliId
        roleId?: string
        reviewerRoleId?: string
      }
    ) => {
      if (!payload.projectPath) {
        throw new Error('尚未選擇專案資料夾')
      }
      const taskId = generateShortId()
      // Meaningful branch name from the card (Jira/eBug code, or an English
      // slug of the title); null falls back to the legacy vf-<id> naming.
      const preferredBranch = await generateBranchName(
        payload.title,
        payload.description
      )
      const result = await provisionWorktree(
        payload.projectPath,
        taskId,
        payload.baseBranch,
        preferredBranch
      )
      // A reviewer role turns the task into a pipeline: seed its review-loop
      // state so the orchestrator can drive executor → reviewer hand-offs.
      const pipeline: PipelineRun | undefined = payload.reviewerRoleId
        ? { stage: 'developing', round: 0, maxRounds: DEFAULT_MAX_REVIEW_ROUNDS }
        : undefined
      const task: Task = {
        id: taskId,
        title: payload.title.trim() || `Task ${taskId}`,
        description: payload.description?.trim() || undefined,
        branch: result.branch,
        projectPath: payload.projectPath,
        projectName: path.basename(payload.projectPath),
        worktreePath: result.worktreePath,
        baseBranch: result.baseBranch,
        pushed: result.pushed,
        agentCli: payload.agentCli ?? 'claude',
        roleId: payload.roleId || undefined,
        reviewerRoleId: payload.reviewerRoleId || undefined,
        pipeline,
      }
      addTask(task)
      return { state: getState(), task }
    }
  )

  ipcMain.handle('vibeflow:removeTask', async (_event, taskId: string) => {
    removeTask(taskId)
    return getState()
  })

  // Edit an existing card's user-facing fields (title / description). Git-bound
  // fields (branch, projectPath, worktreePath) are intentionally not editable.
  ipcMain.handle(
    'vibeflow:updateTask',
    async (
      _event,
      payload: {
        taskId: string
        title: string
        description?: string
        roleId?: string
        reviewerRoleId?: string
      }
    ) => {
      const reviewerRoleId = payload.reviewerRoleId || undefined
      const existing = findTask(payload.taskId)
      // Reconcile pipeline state with the (edited) reviewer assignment: adding a
      // reviewer seeds a fresh loop; removing it drops the pipeline. An existing
      // in-flight pipeline is preserved when the reviewer is unchanged.
      let pipeline: PipelineRun | undefined = existing?.pipeline
      if (!reviewerRoleId) {
        pipeline = undefined
      } else if (!pipeline) {
        pipeline = { stage: 'developing', round: 0, maxRounds: DEFAULT_MAX_REVIEW_ROUNDS }
      }
      updateTask(payload.taskId, {
        title: payload.title.trim() || `Task ${payload.taskId}`,
        description: payload.description?.trim() || undefined,
        roleId: payload.roleId || undefined,
        reviewerRoleId,
        pipeline,
      })
      return getState()
    }
  )

  // --- Roles ---

  ipcMain.handle('roles:create', (_event, input: Omit<Role, 'id'>) => {
    const role: Role = { ...input, id: generateShortId() }
    addRole(role)
    return { state: getState(), role }
  })

  ipcMain.handle(
    'roles:update',
    (_event, payload: { roleId: string; patch: Partial<Role> }) => {
      updateRole(payload.roleId, payload.patch)
      return getState()
    }
  )

  ipcMain.handle('roles:remove', (_event, roleId: string) => {
    removeRole(roleId)
    return getState()
  })

  // --- Interactive terminal / PTY (Phase 3) ---

  ipcMain.handle(
    'pty:start',
    (
      event,
      payload: { taskId: string; cwd: string; command?: string }
    ) => {
      const result = startSession(
        payload.taskId,
        payload.cwd,
        event.sender,
        payload.command,
        // Session ended (natural exit included) — nothing can write the
        // progress file anymore, so stop polling (final sync inside).
        () => unwatchProgress(payload.taskId)
      )
      // Mirror the agent-maintained progress file into the store (persisted)
      // and push live updates to the renderer while the session is alive.
      watchProgress(payload.taskId, payload.cwd, (progress) => {
        updateTask(payload.taskId, { progress })
        if (!event.sender.isDestroyed()) {
          event.sender.send('progress:update', {
            taskId: payload.taskId,
            progress,
          })
        }
      })
      return result
    }
  )

  ipcMain.on(
    'pty:input',
    (_event, payload: { taskId: string; data: string }) => {
      writeSession(payload.taskId, payload.data)
    }
  )

  ipcMain.on(
    'pty:resize',
    (_event, payload: { taskId: string; cols: number; rows: number }) => {
      resizeSession(payload.taskId, payload.cols, payload.rows)
    }
  )

  ipcMain.on('pty:kill', (_event, taskId: string) => {
    teardownSession(taskId)
  })

  // --- Review & finalize (Phase 4) ---

  ipcMain.handle('git:getDiff', async (_event, taskId: string) => {
    const task = findTask(taskId)
    if (!task?.worktreePath) return []
    return getWorktreeDiff(task.worktreePath, task.baseBranch ?? 'HEAD')
  })

  // Approve: commit everything in the worktree and push the branch upstream.
  ipcMain.handle(
    'git:approve',
    async (_event, payload: { taskId: string; message: string }) => {
      const task = findTask(payload.taskId)
      if (!task?.worktreePath) {
        throw new Error('找不到此任務的 worktree')
      }
      const result = await commitAndPush(task.worktreePath, payload.message)
      if (result.pushed) updateTask(payload.taskId, { pushed: true })
      return { result, state: getState() }
    }
  )

  // Cleanup: finalize a card moved to Done. Tear down the PTY, remove the
  // worktree, delete the local branch, then bring the main working tree back to
  // the task's base branch and fast-forward it. Git sync steps are best-effort.
  ipcMain.handle('vibeflow:cleanupTask', async (_event, taskId: string) => {
    const task = findTask(taskId)
    teardownSession(taskId)
    if (task?.projectPath) {
      const branch = task.branch || fallbackBranchName(taskId)
      await removeWorktree(task.projectPath, branch)
      await deleteBranch(task.projectPath, branch)
      await syncBaseBranch(task.projectPath, task.baseBranch ?? 'main')
    }
    updateTask(taskId, { worktreePath: undefined })
    return getState()
  })

  // Delete: cleanup (PTY + worktree) AND drop the card from the board.
  ipcMain.handle('vibeflow:deleteTask', async (_event, taskId: string) => {
    const task = findTask(taskId)
    teardownSession(taskId)
    if (task?.projectPath) {
      const branch = task.branch || fallbackBranchName(taskId)
      await removeWorktree(task.projectPath, branch)
      await deleteBranch(task.projectPath, branch)
    }
    removeTask(taskId)
    return getState()
  })
}

;(async () => {
  await app.whenReady()

  const mainWindow = createWindow('main', {
    width: 1000,
    height: 600,
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.js'),
    },
  })

  registerIpcHandlers(mainWindow)

  // Notify the renderer when a newer build replaces the running bundle
  // (e.g. `./rebuild.sh --install`), so it can offer a one-click restart.
  watchForNewBuild(() => {
    if (!mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('update:available')
    }
  })

  if (isProd) {
    await mainWindow.loadURL('app://./home')
  } else {
    const port = process.argv[2]
    await mainWindow.loadURL(`http://localhost:${port}/home`)
    mainWindow.webContents.openDevTools()
  }
})()

app.on('window-all-closed', () => {
  killAllSessions()
  unwatchAllProgress()
  app.quit()
})

app.on('before-quit', () => {
  killAllSessions()
  unwatchAllProgress()
  stopUpdateWatcher()
})

ipcMain.on('message', async (event, arg) => {
  event.reply('message', `${arg} World!`)
})
