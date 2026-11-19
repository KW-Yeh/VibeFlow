import type { ColumnId, Task } from './store'

/**
 * A master's Backlog cards whose waits are all over: every card they wait on
 * is Done. Cards that wait on nothing are the master's to start, not these.
 */
export function readyDependents(board: Record<ColumnId, Task[]>, masterId: string): Task[] {
  const done = new Set(board.done.map((t) => t.id))
  return board.backlog.filter((t) =>
    t.masterId === masterId && (t.after?.length ?? 0) > 0 && (t.after ?? []).every((id) => done.has(id))
  )
}
