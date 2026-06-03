import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import type { BoardState, Task, VibeFlowState } from './helpers/store'
import type { DiffFile, FinalizeResult, GitInfo } from './helpers/git'

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
  setBoard: (board: BoardState): Promise<VibeFlowState> =>
    ipcRenderer.invoke('vibeflow:setBoard', board),
  setProjectPath: (projectPath: string | null): Promise<VibeFlowState> =>
    ipcRenderer.invoke('vibeflow:setProjectPath', projectPath),
  selectProject: (): Promise<VibeFlowState> =>
    ipcRenderer.invoke('vibeflow:selectProject'),
  getGitInfo: (): Promise<GitInfo> => ipcRenderer.invoke('git:getInfo'),
  createTask: (payload: {
    title: string
    baseBranch: string | null
  }): Promise<{ state: VibeFlowState; task: Task }> =>
    ipcRenderer.invoke('vibeflow:createTask', payload),
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
