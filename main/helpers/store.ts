import Store from 'electron-store'
import type { AgentCliId } from './agents'
import type { TaskProgress } from './progress'

export type ColumnId = 'backlog' | 'in_progress' | 'done'

/**
 * A reusable persona that can be assigned to tasks. When a task carries a
 * roleId, the role's positioning / responsibilities / boundaries are folded
 * into the agent's system prompt so it executes the task from that role's
 * perspective.
 */
export interface Role {
  id: string
  /** Display name, e.g. "資深前端工程師". */
  name: string
  /** Avatar: an emoji/initials string, or a (downscaled) data-URL image. */
  avatar?: string
  /** 角色定位描述 — who this role is and how it positions itself. */
  positioning?: string
  /** 職責內容 — what this role is responsible for. */
  responsibilities?: string
  /** 執行邊界描述 — what this role must / must not do. */
  boundaries?: string
}

export interface Task {
  id: string
  title: string
  /** Optional long-form description / intent for this task. */
  description?: string
  branch: string
  /** Absolute path of the project this task belongs to (chosen per task). */
  projectPath?: string
  /** Display name of the project (basename of projectPath). */
  projectName?: string
  /** Absolute path of this task's git worktree, once provisioned. */
  worktreePath?: string
  /** Base branch the worktree was created from. */
  baseBranch?: string
  /** Whether the branch was pushed upstream at creation. */
  pushed?: boolean
  /** Agent CLI used to execute this task. Absent = 'claude' (pre-field tasks). */
  agentCli?: AgentCliId
  /** Assigned role id. Absent = no role (default agent behavior). */
  roleId?: string
  /**
   * Epoch ms when this card's Claude execution was first launched. Used to
   * auto-run at most once when the card enters In Progress; unset = never run.
   */
  launchedAt?: number
  /**
   * Latest execution progress, mirrored from the agent-maintained progress
   * file (see helpers/progress.ts). Survives restarts; a re-run feeds it back
   * into the prompt so the agent resumes instead of starting over.
   */
  progress?: TaskProgress
}

export type BoardState = Record<ColumnId, Task[]>

/** Global, board-wide user settings. */
export interface AppSettings {
  /**
   * When true, dragging a card into In Progress auto-launches its Claude
   * execution (once). The manual run button works regardless of this flag.
   */
  autoMode: boolean
  /**
   * Custom system prompt appended when launching Claude for a card. Absent or
   * blank = use the renderer's built-in default (DEFAULT_SYSTEM_PROMPT).
   */
  systemPrompt?: string
}

export interface VibeFlowState {
  /** Schema version, bumped on breaking persisted-shape changes for migrations. */
  version: number
  /** Absolute path of the local project the board operates on. */
  projectPath: string | null
  /** Kanban columns and their tasks. */
  board: BoardState
  /** Global user settings. */
  settings: AppSettings
  /** Reusable roles that can be assigned to tasks. */
  roles: Role[]
}

const DEFAULT_BOARD: BoardState = {
  backlog: [],
  in_progress: [],
  done: [],
}

const DEFAULT_SETTINGS: AppSettings = {
  autoMode: true,
}

const defaults: VibeFlowState = {
  version: 1,
  projectPath: null,
  board: DEFAULT_BOARD,
  settings: DEFAULT_SETTINGS,
  roles: [],
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
    // `settings` may be absent in state persisted before this field existed;
    // fall back to defaults so the renderer always receives a value.
    settings: store.get('settings') ?? DEFAULT_SETTINGS,
    // `roles` may be absent in state persisted before the role feature existed.
    roles: store.get('roles') ?? [],
  }
}

export function getSettings(): AppSettings {
  return getStore().get('settings') ?? DEFAULT_SETTINGS
}

/** Shallow-merge a patch into settings and persist; returns the merged value. */
export function setSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...getSettings(), ...patch }
  // A blank custom system prompt means "use the built-in default" — drop the
  // key instead of persisting an empty string.
  if (typeof next.systemPrompt === 'string' && next.systemPrompt.trim() === '') {
    delete next.systemPrompt
  }
  getStore().set('settings', next)
  return next
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

/** Shallow-merge a patch into a task (by id) across all columns, and persist. */
export function updateTask(taskId: string, patch: Partial<Task>): void {
  const board = getStore().get('board')
  ;(Object.keys(board) as ColumnId[]).forEach((col) => {
    board[col] = board[col].map((t) =>
      t.id === taskId ? { ...t, ...patch } : t
    )
  })
  getStore().set('board', board)
}

/** Remove a task by id from whichever column holds it, and persist. */
export function removeTask(taskId: string): void {
  const board = getStore().get('board')
  ;(Object.keys(board) as ColumnId[]).forEach((col) => {
    board[col] = board[col].filter((t) => t.id !== taskId)
  })
  getStore().set('board', board)
}

// --- Roles ---

export function getRoles(): Role[] {
  return getStore().get('roles') ?? []
}

/** Append a role and persist; returns the full roles list. */
export function addRole(role: Role): Role[] {
  const roles = [...getRoles(), role]
  getStore().set('roles', roles)
  return roles
}

/** Shallow-merge a patch into a role (by id) and persist; returns the list. */
export function updateRole(roleId: string, patch: Partial<Role>): Role[] {
  const roles = getRoles().map((r) =>
    r.id === roleId ? { ...r, ...patch, id: r.id } : r
  )
  getStore().set('roles', roles)
  return roles
}

/**
 * Remove a role by id and persist. Tasks still referencing it keep their
 * roleId; resolution falls back to default behavior when the role is gone.
 */
export function removeRole(roleId: string): Role[] {
  const roles = getRoles().filter((r) => r.id !== roleId)
  getStore().set('roles', roles)
  return roles
}
