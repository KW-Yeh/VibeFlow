import type { VibeFlowApi } from '../packages/core/src/client'

declare global {
  interface Window {
    /** Absent until a transport is installed (Electron preload, or `installWebBridge`). */
    vibeflow: VibeFlowApi
  }
}
