import Store from 'electron-store'
import { homedir } from 'os'
import { join } from 'path'
import type { AgentCliId, AgentEffort } from './agents'
import type { TaskProgress } from './progress'
export type ColumnId = 'backlog' | 'in_progress' | 'done'

export type ConnectableAgentId = 'claude' | 'codex'

export interface AgentConnection {
  connected: boolean
  apiKey?: string
  models?: string[]
  error?: string
  updatedAt?: number
}

export type AgentConnections = Partial<Record<ConnectableAgentId, AgentConnection>>

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
  /** Absolute path of the workspace folder housing the worktree (= dirname(worktreePath)). */
  workspacePath?: string
  /** Base branch the worktree was created from. */
  baseBranch?: string
  /**
   * Snapshot of the rendered plan.html taken just before the worktree is torn
   * down on completion. Lets a done task still show its PLAN once the worktree
   * (and its live PLAN.md) is gone.
   */
  planHtml?: string
  /** Whether the branch was pushed upstream at creation. */
  pushed?: boolean
  /** Agent CLI used for planning/review. Absent = 'claude' (pre-field tasks). */
  agentCli?: AgentCliId
  /** Planning/review model id. Absent = agent's default model. */
  model?: string
  /** Agent CLI used to execute this task. Absent = agentCli (pre-field tasks). */
  executionAgentCli?: AgentCliId
  /** Execution model id. Absent = execution agent's default model. */
  executionModel?: string
  /** Reasoning depth for both planning and execution. Absent = provider/model default. */
  effort?: AgentEffort
  /** Epoch ms when the card was created. Used to name the preserved plan.html. */
  createdAt?: number
  /**
   * Epoch ms when this card's Claude execution was first launched. Used to
   * auto-run at most once when the card enters In Progress; unset = never run.
   */
  launchedAt?: number
  /**
   * Fresh-run discriminator. Set when the user restarts a task so Claude gets
   * a new pinned conversation while app-restart recovery can still find it.
   */
  runId?: string
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
   * blank = the agent is launched with no system prompt.
   */
  systemPrompt?: string
  /**
   * Global workstation root: every task's worktree + runtime files live under
   * `<workstationPath>/<projectName>/`. Absent = default to `~/Desktop`.
   */
  workstationPath?: string
  /** Local-only API keys + model lists for providers that expose model APIs. */
  agentConnections?: AgentConnections
}

/**
 * Resolve the effective workstation root: the user's configured path, else the
 * default `~/Desktop`. Every task's per-project workspace folder is built from
 * this (see workspace.ts projectWorkstationPath).
 */
export function resolveWorkstationPath(settings?: AppSettings): string {
  const p = settings?.workstationPath?.trim()
  return p && p.length > 0 ? p : join(homedir(), 'Desktop')
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
}

const DEFAULT_BOARD: BoardState = {
  backlog: [],
  in_progress: [],
  done: [],
}

const DEFAULT_SETTINGS: AppSettings = {
  autoMode: true,
}

/**
 * Current persisted-state schema version. Bumped when a migration must run on
 * existing stores (see `migrateStore`). v3 introduced workspaces.
 */
const STATE_VERSION = 3

const defaults: VibeFlowState = {
  version: STATE_VERSION,
  projectPath: null,
  board: DEFAULT_BOARD,
  settings: DEFAULT_SETTINGS,
}

let _store: Store<VibeFlowState> | null = null

/**
 * Lazily construct the store on first use. This must happen AFTER the app is
 * ready and `userData` has been finalized (main.ts redirects it in dev) —
 * constructing at import time would bind the store to the wrong userData path.
 */
export function getStore(): Store<VibeFlowState> {
  if (!_store) {
    _store = new Store<VibeFlowState>({ name: 'vibeflow-state', defaults })
    migrateStore(_store)
  }
  return _store
}

/**
 * Run one-off, version-gated migrations against an already-constructed store.
 * Stores written before the roles feature was removed keep their `roles` key
 * and per-task `roleId`; both are simply no longer read, so the user's own
 * data is never destroyed by an upgrade.
 */
function migrateStore(store: Store<VibeFlowState>): void {
  const persistedVersion = store.get('version') ?? 1
  if (persistedVersion < STATE_VERSION) {
    store.set('version', STATE_VERSION)
  }
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

/**
 * Create a store instance pointing at an explicit directory. Used by the CLI
 * to target the correct electron-store profile without Electron's app.getPath.
 */
export function getStoreAtPath(cwd: string): Store<VibeFlowState> {
  const store = new Store<VibeFlowState>({ name: 'vibeflow-state', defaults, cwd })
  migrateStore(store)
  return store
}

/** Absolute path of the backing JSON file for the current Electron store. */
export function getStorePath(): string {
  return getStore().path
}
