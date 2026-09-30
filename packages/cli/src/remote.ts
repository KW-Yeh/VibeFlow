import WebSocket from 'ws'
import { createBridge, type VibeFlowApi } from '../../core/src/client'
import type { LockInfo } from '../../core/src/lock'
import { createWsTransport, type WebSocketLike } from '../../core/src/ws-transport'

export interface RemoteCore {
  api: VibeFlowApi
  /** Channels outside the typed bridge (`host:*`). */
  invoke<T>(method: string, ...params: unknown[]): Promise<T>
  close(): void
}

/**
 * Talk to the running host over its WebSocket, authenticating with the token
 * from the 0600 lock file. Node clients send no Origin, so the server requires
 * the bearer token instead.
 */
export function connectToHost(lock: LockInfo): RemoteCore {
  const url = `ws://127.0.0.1:${lock.port}/ws`
  const transport = createWsTransport({
    connect: () =>
      new WebSocket(url, {
        headers: { Authorization: `Bearer ${lock.token}`, Host: `127.0.0.1:${lock.port}` },
      }) as unknown as WebSocketLike,
  })
  return {
    api: createBridge(transport),
    invoke: (method, ...params) => transport.invoke(method, ...params),
    close: () => transport.close(),
  }
}
