import { IpcHandler, VibeFlowApi } from '../main/preload'

declare global {
  interface Window {
    ipc: IpcHandler
    vibeflow: VibeFlowApi
  }
}
