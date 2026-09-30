/**
 * Where core pushes events to one connected frontend. Electron's `WebContents`
 * satisfies it structurally; a WebSocket client will be another implementation.
 */
export interface EventSink {
  send(channel: string, payload: unknown): void
  /** True once the frontend is gone, so pushes can be skipped. */
  isDestroyed(): boolean
}
