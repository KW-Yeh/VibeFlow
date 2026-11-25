import type { ColumnId } from '@/lib/types'

export type CardMove = 'start' | 'complete' | 'return' | 'reopen' | 'rerun' | 'inventory' | 'uninventory' | 'release'

/**
 * What dropping a card on another column means, or null when that drop is not
 * allowed. A card reaches Done only from In Progress: completing needs a run
 * to account for. The inventory column sits between Backlog and In Progress:
 * a card goes in from Backlog, back to Backlog, or on to In Progress.
 */
export function cardMove(from: ColumnId, to: ColumnId): CardMove | null {
  if (from === 'backlog') {
    if (to === 'inventory') return 'inventory'
    return to === 'in_progress' ? 'start' : null
  }
  if (from === 'inventory') {
    if (to === 'backlog') return 'uninventory'
    return to === 'in_progress' ? 'release' : null
  }
  if (from === 'in_progress') {
    if (to === 'done') return 'complete'
    return to === 'backlog' ? 'return' : null
  }
  if (to === 'backlog') return 'reopen'
  return to === 'in_progress' ? 'rerun' : null
}
