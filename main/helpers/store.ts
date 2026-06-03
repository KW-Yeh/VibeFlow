import Store from 'electron-store'

export type ColumnId = 'backlog' | 'in_progress' | 'done'

export interface Task {
  id: string
  title: string
  branch: string
  /** Absolute path of this task's git worktree, once provisioned. */
  worktreePath?: string
  /** Base branch the worktree was created from. */
  baseBranch?: string
  /** Whether the branch was pushed upstream at creation. */
  pushed?: boolean
}

export type BoardState = Record<ColumnId, Task[]>

export interface VibeFlowState {
  /** Schema version, bumped on breaking persisted-shape changes for migrations. */
  version: number
  /** Absolute path of the local project the board operates on. */
  projectPath: string | null
  /** Kanban columns and their tasks. */
  board: BoardState
}

const DEFAULT_BOARD: BoardState = {
  backlog: [
    { id: 'task-1', title: '搭建 Electron + Next.js 環境', branch: 'vf-task-1' },
    { id: 'task-2', title: '實作看板拖曳介面', branch: 'vf-task-2' },
  ],
  in_progress: [
    { id: 'task-3', title: '整合 node-pty 互動終端', branch: 'vf-task-3' },
  ],
  done: [],
}

const defaults: VibeFlowState = {
  version: 1,
  projectPath: null,
  board: DEFAULT_BOARD,
}

let _store: Store<VibeFlowState> | null = null

/**
 * Lazily construct the store on first use. This must happen AFTER the app is
 * ready and `userData` has been finalized (main.ts redirects it in dev) —
 * constructing at import time would bind the store to the wrong userData path.
 */
function getStore(): Store<VibeFlowState> {
  if (!_store) {
    _store = new Store<VibeFlowState>({ name: 'vibeflow-state', defaults })
  }
  return _store
}

export function getState(): VibeFlowState {
  const store = getStore()
  return {
    version: store.get('version'),
    projectPath: store.get('projectPath'),
    board: store.get('board'),
  }
}

export function setBoard(board: BoardState): void {
  getStore().set('board', board)
}

export function setProjectPath(projectPath: string | null): void {
  getStore().set('projectPath', projectPath)
}

export function getProjectPath(): string | null {
  return getStore().get('projectPath')
}

/** Add a task to the backlog column and persist. */
export function addTask(task: Task): void {
  const board = getStore().get('board')
  board.backlog = [task, ...board.backlog]
  getStore().set('board', board)
}

/** Find a task by id across all columns. */
export function findTask(taskId: string): Task | null {
  const board = getStore().get('board')
  for (const column of Object.values(board)) {
    const found = column.find((t) => t.id === taskId)
    if (found) return found
  }
  return null
}

/** Remove a task by id from whichever column holds it, and persist. */
export function removeTask(taskId: string): void {
  const board = getStore().get('board')
  ;(Object.keys(board) as ColumnId[]).forEach((col) => {
    board[col] = board[col].filter((t) => t.id !== taskId)
  })
  getStore().set('board', board)
}
