import { createBridge } from '../../packages/core/src/client'
import { createWsTransport, type WebSocketLike } from '../../packages/core/src/ws-transport'

/** Fired on `window` whenever the connection to core drops or comes back. */
export const CONNECTION_EVENT = 'vibeflow:connection'

/**
 * Build `window.vibeflow` over a WebSocket to the core that served this page.
 * The auth cookie rides along automatically: the socket is same-origin.
 */
export function installWebBridge(): void {
  if (typeof window === 'undefined' || window.vibeflow) return
  const url = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`
  const transport = createWsTransport({
    connect: () => new WebSocket(url) as unknown as WebSocketLike,
    // Board changes made while disconnected were pushed to nobody.
    onReconnect: () => {
      void bridge.getState().then((state) => transport.dispatch('state:changed', state))
      void bridge.getUpdateStatus()
        .then((status) => transport.dispatch('update:available', status))
        .catch(() => {})
    },
    onStatus: (connected) => {
      window.dispatchEvent(new CustomEvent(CONNECTION_EVENT, { detail: { connected } }))
    },
  })
  const bridge = createBridge(transport)
  window.vibeflow = bridge
}
