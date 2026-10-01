import type { VibeFlowApi } from '../packages/core/src/client'

declare global {
  interface Window {
    /** Absent until `installWebBridge` installs the WebSocket transport. */
    vibeflow: VibeFlowApi
  }
}
