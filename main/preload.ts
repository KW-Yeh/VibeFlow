import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import type {
  AppSettings,
  BoardState,
  Task,
  VibeFlowState,
} from './helpers/store'
import type { AgentCli, AgentCliId } from './helpers/agents'
import type { DiffFile, FinalizeResult, GitInfo } from './helpers/git'
import type { TaskProgress } from './helpers/progress'

const handler = {
  send<T>(channel: string, value?: T) {
    ipcRenderer.send(channel, value)
  },
  on<T>(channel: string, callback: (...args: T[]) => void) {
    const subscription = (_event: IpcRendererEvent, ...args: T[]) =>
      callback(...args)
    ipcRenderer.on(channel, subscription)

    return () => {
      ipcRenderer.removeListener(channel, subscription)
    }
  },
}

contextBridge.exposeInMainWorld('ipc', handler)

export type IpcHandler = typeof handler

// Typed VibeFlow domain API backed by ipcRenderer.invoke <-> ipcMain.handle.
const vibeflow = {
  getState: (): Promise<VibeFlowState> =>
    ipcRenderer.invoke('vibeflow:getState'),
  /** Running app version (package.json version baked into the build). */
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),
  /** Restart the app — picks up a newer build installed over the bundle. */
  relaunch: (): Promise<void> => ipcRenderer.invoke('app:relaunch'),
  /** Fired once when a newer build has replaced the running bundle on disk. */
  onUpdateAvailable: (callback: () => void): (() => void) => {
    const sub = () => callback()
    ipcRenderer.on('update:available', sub)
    return () => ipcRenderer.removeListener('update:available', sub)
  },
  setBoard: (board: BoardState): Promise<VibeFlowState> =>
    ipcRenderer.invoke('vibeflow:setBoard', board),
  setSettings: (patch: Partial<AppSettings>): Promise<VibeFlowState> =>
    ipcRenderer.invoke('vibeflow:setSettings', patch),
  /** Native folder picker — returns the chosen absolute path, or null. */
  pickFolder: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:pickFolder'),
  getGitInfo: (projectPath: string): Promise<GitInfo> =>
    ipcRenderer.invoke('git:getInfo', projectPath),
  /** Agent CLIs (claude / codex / gemini) actually installed on PATH. */
  detectAgents: (): Promise<AgentCli[]> =>
    ipcRenderer.invoke('env:detectAgents'),
  createTask: (payload: {
    title: string
    description?: string
    projectPath: string
    baseBranch: string | null
    agentCli?: AgentCliId
  }): Promise<{ state: VibeFlowState; task: Task }> =>
    ipcRenderer.invoke('vibeflow:createTask', payload),
  updateTask: (payload: {
    taskId: string
    title: string
    description?: string
  }): Promise<VibeFlowState> =>
    ipcRenderer.invoke('vibeflow:updateTask', payload),
  removeTask: (taskId: string): Promise<VibeFlowState> =>
    ipcRenderer.invoke('vibeflow:removeTask', taskId),

  // Review & finalize (Phase 4).
  getDiff: (taskId: string): Promise<DiffFile[]> =>
    ipcRenderer.invoke('git:getDiff', taskId),
  approve: (
    taskId: string,
    message: string
  ): Promise<{ result: FinalizeResult; state: VibeFlowState }> =>
    ipcRenderer.invoke('git:approve', { taskId, message }),
  cleanupTask: (taskId: string): Promise<VibeFlowState> =>
    ipcRenderer.invoke('vibeflow:cleanupTask', taskId),
  /** Live task-progress updates pushed from main while a session runs. */
  onProgressUpdate: (
    callback: (payload: { taskId: string; progress: TaskProgress }) => void
  ): (() => void) => {
    const sub = (
      _event: IpcRendererEvent,
      payload: { taskId: string; progress: TaskProgress }
    ) => callback(payload)
    ipcRenderer.on('progress:update', sub)
    return () => ipcRenderer.removeListener('progress:update', sub)
  },
  deleteTask: (taskId: string): Promise<VibeFlowState> =>
    ipcRenderer.invoke('vibeflow:deleteTask', taskId),

  // Interactive terminal bridge (Phase 3).
  term: {
    start: (
      taskId: string,
      cwd: string,
      command?: string
    ): Promise<{ pid: number }> =>
      ipcRenderer.invoke('pty:start', { taskId, cwd, command }),
    input: (taskId: string, data: string): void =>
      ipcRenderer.send('pty:input', { taskId, data }),
    resize: (taskId: string, cols: number, rows: number): void =>
      ipcRenderer.send('pty:resize', { taskId, cols, rows }),
    kill: (taskId: string): void => ipcRenderer.send('pty:kill', taskId),
    onData: (
      callback: (payload: { taskId: string; data: string }) => void
    ): (() => void) => {
      const sub = (
        _event: IpcRendererEvent,
        payload: { taskId: string; data: string }
      ) => callback(payload)
      ipcRenderer.on('pty:data', sub)
      return () => ipcRenderer.removeListener('pty:data', sub)
    },
    onExit: (
      callback: (payload: { taskId: string; exitCode: number }) => void
    ): (() => void) => {
      const sub = (
        _event: IpcRendererEvent,
        payload: { taskId: string; exitCode: number }
      ) => callback(payload)
      ipcRenderer.on('pty:exit', sub)
      return () => ipcRenderer.removeListener('pty:exit', sub)
    },
  },
}

contextBridge.exposeInMainWorld('vibeflow', vibeflow)

export type VibeFlowApi = typeof vibeflow
