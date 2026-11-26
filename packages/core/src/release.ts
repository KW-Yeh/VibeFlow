import { isMasterTask, type BoardState, type ReleaseBatch, type Task } from './store'
import { taskStatus, type StatusKey } from './status-keys'

/**
 * Statuses that give a slot back: the card is no longer running on its own.
 * `ready` on an In Progress card means it waits to be sent out again.
 */
const SLOT_FREEING: readonly StatusKey[] = ['needs_review', 'stuck', 'pr_opened', 'ready']

function holdsSlot(task: Task): boolean {
  if (isMasterTask(task)) return false
  const status = taskStatus(task)
  return !status || !SLOT_FREEING.includes(status)
}

/**
 * How many In Progress cards hold a slot. Every non-master card counts,
 * dragged in by hand or dispatched, waiting on a limit included, unless its
 * status says it stopped for a person, is done with its PR or waits to go again.
 */
export function occupiedSlots(board: BoardState): number {
  return board.in_progress.filter(holdsSlot).length
}

function dependenciesDone(board: BoardState, task: Task): boolean {
  const done = new Set(board.done.map((t) => t.id))
  return (task.after ?? []).every((id) => done.has(id))
}

function isReady(task: Task): boolean {
  return !isMasterTask(task) && taskStatus(task) === 'ready' && !task.quotaWait
}

/**
 * Tonight's list in dispatch order: 待辦, then In Progress cards marked to go
 * again, each in column order. Cards still waiting on another card are left out.
 */
export function dispatchable(board: BoardState): Task[] {
  const redo = board.in_progress.filter((t) => isReady(t) && t.launchedAt && t.worktreePath)
  return [...board.backlog.filter(isReady), ...redo].filter((t) => dependenciesDone(board, t))
}

/** 準備開工 cards that cannot go out yet because a card they wait on is not Done. */
export function waitingOnDependencies(board: BoardState): Task[] {
  return [...board.backlog, ...board.in_progress]
    .filter((t) => isReady(t) && !dependenciesDone(board, t))
}

/** The cards to send out now: as many dispatchable cards, in order, as there are free slots. */
export function releaseCandidates(board: BoardState, concurrency: number): Task[] {
  const free = Math.max(0, concurrency - occupiedSlots(board))
  return dispatchable(board).slice(0, free)
}

/**
 * A batch is over once it sent out at least one card, none of its cards holds
 * a slot any more and nothing is left to send out.
 */
export function batchDrained(batch: ReleaseBatch, board: BoardState): boolean {
  if (batch.taskIds.length === 0) return false
  const ids = new Set(batch.taskIds)
  if (board.in_progress.some((t) => ids.has(t.id) && holdsSlot(t))) return false
  return dispatchable(board).length === 0
}
