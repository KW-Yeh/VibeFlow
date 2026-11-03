import type { Activity } from './progress'

/**
 * What a master's card cannot tell its master itself — it is stuck on a
 * permission dialog, it never started, its session ended, or it finished a
 * turn without reporting — VibeFlow tells the master instead. Each happening
 * is told once, and news waits while the master cannot take it.
 */

export type NoteKind = 'blocked' | 'launch_failed' | 'exited' | 'turn_unreported'

export interface NotifierOptions {
  /** The card's master and the card's own title; null when it has none. */
  cardOf(taskId: string): { title: string; masterId: string } | null
  /** Whether the master is still running a session that can be typed into now. */
  canReceive(masterId: string): Promise<'yes' | 'later' | 'never'>
  deliver(masterId: string, text: string): Promise<void>
}

export interface Notifier {
  /** A card's agent reading changed (from the progress tracker). */
  activity(taskId: string, activity: Activity): void
  launchFailed(taskId: string, reason: string): void
  exited(taskId: string): void
  /** The card sent its master a message this turn. */
  reported(taskId: string): void
  /** Something changed for a master that may let it take news now. */
  retry(masterId: string): void
}

function describe(kind: NoteKind, id: string, title: string, detail?: string): string {
  const card = `卡片 ${id}「${title}」`
  const look = `查看：VF task show --store-path "$VIBEFLOW_STORE_DIR" --task ${id}`
  switch (kind) {
    case 'blocked':
      return `${card} 卡在權限確認，等使用者允許才會繼續。${look}`
    case 'launch_failed':
      return `${card} 啟動失敗，已退回 Backlog：${detail ?? '原因不明'}。${look}`
    case 'exited':
      return `${card} 的 agent session 已結束。${look}`
    case 'turn_unreported':
      return `${card} 這一回合結束了，但沒有回報結果（可能在等人回答問題）。${look}`
  }
}

export function createNotifier(options: NotifierOptions): Notifier {
  const states = new Map<string, Activity>()
  const inTurn = new Set<string>()
  const reportedThisTurn = new Set<string>()
  const told = new Map<string, Set<NoteKind>>()
  const pending = new Map<string, string[]>()
  const flushing = new Set<string>()

  function note(taskId: string, kind: NoteKind, detail?: string): void {
    const card = options.cardOf(taskId)
    if (!card) return
    const seen = told.get(taskId) ?? new Set<NoteKind>()
    if (seen.has(kind)) return
    seen.add(kind)
    told.set(taskId, seen)
    const queue = pending.get(card.masterId) ?? []
    queue.push(describe(kind, taskId, card.title, detail))
    pending.set(card.masterId, queue)
    schedule(card.masterId)
  }

  function schedule(masterId: string): void {
    // Never from inside the caller: a tracker reading may be what is running.
    setTimeout(() => void flush(masterId), 0)
  }

  async function flush(masterId: string): Promise<void> {
    if (flushing.has(masterId) || !pending.get(masterId)?.length) return
    flushing.add(masterId)
    try {
      const can = await options.canReceive(masterId)
      if (can === 'never') {
        pending.delete(masterId)
        return
      }
      if (can === 'later') return
      const batch = pending.get(masterId) ?? []
      pending.delete(masterId)
      try {
        await options.deliver(masterId, batch.join('\n'))
      } catch {
        pending.set(masterId, [...batch, ...(pending.get(masterId) ?? [])])
      }
    } finally {
      flushing.delete(masterId)
    }
    if (pending.get(masterId)?.length) schedule(masterId)
  }

  function turnStarted(taskId: string): void {
    inTurn.add(taskId)
    reportedThisTurn.delete(taskId)
    told.delete(taskId)
  }

  return {
    activity(taskId, activity) {
      const before = states.get(taskId)
      states.set(taskId, activity)
      const wasBlocked = before?.state === 'waiting' && before.waitingFor === 'permission'
      if (activity.state === 'working') {
        // Leaving a dialog continues the same turn; it can block again later.
        if (wasBlocked) told.get(taskId)?.delete('blocked')
        else if (before?.state !== 'working') turnStarted(taskId)
        return
      }
      if (activity.state !== 'waiting') return
      if (activity.waitingFor === 'permission') {
        note(taskId, 'blocked')
        return
      }
      // Only a turn this host watched start can end unreported; a resumed
      // session idling on its prompt says nothing new.
      if (inTurn.delete(taskId) && !reportedThisTurn.has(taskId)) note(taskId, 'turn_unreported')
    },

    launchFailed(taskId, reason) {
      note(taskId, 'launch_failed', reason)
    },

    exited(taskId) {
      inTurn.delete(taskId)
      note(taskId, 'exited')
    },

    reported(taskId) {
      reportedThisTurn.add(taskId)
    },

    retry(masterId) {
      if (pending.get(masterId)?.length) schedule(masterId)
    },
  }
}
