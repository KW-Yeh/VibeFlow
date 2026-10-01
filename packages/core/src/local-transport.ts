import type { BridgeTransport } from './client'
import type { Core } from './service'

/**
 * `BridgeTransport` for a frontend in the same process as core (the TUI when
 * it is the host). Calls go straight to the handler table.
 */
export function createLocalTransport(core: Core): BridgeTransport {
  const call = (channel: string, args: unknown[]) => {
    const handler = core.handlers[channel]
    if (!handler) return Promise.reject(new Error(`unknown method ${channel}`))
    return Promise.resolve().then(() => handler(...args))
  }
  return {
    kind: 'local',
    invoke: <T>(channel: string, ...args: unknown[]) => call(channel, args) as Promise<T>,
    send: (channel, ...args) => {
      void call(channel, args).catch(() => {})
    },
    on: (channel, callback) =>
      core.bus.on((event, payload) => {
        if (event === channel) callback(payload)
      }),
  }
}
