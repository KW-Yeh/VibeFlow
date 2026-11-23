import type { BoardState, ColumnId } from './store'

/**
 * Move a card within its own column so it sits right before `beforeId`
 * (null = the column's end). Returns null when the card or the anchor is not
 * in that column, leaving the board untouched.
 */
export function moveTaskInColumn(board: BoardState, taskId: string, beforeId: string | null): BoardState | null {
  const col = (Object.keys(board) as ColumnId[]).find((c) => board[c].some((t) => t.id === taskId))
  if (!col || beforeId === taskId) return null
  const task = board[col].find((t) => t.id === taskId)!
  const rest = board[col].filter((t) => t.id !== taskId)
  const index = beforeId === null ? rest.length : rest.findIndex((t) => t.id === beforeId)
  if (index === -1) return null
  return { ...board, [col]: [...rest.slice(0, index), task, ...rest.slice(index)] }
}
