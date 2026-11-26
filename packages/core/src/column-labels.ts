import type { ColumnId } from './store'

/** How each column is named to people (UI, TUI, reports, messages). Column ids stay English in data and the CLI. */
export const COLUMN_LABELS: Record<ColumnId, string> = {
  backlog: '待辦',
  in_progress: '進行中',
  done: '已完成',
}

export function columnLabel(column: ColumnId | null | undefined): string {
  return column ? COLUMN_LABELS[column] : '—'
}
