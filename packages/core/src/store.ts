import { JsonStore } from './json-store'
import { homedir } from 'os'
import { join } from 'path'
import type { AgentCliId, AgentEffort } from './agents'
import type { TokenUsage } from './progress'
import type { GithubRef } from './github'
import { recentProjectsFromBoard, type RecentProject } from './recent-projects'
export type ColumnId = 'backlog' | 'in_progress' | 'done'

export interface Task {
  id: string
  title: string
  /** Optional long-form description / intent for this task. */
  description?: string
  /**
   * Branch the card runs on. Decided at creation, but only created in git when
   * the card first launches — until then it is a name, nothing more.
   */
  branch: string
  /**
   * The user typed `branch` themselves: provisioning must create it verbatim or
   * fail, instead of de-duplicating it like a generated name.
   */
  branchExplicit?: boolean
  /** Absolute path of the project this task belongs to (chosen per task). */
  projectPath?: string
  /** Display name of the project (basename of projectPath). */
  projectName?: string
  /** Absolute path of this task's git worktree. Absent = not provisioned yet (or already completed). */
  worktreePath?: string
  /** Absolute path of the workspace folder housing the worktree (= dirname(worktreePath)). */
  workspacePath?: string
  /** Base branch the worktree is (or will be) created from. */
  baseBranch?: string
  /** Whether the branch was pushed upstream when it was provisioned. */
  pushed?: boolean
  /** Agent CLI used for this task. Absent = 'claude' (pre-field tasks). */
  agentCli?: AgentCliId
  /** Model id. Absent = agent's default model. */
  model?: string
  /** Reasoning depth. Absent = provider/model default. */
  effort?: AgentEffort
  /**
   * Whether this card's agent may act without asking for approval. Absent =
   * fall back to `AppSettings.autoMode`, so cards created before the field
   * existed keep the behaviour they were created under.
   */
  autoMode?: boolean
  /** Epoch ms when the card was created. */
  createdAt?: number
  /**
   * Epoch ms when this card's Claude execution was first launched. Used to
   * auto-run at most once when the card enters In Progress; unset = never run.
   */
  launchedAt?: number
  /**
   * Epoch ms when the card's branch and worktree were created — at first start,
   * or at creation for a CLI card written straight into a later column. Unset =
   * the branch is still only a name.
   */
  provisionedAt?: number
  /**
   * Why the last start could not create the card's branch/worktree. The card
   * was sent back to Backlog unstarted; cleared by the next successful start
   * or an edit.
   */
  launchError?: string
  /**
   * Fresh-run discriminator. Set when the user restarts a task so Claude gets
   * a new pinned conversation while app-restart recovery can still find it.
   */
  runId?: string
  /**
   * What the work came to, captured at completion. Absent on cards finished
   * before the field existed and on any card whose branch never diverged from
   * its base — the UI treats both the same way, by showing nothing.
   */
  outcome?: TaskOutcome
  /**
   * Tokens spent by the card's finished runs: folded in when a run is
   * restarted and when the card completes. The live total is this plus the
   * current run (see progress-tracker.ts).
   */
  usage?: TokenUsage
  /** The GitHub Issue or PR this card was converted from. Absent = created by hand. */
  github?: GithubRef
}

/**
 * One commit made on a task's branch.
 */
export interface OutcomeCommit {
  /** Abbreviated sha; the branch is gone by the time this is read, so it is a label, not a ref. */
  sha: string
  subject: string
}

/** One file the task's branch changed, relative to its base. */
export interface OutcomeFile {
  path: string
  /** Single-letter git status, as in DiffEntry. */
  status: string
  additions: number
  deletions: number
}

/**
 * What the finished work amounted to, captured from git while the worktree
 * still exists and kept after it is gone.
 *
 * Completing a task deletes its worktree, artifacts and local branch, which
 * until now left a done card with no account of what it changed. Everything
 * here is a by-product of work that had to happen anyway — commits, a diff,
 * a PR — rather than a report the agent has to remember to write, which is
 * why it is present on cards where an agent-written record never was.
 */
export interface TaskOutcome {
  /** Newest first, capped at MAX_OUTCOME_COMMITS. */
  commits: OutcomeCommit[]
  /** Capped at MAX_DIFF_FILES, like the live diff view. */
  files: OutcomeFile[]
  additions: number
  deletions: number
  /** True when `files` was cut at the cap, so the UI can say so. */
  truncated?: boolean
  /** The task's own pull request, when it had one. */
  pr?: OutcomePr
  /** Epoch ms the snapshot was taken. */
  capturedAt: number
}

