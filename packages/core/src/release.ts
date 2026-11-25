import { isMasterTask, type BoardState, type Task } from './store'
import { taskStatus, type StatusKey } from './status-keys'

/** Statuses that give a release slot back: the card is no longer running on its own. */
const SLOT_FREEING: readonly StatusKey[] = ['needs_review', 'stuck', 'pr_opened']

/**
 * How many In Progress cards hold a slot. Every non-master card counts,
 * dragged in by hand or released, waiting on a limit included, unless its
 * status says it stopped for a person or is done with its PR.
 */
export function occupiedSlots(board: BoardState): number {
  return board.in_progress.filter((t) => {
    if (isMasterTask(t)) return false
    const status = taskStatus(t)
    return !status || !SLOT_FREEING.includes(status)
  }).length
}

/** 準備開工 cards in inventory-column order. */
export function readyCards(board: BoardState): Task[] {
  return board.inventory.filter((t) => !isMasterTask(t) && taskStatus(t) === 'ready' && !t.quotaWait)
}

/** The cards to release now: as many ready cards, in column order, as there are free slots. */
export function releaseCandidates(board: BoardState, concurrency: number): Task[] {
  const free = Math.max(0, concurrency - occupiedSlots(board))
  return readyCards(board).slice(0, free)
}
