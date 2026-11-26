import type { ColumnId } from '@/lib/types'

export type CardMove = 'start' | 'complete' | 'return' | 'reopen' | 'rerun'

/**
 * What dropping a card on another column means, or null when that drop is not
 * allowed. A card reaches Done only from In Progress: completing needs a run
 * to account for.
 */
export function cardMove(from: ColumnId, to: ColumnId): CardMove | null {
  if (from === 'backlog') return to === 'in_progress' ? 'start' : null
  if (from === 'in_progress') {
    if (to === 'done') return 'complete'
    return to === 'backlog' ? 'return' : null
  }
  if (to === 'backlog') return 'reopen'
  return to === 'in_progress' ? 'rerun' : null
}
