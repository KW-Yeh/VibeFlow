import path from 'path'
import { randomUUID } from 'crypto'
import { app, dialog, ipcMain, type BrowserWindow } from 'electron'
import serve from 'electron-serve'
import { createWindow } from './helpers/create-window'
import {
  addTask,
  getProjectPath,
  getState,
  removeTask,
  setBoard,
  setProjectPath,
  type BoardState,
  type Task,
} from './helpers/store'
import { getGitInfo, provisionWorktree } from './helpers/git'

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
  app.quit()
})

ipcMain.on('message', async (event, arg) => {
  event.reply('message', `${arg} World!`)
})