/**
 * The task's pull request as it stood at completion. Snapshotted rather than
 * fetched on demand: the worktree `gh` needs is deleted with the task, and the
 * card must still read offline. `url` is kept so the UI can point at the live
 * PR, which may have moved on since.
 */
export interface OutcomePr {
  number: number
  /** OPEN | MERGED | CLOSED, verbatim from gh. */
  state: string
  url: string
  title: string
  /** Markdown body; absent when the PR had none. */
  body?: string
}

export type BoardState = Record<ColumnId, Task[]>

/** Global, board-wide user settings. */
export interface AppSettings {
  /**
   * Default for a new card's `autoMode` — whether its agent may act without
   * asking for approval. Only a card's own value governs a launch; this is
   * what the create dialog starts from.
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
  /** Stage notifications. Absent = DEFAULT_NOTIFICATION_SETTINGS. */
  notifications?: NotificationSettings
}

/** Which progress milestones are announced, and how (task-progress spec). */
export interface NotificationSettings {
  /** Master switch: off = nothing is announced, progress still updates. */
  enabled: boolean
  /** One todo item finished. Off by default — it gets noisy. */
  stepCompleted: boolean
  /** Every todo item finished. */
  allCompleted: boolean
  /** The agent stopped: end of its turn, or asking for a permission. */
  waitingInput: boolean
  /** Also raise a system notification from the browser (Web UI only). */
  desktop: boolean
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: true,
  stepCompleted: false,
  allCompleted: true,
  waitingInput: true,
  desktop: false,
}

/** The effective notification settings: stored booleans over the defaults. */
export function resolveNotificationSettings(settings?: Pick<AppSettings, 'notifications'>): NotificationSettings {
  const stored = (settings?.notifications ?? {}) as Partial<Record<keyof NotificationSettings, unknown>>
  const out = { ...DEFAULT_NOTIFICATION_SETTINGS }
  for (const key of Object.keys(out) as (keyof NotificationSettings)[]) {
    if (typeof stored[key] === 'boolean') out[key] = stored[key] as boolean
  }
  return out
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
  /** Project folders offered by the new-task picker, most recent first. */
  recentProjects?: RecentProject[]
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
 * existing stores (see `migrateStore`). v3 introduced workspaces; v4 the
 * recent-projects list.
 */
const STATE_VERSION = 4

const defaults: VibeFlowState = {
  version: STATE_VERSION,
  projectPath: null,
  board: DEFAULT_BOARD,
  settings: DEFAULT_SETTINGS,
}

let _store: JsonStore<VibeFlowState> | null = null

/**
 * Lazily construct the store on first use. This must happen AFTER the host has
 * registered its PlatformServices and finalized `userData` (main.ts redirects
 * it in dev) — constructing at import time would bind the wrong directory.
 */
export function getStore(): JsonStore<VibeFlowState> {
  if (!_store) {
    _store = new JsonStore<VibeFlowState>({ name: 'vibeflow-state', defaults })
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
function migrateStore(store: JsonStore<VibeFlowState>): void {
  const persistedVersion = store.get('version') ?? 1
  // Keyed on the field, not the version: a binary without the field can
  // rewrite a v4 store and drop it.
  if (!store.has('recentProjects')) {
    store.set('recentProjects', recentProjectsFromBoard(store.get('board')))
  }
  // Earlier builds kept provider API keys here in plaintext. Model lists now
  // come from the agent CLIs, so nothing reads them and they must not linger.
  const settings = store.get('settings') as (AppSettings & { agentConnections?: unknown }) | undefined
  if (settings && 'agentConnections' in settings) {
    const { agentConnections: _dropped, ...rest } = settings
    store.set('settings', rest)
  }
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
  // Partial notification patches merge into what is stored; junk is dropped.
  if (patch.notifications !== undefined) {
    next.notifications = resolveNotificationSettings({
      notifications: { ...resolveNotificationSettings(getSettings()), ...(patch.notifications ?? {}) },
    })
  }
  // A blank custom system prompt means "no custom prompt" — drop the key
  // instead of persisting an empty string.
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
 * to target a profile's store directory without a registered platform.
 */
export function getStoreAtPath(cwd: string): JsonStore<VibeFlowState> {
  const store = new JsonStore<VibeFlowState>({ name: 'vibeflow-state', defaults, cwd })
  migrateStore(store)
  return store
}

/** Absolute path of the backing JSON file for the app's store. */
export function getStorePath(): string {
  return getStore().path
}
