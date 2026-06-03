import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import type { BoardState, VibeFlowState } from './helpers/store'

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
}

contextBridge.exposeInMainWorld('vibeflow', vibeflow)

export type VibeFlowApi = typeof vibeflow
