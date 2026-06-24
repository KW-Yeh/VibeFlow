import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { app, dialog, ipcMain, type BrowserWindow } from 'electron'
import serve from 'electron-serve'
import { createWindow } from './helpers/create-window'
import {
  addRole,
  addWorkspace,
  findTask,
  getState,
  getStorePath,
  getWorkspaces,
  removeRole,
  removeTask,
  removeWorkspace,
  setBoard,
  setSettings,
  updateRole,
  updateTask,
  updateWorkspace,
  DEFAULT_MAX_REVIEW_ROUNDS,
  type AppSettings,
  type BoardState,
  type PipelineRun,
  type Role,
  type Task,
  type Workspace,
} from './helpers/store'
import { generateContextHtml, scanWorkspace } from './helpers/workspace'
import { detectAgents, type AgentCliId } from './helpers/agents'
import {
  commitAndPush,
  deleteBranch,
  fallbackBranchName,
  generateCommitMessage,
  getGitInfo,
  getGithubCompareUrl,
  getPrStatus,
  getWorktreeDiff,
  initRepository,
  provisionWorktree,
  refreshWorktreeBase,
  removeWorktree,
  syncBaseBranch,
} from './helpers/git'
import { createTaskFromInput } from './helpers/tasks'
import {
  killAllSessions,
  killSession,
  resizeSession,
  reviewSessionKey,
  startSession,
  writeSession,
} from './helpers/pty'
import {
  unwatchAllProgress,
  unwatchProgress,
  watchProgress,
} from './helpers/progress'
import {
  unwatchAllSubAgents,
  unwatchSubAgents,
  watchSubAgents,
} from './helpers/subagents'
import {
  relaunchApp,
  stopUpdateWatcher,
  watchForNewBuild,
} from './helpers/update'
import {
  cancelAllChatSends,
  cancelChatSend,
  startChatSend,
} from './helpers/chat-session'
import { clearConversation, clearMessages, loadConversation } from './helpers/chat-store'
import type { AttachmentInput } from './helpers/chat-session'

const isProd = process.env.NODE_ENV === 'production'

let storeWatcher: fs.FSWatcher | null = null

if (isProd) {
  serve({ directory: 'app' })
} else {
  app.setPath('userData', `${app.getPath('userData')} (development)`)
}

/** Short, URL/branch-safe id derived from a UUID (tasks and roles share it). */
function generateShortId(): string {
  return randomUUID().slice(0, 8)
}

/**
 * Tear down a task's live sessions: stop both the executor PTY and the reviewer
 * PTY (if any), and stop their associated watchers.
 * The watcher runs a final sync on its way out.
 */
