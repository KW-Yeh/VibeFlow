import path from 'path'
import { randomUUID } from 'crypto'
import { app, dialog, ipcMain, type BrowserWindow } from 'electron'
import serve from 'electron-serve'
import { createWindow } from './helpers/create-window'
import {
  addTask,
  findTask,
  getState,
  removeTask,
  setBoard,
  setSettings,
  updateTask,
  type AppSettings,
  type BoardState,
  type Task,
} from './helpers/store'
import {
  commitAndPush,
  getGitInfo,
  getWorktreeDiff,
  provisionWorktree,
  removeWorktree,
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

const isProd = process.env.NODE_ENV === 'production'

if (isProd) {
  serve({ directory: 'app' })
} else {
  app.setPath('userData', `${app.getPath('userData')} (development)`)
}

function registerIpcHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle('vibeflow:getState', () => getState())

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
      }
    ) => {
      if (!payload.projectPath) {
        throw new Error('尚未選擇專案資料夾')
      }
      const taskId = randomUUID().slice(0, 8)
      const result = await provisionWorktree(
        payload.projectPath,
        taskId,
        payload.baseBranch
      )
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
      payload: { taskId: string; title: string; description?: string }
    ) => {
      updateTask(payload.taskId, {
        title: payload.title.trim() || `Task ${payload.taskId}`,
        description: payload.description?.trim() || undefined,
      })
      return getState()
    }
  )

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
    killSession(taskId)
    unwatchProgress(taskId)
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

  // Cleanup: tear down the PTY and remove the worktree (e.g. when card → Done).
  ipcMain.handle('vibeflow:cleanupTask', async (_event, taskId: string) => {
    const task = findTask(taskId)
    killSession(taskId)
    unwatchProgress(taskId)
    if (task?.projectPath) {
      await removeWorktree(task.projectPath, taskId)
    }
    updateTask(taskId, { worktreePath: undefined })
    return getState()
  })

  // Delete: cleanup (PTY + worktree) AND drop the card from the board.
  ipcMain.handle('vibeflow:deleteTask', async (_event, taskId: string) => {
    const task = findTask(taskId)
    killSession(taskId)
    unwatchProgress(taskId)
    if (task?.projectPath) {
      await removeWorktree(task.projectPath, taskId)
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
})

ipcMain.on('message', async (event, arg) => {
  event.reply('message', `${arg} World!`)
})
