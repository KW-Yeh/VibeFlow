import path from 'path'
import { randomUUID } from 'crypto'
import { app, dialog, ipcMain, type BrowserWindow } from 'electron'
import serve from 'electron-serve'
import { createWindow } from './helpers/create-window'
import {
  addTask,
  findTask,
  getProjectPath,
  getState,
  removeTask,
  setBoard,
  setProjectPath,
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

  ipcMain.handle(
    'vibeflow:setProjectPath',
    (_event, projectPath: string | null) => {
      setProjectPath(projectPath)
      return getState()
    }
  )

  // Open a native folder picker and persist the chosen project path.
  ipcMain.handle('vibeflow:selectProject', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '選擇本地專案資料夾',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return getState()
    }
    setProjectPath(result.filePaths[0])
    return getState()
  })

  // --- Git automation (Phase 2) ---

  ipcMain.handle('git:getInfo', async () => {
    const projectPath = getProjectPath()
    if (!projectPath) return getGitInfo('')
    return getGitInfo(projectPath)
  })

  // Create a task: provision an isolated worktree + branch, then persist it.
  ipcMain.handle(
    'vibeflow:createTask',
    async (_event, payload: { title: string; baseBranch: string | null }) => {
      const projectPath = getProjectPath()
      if (!projectPath) {
        throw new Error('尚未選擇專案資料夾')
      }
      const taskId = randomUUID().slice(0, 8)
      const result = await provisionWorktree(
        projectPath,
        taskId,
        payload.baseBranch
      )
      const task: Task = {
        id: taskId,
        title: payload.title.trim() || `Task ${taskId}`,
        branch: result.branch,
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
    const projectPath = getProjectPath()
    killSession(taskId)
    if (projectPath) {
      await removeWorktree(projectPath, taskId)
    }
    updateTask(taskId, { worktreePath: undefined })
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
