/**
 * What a master still needs to hear once it has dispatched its cards. The
 * person works with those cards directly, so the master is not kept in the
 * loop — it hears only of a card that never started (which breaks the plan's
 * order) and of the moment all its cards are Done (time to sum up). Each is
 * told once, and news waits while the master cannot take it.
 */

export type NoteKind = 'launch_failed' | 'all_done'

export interface NotifierOptions {
  /** The card's master and the card's own title; null when it has none. */
  cardOf(taskId: string): { title: string; masterId: string } | null
  /** Whether the master is still running a session that can be typed into now. */
  canReceive(masterId: string): Promise<'yes' | 'later' | 'never'>
  deliver(masterId: string, text: string): Promise<void>
}

export interface Notifier {
  launchFailed(taskId: string, reason: string): void
  /** Every card of the master is Done; `cardIds` are those cards. */
  allDone(masterId: string, cardIds: string[]): void
  /** Something changed for a master that may let it take news now. */
  retry(masterId: string): void
}

function cardLabel(id: string, title: string): string {
  return `卡片 ${id}「${title}」`
}

export function createNotifier(options: NotifierOptions): Notifier {
  const told = new Set<string>()
  const pending = new Map<string, string[]>()
  const flushing = new Set<string>()

  function push(masterId: string, key: string, text: string): void {
    if (told.has(key)) return
    told.add(key)
    const queue = pending.get(masterId) ?? []
    queue.push(text)
    pending.set(masterId, queue)
    schedule(masterId)
  }

  function schedule(masterId: string): void {
    // Never from inside the caller: a board write may be what is running.
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

  return {
    launchFailed(taskId, reason) {
      const card = options.cardOf(taskId)
      if (!card) return
      // A card that is fixed and fails again is news again.
      told.delete(`launch_failed:${taskId}`)
      const look = `查看：VF task show --store-path "$VIBEFLOW_STORE_DIR" --task ${taskId}`
      push(card.masterId, `launch_failed:${taskId}`,
        `${cardLabel(taskId, card.title)} 啟動失敗，已退回待辦：${reason || '原因不明'}。等它的卡也不會開始。${look}`)
    },

    allDone(masterId, cardIds) {
      if (cardIds.length === 0) return
      const key = `all_done:${masterId}:${[...cardIds].sort().join(',')}`
      push(masterId, key,
        `你的 ${cardIds.length} 張卡片都已完成：${cardIds.join('、')}。請整理每張卡的結果與 PR 連結交給使用者：VF task list --store-path "$VIBEFLOW_STORE_DIR" --master ${masterId}`)
    },

    retry(masterId) {
      if (pending.get(masterId)?.length) schedule(masterId)
    },
  }
}
