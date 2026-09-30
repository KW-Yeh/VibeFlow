import type { BridgeTransport } from './client'

/** The part of the WebSocket API both the browser and the `ws` package provide. */
export interface WebSocketLike {
  readonly readyState: number
  send(data: string): void
  close(): void
  onopen: ((ev: unknown) => void) | null
  onclose: ((ev: unknown) => void) | null
  onerror: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
}

export interface WsTransportOptions {
  /** Open a new socket; called again after every disconnect. */
  connect: () => WebSocketLike
  /** Called after a reconnect, so the frontend can resync what it missed. */
  onReconnect?: () => void
  /** Connection state, for a "disconnected" banner. */
  onStatus?: (connected: boolean) => void
}

const OPEN = 1
const MAX_BACKOFF_MS = 5000

/**
 * `BridgeTransport` over web-server.ts's protocol: requests are
 * `{id, method, params}`, answers are `{id, result | error}`, and events are
 * `{event, payload}`. The socket reconnects by itself. Calls made while it is
 * down wait for it, and calls in flight when it drops are rejected.
 */
export interface WsTransport extends BridgeTransport {
  close(): void
  /** Deliver an event to local subscribers as if core had pushed it (resync after a reconnect). */
  dispatch(channel: string, payload: unknown): void
}

export function createWsTransport(options: WsTransportOptions): WsTransport {
  let socket: WebSocketLike | null = null
  let nextId = 1
  let connectedOnce = false
  let closed = false
  let backoff = 250
  const queue: string[] = []
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  const listeners = new Map<string, Set<(payload: unknown) => void>>()

  function flush() {
    while (socket && socket.readyState === OPEN && queue.length > 0) socket.send(queue.shift()!)
  }

  function open() {
    if (closed) return
    const ws = options.connect()
    socket = ws
    ws.onopen = () => {
      backoff = 250
      options.onStatus?.(true)
      flush()
      if (connectedOnce) options.onReconnect?.()
      connectedOnce = true
    }
    ws.onmessage = (ev) => {
      let msg: { id?: number; result?: unknown; error?: { message: string; code?: string }; event?: string; payload?: unknown }
      try {
        msg = JSON.parse(String(ev.data))
      } catch {
        return
      }
      if (typeof msg.event === 'string') {
        dispatch(msg.event, msg.payload)
        return
      }
      const entry = typeof msg.id === 'number' ? pending.get(msg.id) : undefined
      if (!entry) return
      pending.delete(msg.id!)
      if (msg.error) entry.reject(Object.assign(new Error(msg.error.message), { code: msg.error.code }))
      else entry.resolve(msg.result === null ? undefined : msg.result)
    }
    ws.onerror = () => {
      // onclose follows and handles the retry.
    }
    ws.onclose = () => {
      if (socket !== ws) return
      socket = null
      options.onStatus?.(false)
      for (const [id, entry] of Array.from(pending)) {
        pending.delete(id)
        entry.reject(new Error('與 VibeFlow core 的連線中斷'))
      }
      if (closed) return
      setTimeout(open, backoff)
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
    }
  }

  function dispatch(channel: string, payload: unknown) {
    for (const cb of Array.from(listeners.get(channel) ?? [])) cb(payload)
  }

  function post(message: object) {
    const data = JSON.stringify(message)
    if (socket && socket.readyState === OPEN) socket.send(data)
    else queue.push(data)
  }

  open()

  return {
    kind: 'ws',
    invoke<T>(method: string, ...params: unknown[]): Promise<T> {
      const id = nextId++
      return new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
        post({ id, method, params })
      })
    },
    send(method, ...params) {
      post({ method, params })
    },
    on(channel, callback) {
      let set = listeners.get(channel)
      if (!set) listeners.set(channel, (set = new Set()))
      set.add(callback)
      return () => {
        set!.delete(callback)
      }
    },
    close() {
      closed = true
      socket?.close()
    },
    dispatch,
  }
}
