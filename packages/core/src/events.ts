/** Where core pushes events to one connected frontend, e.g. a WebSocket client. */
export interface EventSink {
  send(channel: string, payload: unknown): void
  /** True once the frontend is gone, so pushes can be skipped. */
  isDestroyed(): boolean
}

export type EventListener = (channel: string, payload: unknown) => void

/**
 * Fan-out of every event core emits. Each transport subscribes once and
 * forwards to its clients, so two frontends on the same core see the same
 * terminal output and board changes.
 */
export class EventBus {
  private readonly listeners = new Set<EventListener>()

  on(listener: EventListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  emit(channel: string, payload: unknown): void {
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(channel, payload)
      } catch {
        // One broken client must not stop delivery to the others.
      }
    }
  }

  /** The bus as an `EventSink`, for helpers written against a single sender. */
  sink(): EventSink {
    return { send: (channel, payload) => this.emit(channel, payload), isDestroyed: () => false }
  }
}
