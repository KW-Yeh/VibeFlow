import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { createBridge, type BridgeTransport } from '../packages/core/src/client'

// The frontend API over ipcRenderer.invoke <-> ipcMain.handle. The browser
// builds the same object over a WebSocket (renderer/lib/ws-transport.ts).
const ipcTransport: BridgeTransport = {
  kind: 'ipc',
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  on: (channel, callback) => {
    const sub = (_event: IpcRendererEvent, payload: unknown) => callback(payload)
    ipcRenderer.on(channel, sub)
    return () => ipcRenderer.removeListener(channel, sub)
  },
}

contextBridge.exposeInMainWorld('vibeflow', createBridge(ipcTransport))

export type { VibeFlowApi } from '../packages/core/src/client'
