import Store from 'electron-store'
import type { AgentCliId } from './agents'
import type { ReviewVerdict, TaskProgress } from './progress'

export type ColumnId = 'backlog' | 'in_progress' | 'done'

/** Default number of review rounds before a stuck pipeline escalates to human. */
export const DEFAULT_MAX_REVIEW_ROUNDS = 3

/**
 * Stage of the auto-assign review pipeline for a task that has both an executor
 * (roleId) and a reviewer (reviewerRoleId) assigned:
 * - developing: executor working the first pass
 * - reviewing:  reviewer examining the diff
 * - revising:   executor addressing the reviewer's change requests
 * - approved:   reviewer approved — ready for the human to push / open a PR
 * - blocked:    hit the round cap without approval — needs human intervention
 */
export type PipelineStage =
  | 'developing'
  | 'reviewing'
  | 'revising'
  | 'approved'
  | 'blocked'

/** Runtime state of a task's executor↔reviewer review loop. */
export interface PipelineRun {
  stage: PipelineStage
  /** Completed review rounds that requested changes (drives the round cap). */
  round: number
  /** Max change-request rounds before escalating to `blocked`. */
  maxRounds: number
  /** Latest reviewer verdict, kept for display on the card. */
  lastReview?: ReviewVerdict
}

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
  /** Assigned executor role id. Absent = no role (default agent behavior). */
  roleId?: string
  /**
   * Assigned reviewer role id. When set (alongside an executor roleId), the
   * task runs as a pipeline: the executor's completion auto-triggers a reviewer
   * pass in the same worktree, looping until approval or the round cap.
   */
  reviewerRoleId?: string
  /**
   * Runtime state of the executor↔reviewer review loop. Present only for
   * pipeline tasks (those carrying a reviewerRoleId at creation).
   */
  pipeline?: PipelineRun
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

/**
 * Current persisted-state schema version. Bumped when a migration must run on
 * existing stores (see `migrateStore`). v2 introduced the seeded default roles.
 */
const STATE_VERSION = 2

/**
 * Built-in starter roles seeded for first-time users so the board ships with a
 * usable executor + reviewer pair out of the box. These are ordinary roles —
 * users may freely edit or delete them via the role manager; once seeded they
 * are not re-created (the version gate in `migrateStore` only fires once).
 */
const DEFAULT_ROLES: Role[] = [
  {
    id: 'default-developer',
    name: '一般開發者',
    avatar: '👨‍💻',
    positioning:
      '你是一位全端開發者，負責將任務需求轉化為可運作、可維護的程式碼實作。你重視程式碼的可讀性與模組化，並以最小、聚焦的改動達成任務目標。',
    responsibilities:
      '解析任務需求並釐清模糊的邊界；規劃實作步驟；撰寫與修改程式碼；遵循專案既有的架構慣例與程式風格；執行專案既有的型別檢查、測試與建置；診斷並修正過程中出現的錯誤。',
    boundaries:
      '應做：保持改動聚焦於任務範圍、確實處理錯誤與邊界條件。禁做：嚴禁進行範疇外的無關重構；嚴禁為趕時程而略過標準的錯誤處理；不修改與任務無關的檔案。',
  },
  {
    id: 'default-tester',
    name: '測試者',
    avatar: '🧪',
    positioning:
      '你是一位 QA／測試工程師，站在品質把關的立場審查程式碼改動，確保實作正確、符合需求且不引入回歸。',
    responsibilities:
      '審查 git diff 與實作邏輯；驗證需求達成度與邊界條件；檢查錯誤處理、潛在回歸與安全性問題；確認改動符合專案既有慣例；提出具體且可操作的修正建議。',
    boundaries:
      '應做：審查意見須具體指出問題的位置與原因，並區分必須修正與建議性意見。禁做：不主動改寫實作，僅提出修正建議；不給籠統含糊的評語；若無必須修正的問題即明確核可（approve）。',
  },
]

const defaults: VibeFlowState = {
  version: STATE_VERSION,
  projectPath: null,
  board: DEFAULT_BOARD,
  settings: DEFAULT_SETTINGS,
  roles: DEFAULT_ROLES,
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
    migrateStore(_store)
  }
  return _store
}

/**
 * Run one-off, version-gated migrations against an already-constructed store.
 * `electron-store` only applies `defaults` when a key is entirely absent, so
 * existing installs (which already persisted `roles: []`) never receive the new
 * seeded roles from `defaults`. This backfills them once: if the store predates
 * v2 and carries no roles, we seed `DEFAULT_ROLES`. The version is bumped
 * regardless so the seed runs at most once — a user who later deletes the
 * defaults will not have them silently restored.
 */
function migrateStore(store: Store<VibeFlowState>): void {
  const persistedVersion = store.get('version') ?? 1
  if (persistedVersion < 2) {
    if ((store.get('roles') ?? []).length === 0) {
      store.set('roles', DEFAULT_ROLES)
    }
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

/** Normalize a role name for uniqueness comparison (trim + case-insensitive). */
function normalizeRoleName(name: string): string {
  return name.trim().toLowerCase()
}

/**
 * Throw if `name` collides with an existing role (case-insensitive, trimmed),
 * ignoring the role identified by `excludeId`. Enforces the uniqueness
 * invariant at the persistence layer so no path can write a duplicate.
 */
function assertRoleNameAvailable(
  roles: Role[],
  name: string,
  excludeId?: string
): void {
  const target = normalizeRoleName(name)
  const clash = roles.some(
    (r) => r.id !== excludeId && normalizeRoleName(r.name) === target
  )
  if (clash) throw new Error(`已存在名稱為「${name.trim()}」的角色`)
}

/** Append a role and persist; returns the full roles list. */
export function addRole(role: Role): Role[] {
  const existing = getRoles()
  assertRoleNameAvailable(existing, role.name)
  const roles = [...existing, role]
  getStore().set('roles', roles)
  return roles
}

/** Shallow-merge a patch into a role (by id) and persist; returns the list. */
export function updateRole(roleId: string, patch: Partial<Role>): Role[] {
  const existing = getRoles()
  if (patch.name !== undefined) {
    assertRoleNameAvailable(existing, patch.name, roleId)
  }
  const roles = existing.map((r) =>
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