function teardownSession(taskId: string): void {
  killSession(taskId)
  unwatchProgress(taskId)
  unwatchSubAgents(taskId)
  // Also tear down the reviewer session (independent PTY + progress watcher).
  const reviewKey = reviewSessionKey(taskId)
  killSession(reviewKey)
  unwatchProgress(reviewKey)
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

  // Initialise a new git repository at the given path and return its GitInfo.
  // Called by the "new project" flow in the new-task dialog before provisioning
  // a worktree.  Idempotent: safe to call on an already-initialised repo.
  ipcMain.handle('git:initRepository', async (_event, projectPath: string) => {
    if (!projectPath) throw new Error('尚未選擇專案資料夾')
    await initRepository(projectPath)
    return getGitInfo(projectPath)
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
        mode?: 'existing' | 'new'
        agentCli?: AgentCliId
        model?: string
        executionAgentCli?: AgentCliId
        executionModel?: string
        roleId?: string
        reviewerRoleId?: string
        workspaceId?: string
      }
    ) => {
      if (!payload.projectPath) {
        throw new Error('尚未選擇專案資料夾')
      }
      const { task } = await createTaskFromInput(payload)
      return { state: getState(), task }
    }
  )

  ipcMain.handle('vibeflow:removeTask', async (_event, taskId: string) => {
    removeTask(taskId)
    return getState()
  })

  // Edit an existing card's fields. Most are plain metadata read at launch time
  // (title / description / agent / model / workspace / roles). The project folder
  // and base branch are git-bound: re-selecting them rebuilds the worktree, which
  // is only allowed for not-yet-launched tasks (no work to lose).
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
        agentCli?: AgentCliId
        model?: string
        executionAgentCli?: AgentCliId
        executionModel?: string
        workspaceId?: string
        projectPath?: string
        baseBranch?: string | null
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

      // Re-provision the worktree only when the project folder or base branch
      // actually changed. Guarded so a started task's work can never be lost.
      let gitPatch: Partial<Task> = {}
      const nextProject = payload.projectPath || existing?.projectPath
      const projectChanged = Boolean(
        existing && payload.projectPath && payload.projectPath !== existing.projectPath
      )
      const baseChanged = Boolean(
        existing &&
          payload.baseBranch != null &&
          payload.baseBranch !== (existing.baseBranch ?? null)
      )
      if (existing && nextProject && (projectChanged || baseChanged)) {
        if (existing.launchedAt) {
          throw new Error('任務已開始執行，無法更換專案資料夾或基準分支')
        }
        if (existing.worktreePath) {
          const diff = await getWorktreeDiff(
            existing.worktreePath,
            existing.baseBranch ?? 'HEAD'
          )
          if (diff.length > 0) {
            throw new Error('目前 worktree 已有變更，無法更換專案資料夾或基準分支')
          }
        }
        const info = await getGitInfo(nextProject)
        if (!info.isRepo) {
          throw new Error('目標資料夾不是 git repository')
        }
        // Tear down the old (empty) worktree before rebuilding on the target.
        teardownSession(payload.taskId)
        if (existing.projectPath) {
          const oldBranch = existing.branch || fallbackBranchName(payload.taskId)
          await removeWorktree(existing.projectPath, oldBranch)
          await deleteBranch(existing.projectPath, oldBranch)
        }
        const result = await provisionWorktree(
          nextProject,
          payload.taskId,
          payload.baseBranch ?? existing.baseBranch ?? null,
          existing.branch
        )
        gitPatch = {
          projectPath: nextProject,
          projectName: path.basename(nextProject),
          branch: result.branch,
          worktreePath: result.worktreePath,
          baseBranch: result.baseBranch,
          pushed: result.pushed,
        }
      }

      updateTask(payload.taskId, {
        title: payload.title.trim() || `Task ${payload.taskId}`,
        description: payload.description?.trim() || undefined,
        roleId: payload.roleId || undefined,
        reviewerRoleId,
        agentCli: payload.agentCli,
        model: payload.model || undefined,
        executionAgentCli: payload.executionAgentCli,
        executionModel: payload.executionModel || undefined,
        workspaceId: payload.workspaceId || undefined,
        pipeline,
        ...gitPatch,
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

  // ── Workspaces ──────────────────────────────────────────────────────────────

  ipcMain.handle('workspaces:create', async (_e, input: { name: string; path: string }) => {
    let scan = await scanWorkspace(input.path)
    if (scan.folderExists && !scan.hasContextFile) {
      await generateContextHtml(input.path)
      scan = { ...scan, hasContextFile: true }
    }
    const workspace: Workspace = {
      id: crypto.randomUUID(),
      name: input.name,
      path: input.path,
      available: scan.folderExists,
      lastScannedAt: Date.now(),
    }
    addWorkspace(workspace)
    return { state: getState(), workspace, scan }
  })

  ipcMain.handle('workspaces:update', async (_e, { id, patch }: { id: string; patch: Partial<Workspace> }) => {
    updateWorkspace(id, patch)
    return getState()
  })

  ipcMain.handle('workspaces:remove', (_e, id: string) => {
    removeWorkspace(id)
    return getState()
  })

  ipcMain.handle('workspaces:refresh', async () => {
    const workspaces = getWorkspaces()
    for (const ws of workspaces) {
      const scan = await scanWorkspace(ws.path)
      updateWorkspace(ws.id, {
        available: scan.folderExists,
        lastScannedAt: Date.now(),
      })
    }
    return getState()
  })

  // --- Interactive terminal / PTY (Phase 3) ---

  ipcMain.handle(
    'pty:start',
    (
      event,
      payload: {
        taskId: string
        cwd: string
        command?: string
        /**
         * Optional composite session key. Defaults to `taskId` (executor
         * session). Pass `${taskId}:review` for the reviewer PTY so both
         * can run concurrently without colliding in the session Maps.
         */
        sessionKey?: string
      }
    ) => {
      const sessionKey = payload.sessionKey ?? payload.taskId
      const taskId = payload.taskId
      const result = startSession(
        sessionKey,
        payload.cwd,
        event.sender,
        payload.command,
        // Session ended (natural exit included) — nothing can write the
        // progress / sub-agent files anymore, so stop polling both.
        () => {
          unwatchProgress(sessionKey)
          // Sub-agent watcher is only installed for executor sessions.
          if (sessionKey === taskId) unwatchSubAgents(taskId)
        }
      )
      // Mirror the agent-maintained progress file into the store (persisted)
      // and push live updates to the renderer while the session is alive.
      // Only the executor session persists progress to the store; both sessions
      // push progress:update so the orchestrator can pick up the review verdict.
      watchProgress(sessionKey, payload.cwd, (progress) => {
        // Always persist: the reviewer writes the verdict into the same file.
        updateTask(taskId, { progress })
        if (!event.sender.isDestroyed()) {
          event.sender.send('progress:update', {
            taskId,
            progress,
          })
        }
      })
      // Sub-agent hooks are only installed for executor sessions (reviewer does
      // not get --settings). Only watch for the executor session.
      if (sessionKey === taskId) {
        watchSubAgents(taskId, payload.cwd, (subAgents) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send('subagents:update', {
              taskId,
              subAgents,
            })
          }
        })
      }
      return result
    }
  )

  ipcMain.on(
    'pty:input',
    (_event, payload: { sessionKey: string; data: string }) => {
      writeSession(payload.sessionKey, payload.data)
    }
  )

  ipcMain.on(
    'pty:resize',
    (_event, payload: { sessionKey: string; cols: number; rows: number }) => {
      resizeSession(payload.sessionKey, payload.cols, payload.rows)
    }
  )

  ipcMain.on('pty:kill', (_event, sessionKey: string) => {
    // If this is a taskId (executor session), teardown both executor + reviewer.
    // If this is a composite reviewer key, only kill that reviewer session.
    if (sessionKey.includes(':')) {
      killSession(sessionKey)
      unwatchProgress(sessionKey)
    } else {
      teardownSession(sessionKey)
    }
  })

  // --- Review & finalize (Phase 4) ---

  // Fetch the latest remote base branch and rebase the task's feature branch on
  // top of it — keeps long-running tasks in sync without leaving the app.
  ipcMain.handle('git:refreshBase', async (_event, taskId: string) => {
    const task = findTask(taskId)
    if (!task?.worktreePath) throw new Error('找不到此任務的 worktree')
    return refreshWorktreeBase(task.worktreePath, task.baseBranch ?? 'main')
  })

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

  // Generate a commit message using the task's agent CLI.
  ipcMain.handle(
    'git:generateCommitMessage',
    async (_event, taskId: string) => {
      const task = findTask(taskId)
      if (!task?.worktreePath) throw new Error('找不到此任務的 worktree')
      return generateCommitMessage(
        task.worktreePath,
        task.baseBranch ?? 'main',
        task.agentCli ?? 'claude'
      )
    }
  )

  // Check whether a PR exists for the current branch.
  ipcMain.handle(
    'git:getPrStatus',
    async (_event, taskId: string) => {
      const task = findTask(taskId)
      if (!task?.worktreePath) return null
      return getPrStatus(task.worktreePath)
    }
  )

  // Build the GitHub compare URL for creating a new PR from this branch.
  ipcMain.handle(
    'git:getGithubCompareUrl',
    async (_event, taskId: string) => {
      const task = findTask(taskId)
      if (!task?.worktreePath) return null
      return getGithubCompareUrl(task.worktreePath, task.baseBranch ?? 'main')
    }
  )

  // Open a URL in the system default browser.
  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    const { shell } = await import('electron')
    await shell.openExternal(url)
  })

  // Cleanup: finalize a card moved to Done. Tear down the PTY, remove the
  // worktree, delete the local branch, then bring the main working tree back to
  // the task's base branch and fast-forward it. Git sync steps are best-effort.
  ipcMain.handle('vibeflow:cleanupTask', async (_event, taskId: string) => {
    const task = findTask(taskId)
    teardownSession(taskId)
    cancelChatSend(taskId)
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
    cancelChatSend(taskId)
    if (task?.projectPath) {
      const branch = task.branch || fallbackBranchName(taskId)
      await removeWorktree(task.projectPath, branch)
      await deleteBranch(task.projectPath, branch)
    }
    clearConversation(taskId)
    removeTask(taskId)
    return getState()
  })

  // --- Chat (structured output mode) ---

  ipcMain.handle('chat:load', (_event, taskId: string) => {
    return loadConversation(taskId)
  })

  ipcMain.handle('chat:cancel', (_event, taskId: string) => {
    cancelChatSend(taskId)
  })

  ipcMain.handle(
    'chat:send',
    (
      event,
      payload: {
        taskId: string
        worktreePath: string
        text: string
        attachments?: AttachmentInput[]
        sessionId: string
        resume: boolean
        systemPrompt: string
        agentCli?: AgentCliId
        model: string
        workspacePath?: string
      }
    ) => {
      startChatSend(payload, event.sender)
    }
  )

  ipcMain.handle('chat:compact', (_event, taskId: string) => {
    const newSessionId = randomUUID()
    clearMessages(taskId, newSessionId)
    return { newSessionId }
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

  // Watch the electron-store backing file for external writes (e.g. CLI) and
  // push fresh state to the renderer so the board refreshes automatically.
  let storeWatchDebounce: ReturnType<typeof setTimeout> | null = null
  storeWatcher = fs.watch(getStorePath(), () => {
    if (storeWatchDebounce) clearTimeout(storeWatchDebounce)
    storeWatchDebounce = setTimeout(() => {
      if (!mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('state:changed', getState())
      }
    }, 200)
  })

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
  cancelAllChatSends()
  unwatchAllProgress()
  unwatchAllSubAgents()
  storeWatcher?.close()
  app.quit()
})

app.on('before-quit', () => {
  killAllSessions()
  cancelAllChatSends()
  unwatchAllProgress()
  unwatchAllSubAgents()
  storeWatcher?.close()
  stopUpdateWatcher()
})

ipcMain.on('message', async (event, arg) => {
  event.reply('message', `${arg} World!`)
})
