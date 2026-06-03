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
  updateTask,
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
      payload: { title: string; projectPath: string; baseBranch: string | null }
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

  // --- Interactive terminal / PTY (Phase 3) ---

  ipcMain.handle(
    'pty:start',
    (
      event,
      payload: { taskId: string; cwd: string; command?: string }
    ) => startSession(payload.taskId, payload.cwd, event.sender, payload.command)
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
  app.quit()
})

app.on('before-quit', () => {
  killAllSessions()
})

ipcMain.on('message', async (event, arg) => {
  event.reply('message', `${arg} World!`)
})
