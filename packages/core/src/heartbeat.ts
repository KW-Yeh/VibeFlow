import type { AgentCliId } from './agents'
import type { QuotaWait } from './store'

/**
 * Wakes each card stopped by a usage limit once the limit should have reset.
 * One timer per card, rebuilt from what the store holds (`Task.quotaWait`),
 * so a restarted host picks up where the last one left off. Nothing here
 * knows how to probe a provider or reach an agent: the host passes that in.
 */

/** Wait this long past the announced reset before probing. */
export const RESET_BUFFER_MS = 60_000
/** One probe per provider answers for every card waiting on it for this long. */
const PROBE_REUSE_MS = 30_000

export interface HeartbeatClock {
  now(): number
  setTimer(fn: () => void, ms: number): unknown
  clearTimer(handle: unknown): void
}

export const realClock: HeartbeatClock = {
  now: () => Date.now(),
  setTimer: (fn, ms) => {
    const t = setTimeout(fn, ms)
    t.unref?.()
    return t
  },
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/** What carrying on did: done (or nothing to do any more), or try again later. */
export type ResumeResult = 'done' | 'retry'

export interface HeartbeatOptions {
  clock?: HeartbeatClock
  /** Every card waiting on a limit right now. */
  waiting(): { taskId: string; wait: QuotaWait }[]
  /** A minimal request to the provider; true = it is accepted again. */
  probe(agent: AgentCliId): Promise<boolean>
  /** The limit is gone: carry the card on. */
  resume(taskId: string, wait: QuotaWait): Promise<ResumeResult>
  /** Remember when the card's next probe is due, so a restart keeps to it. */
  reschedule(taskId: string, nextProbeAt: number): void
  /** Minutes between probes when no reset time is known or a probe failed. */
  intervalMs(): number
}

export interface Heartbeat {
  /** Bring the timers in line with the store: new waits get one, ended waits lose theirs. */
  sync(): void
  /** When the card's next attempt is due, for tests and the UI. */
  dueAt(taskId: string): number | undefined
  stop(): void
}

/** When a wait's first attempt is due. */
export function firstDueAt(wait: QuotaWait, intervalMs: number): number {
  if (wait.nextProbeAt) return wait.nextProbeAt
  return wait.resetsAt ? wait.resetsAt + RESET_BUFFER_MS : wait.since + intervalMs
}

export function createHeartbeat(options: HeartbeatOptions): Heartbeat {
  const clock = options.clock ?? realClock
  const timers = new Map<string, { handle: unknown; at: number }>()
  const running = new Set<string>()
  const probes = new Map<AgentCliId, { at: number; result: Promise<boolean> }>()
  let stopped = false

  function probe(agent: AgentCliId): Promise<boolean> {
    const recent = probes.get(agent)
    if (recent && clock.now() - recent.at < PROBE_REUSE_MS) return recent.result
    const result = options.probe(agent).catch(() => false)
    probes.set(agent, { at: clock.now(), result })
    return result
  }

  function schedule(taskId: string, at: number): void {
    const current = timers.get(taskId)
    if (current?.at === at) return
    if (current) clock.clearTimer(current.handle)
    const handle = clock.setTimer(() => void fire(taskId), Math.max(0, at - clock.now()))
    timers.set(taskId, { handle, at })
  }

  function retryLater(taskId: string): void {
    const at = clock.now() + options.intervalMs()
    options.reschedule(taskId, at)
    timers.delete(taskId)
    schedule(taskId, at)
  }

  async function fire(taskId: string): Promise<void> {
    timers.delete(taskId)
    if (stopped || running.has(taskId)) return
    const wait = options.waiting().find((w) => w.taskId === taskId)?.wait
    if (!wait) return
    running.add(taskId)
    try {
      if (!(await probe(wait.agent))) return retryLater(taskId)
      // A probe that passed says nothing about the next one; let the card's own result count.
      probes.delete(wait.agent)
      const result = await options.resume(taskId, wait).catch((): ResumeResult => 'retry')
      if (result === 'retry' && options.waiting().some((w) => w.taskId === taskId)) retryLater(taskId)
    } finally {
      running.delete(taskId)
    }
  }

  return {
    sync() {
      if (stopped) return
      const waits = options.waiting()
      const ids = new Set(waits.map((w) => w.taskId))
      for (const [taskId, timer] of timers) {
        if (!ids.has(taskId)) {
          clock.clearTimer(timer.handle)
          timers.delete(taskId)
        }
      }
      for (const { taskId, wait } of waits) {
        if (running.has(taskId)) continue
        schedule(taskId, firstDueAt(wait, options.intervalMs()))
      }
    },
    dueAt: (taskId) => timers.get(taskId)?.at,
    stop() {
      stopped = true
      for (const timer of timers.values()) clock.clearTimer(timer.handle)
      timers.clear()
    },
  }
}
