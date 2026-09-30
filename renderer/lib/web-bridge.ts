import { createBridge } from '../../packages/core/src/client'
import { createWsTransport, type WebSocketLike } from '../../packages/core/src/ws-transport'

/** Fired on `window` whenever the connection to core drops or comes back. */
export const CONNECTION_EVENT = 'vibeflow:connection'

/**
 * In a plain browser (the Web UI served by `vibeflow`), build `window.vibeflow`
 * over a WebSocket to the core that served this page. Electron's preload has
 * already installed it there, so this is a no-op in the desktop app. The
 * auth cookie rides along automatically: the socket is same-origin.
 */
export function installWebBridge(): void {
  if (typeof window === 'undefined' || window.vibeflow) return
  const url = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`
  const transport = createWsTransport({
    connect: () => new WebSocket(url) as unknown as WebSocketLike,
    // Board changes made while disconnected were pushed to nobody.
    onReconnect: () => {
      void bridge.getState().then((state) => transport.dispatch('state:changed', state))
    },
    onStatus: (connected) => {
      window.dispatchEvent(new CustomEvent(CONNECTION_EVENT, { detail: { connected } }))
    },
  })
  const bridge = createBridge(transport)
  window.vibeflow = bridge
}
