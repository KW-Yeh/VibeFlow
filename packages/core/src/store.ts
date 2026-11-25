import { JsonStore } from './json-store'
import { homedir } from 'os'
import { join } from 'path'
import type { AgentCliId, AgentEffort } from './agents'
import type { TokenUsage } from './progress'
import type { GithubRef } from './github'
import type { JiraRef } from './jira'
import type { JevRoute } from './jev-router'
import { recentProjectsFromBoard, type RecentProject } from './recent-projects'
import type { TagColor } from './tag-colors'
import type { ManualEffort } from './effort'
import type { StatusKey } from './status-keys'
export { moveTaskInColumn } from './board-order'
export type ColumnId = 'backlog' | 'inventory' | 'in_progress' | 'done'

/** Every column, in board order. */
export const COLUMN_IDS: readonly ColumnId[] = ['backlog', 'inventory', 'in_progress', 'done']

/**
 * A card stopped by a usage limit, waiting for it to reset. Kept on the card
 * so a restarted host can rebuild the timer.
 */
export interface QuotaWait {
  /** Epoch ms the limit resets; absent = unknown, probe at the heartbeat interval. */
  resetsAt?: number
  /** Epoch ms the limit was seen. */
  since: number
  agent: AgentCliId
  /** What was stopped: the card's own run or its headless inventory. */
  phase: 'run' | 'inventory'
  /** Status to restore once the card carries on. */
  statusBefore?: StatusKey
  /** Epoch ms of the next probe the heartbeat will try. */
  nextProbeAt?: number
}

/** A card's inventory: the headless pass that writes spec.md / plan.md before it runs. */
export interface TaskInventory {
  /** Extra context the user pasted in the inventory panel, newest last. Never written into the description. */
  context?: string
  /** Files the user attached in the inventory panel, relative to the worktree. */
  attachments?: string[]
  /** The last pass's closing summary, shown in the inventory panel. */
  lastSummary?: string
  /** Epoch ms the running pass started; absent = no pass is running. */
  runningSince?: number
  /** Epoch ms the last pass ended. */
  finishedAt?: number
  /** Why the last pass failed. */
  error?: string
  /** Claude session id of the last pass, so its transcript can be read for a usage limit. */
  sessionId?: string
  /** How many passes have run. */
  passes?: number
  /** spec.md / plan.md the passes wrote, relative to the worktree. */
  docs?: string[]
  /** Epoch ms the card's first run started from its inventory, with the execution brief. */
  handedOffAt?: number
}

/** The last status written by `task status --set` or a status-tag change. */
export interface TaskStatusNote {
  status: StatusKey
  reason?: string
  at: number
}

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
  /** Whether the branch is on the remote: adopted from origin, or pushed by approve. */
  pushed?: boolean
  /** Agent CLI used for this task. Absent = 'claude' (pre-field tasks). */
  agentCli?: AgentCliId
  /** Model id. Absent = use the agent CLI's default. */
  model?: string
  /** Jev's effort decision for an auto-effort run. */
  jevRoute?: JevRoute
  /** Reasoning depth. `auto` asks Jev; absent = provider/model default for older cards. */
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
  /** The Jira ticket this card was created from. */
  jira?: JiraRef
  /**
   * `master` = an orchestrator card: no repo, no branch; it runs its agent in a
   * plain folder and puts other cards on the board. Absent = an ordinary card.
   * A master keeps its folder in `worktreePath` so everything that follows a
   * running agent (terminal, transcripts, artifacts) works unchanged, which is
   * why every git operation must ask `isMasterTask` first.
   */
  role?: 'master'
  /** The master card this card was dispatched by. At most one; never set on a master. */
  masterId?: string
  /** A master's chosen folder. Absent = `<workspacePath>/work`, owned and deleted with the card. */
  workDir?: string
  /**
   * Cards of the same master that must reach Done before this one starts. When
   * the master runs in auto mode the host starts this card once they all have.
   */
  after?: string[]
  /** A master's related projects: folders its agent may read while planning. */
  projects?: string[]
  /**
   * Created with "建立分支" off: `branch` is '' and the card never gets one.
   * A git project still gets an isolated worktree, on a detached HEAD.
   */
  noBranch?: true
  /**
   * A `noBranch` card whose project is not a git repo: it runs in the project
   * folder itself, so `worktreePath === projectPath`. Git must never run there,
   * and nothing VibeFlow tears down may remove or rewrite that folder.
   */
  inPlace?: true
  /** Ids of the board's tags on this card, in the order they were added. Never set on a Done card. */
  tags?: string[]
  /** Set while the card waits for a usage limit to reset. */
  quotaWait?: QuotaWait
  /** The card's inventory state; absent = never inventoried. */
  inventory?: TaskInventory
  /** The reason that came with the card's current status. */
  statusNote?: TaskStatusNote
}

/** A status label the user can put on any number of cards. Cards refer to it by `id`, so it can be renamed. */
export interface TagDef {
  id: string
  name: string
  color: TagColor
}

export function isMasterTask(task: Pick<Task, 'role'>): boolean {
  return task.role === 'master'
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
  jira?: { storyPointsFields?: string[] }
  /** Inventory, release and report settings. Absent = DEFAULT_AUTONOMOUS_SETTINGS. */
  autonomous?: Partial<AutonomousSettings>
}

export interface AutonomousSettings {
  /** How many non-master In Progress cards may run at once while release is on. */
  concurrency: number
  /** Minutes between usage-limit probes when no reset time is known or a probe failed. */
  heartbeatMinutes: number
  /** Reports kept; older ones are deleted when a new one is written. */
  reportKeep: number
  reportAgent: AgentCliId
  /** Absent = the agent's low-cost default. */
  reportModel?: string
  reportEffort: ManualEffort
  /** Extra shell command prefixes a headless inventory may run (Claude), on top of the built-in list. */
  inventoryCommands: string[]
}

export const DEFAULT_AUTONOMOUS_SETTINGS: AutonomousSettings = {
  concurrency: 2,
  heartbeatMinutes: 5,
  reportKeep: 10,
  reportAgent: 'claude',
  reportModel: 'haiku',
  reportEffort: 'low',
  inventoryCommands: [],
}

const positiveInt = (v: unknown, fallback: number, max: number): number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= max ? v : fallback

/** Stored autonomous settings over the defaults; junk values fall back. */
export function resolveAutonomousSettings(settings?: Pick<AppSettings, 'autonomous'>): AutonomousSettings {
  const s = (settings?.autonomous ?? {}) as Record<string, unknown>
  const d = DEFAULT_AUTONOMOUS_SETTINGS
  const efforts: ManualEffort[] = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']
  return {
    concurrency: positiveInt(s.concurrency, d.concurrency, 20),
    heartbeatMinutes: positiveInt(s.heartbeatMinutes, d.heartbeatMinutes, 24 * 60),
    reportKeep: positiveInt(s.reportKeep, d.reportKeep, 1000),
    reportAgent: s.reportAgent === 'codex' ? 'codex' : 'claude',
    reportModel: typeof s.reportModel === 'string' && s.reportModel.trim()
      ? s.reportModel.trim()
      : s.reportAgent === 'codex' ? undefined : d.reportModel,
    reportEffort: efforts.includes(s.reportEffort as ManualEffort) ? (s.reportEffort as ManualEffort) : d.reportEffort,
    inventoryCommands: Array.isArray(s.inventoryCommands)
      ? s.inventoryCommands.filter((c): c is string => typeof c === 'string' && c.trim() !== '').map((c) => c.trim())
      : [],
  }
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
  /** The 終端機 page's shells, in grid order. They outlive a page reload and are shared by every frontend. */
  terminals?: StandaloneTerminalEntry[]
  /** Every tag the user has made, offered to every card. */
  tags?: TagDef[]
  /** The release switch. */
  release?: ReleaseState
  /** Release batches, oldest first. */
  batches?: ReleaseBatch[]
  /** Batch reports, newest first. The report text lives in `<storeDir>/reports/<id>.md`. */
  reports?: ReportEntry[]
}

export interface ReleaseState {
  enabled: boolean
  /** The open batch while the switch is on. */
  batchId?: string
}

/** One status change of a card in a batch. */
export interface StatusEvent {
  at: number
  taskId: string
  /** null = the status tag was removed. */
  status: StatusKey | null
  reason?: string
  /** Who wrote it: the CLI/agent, the user's tag edit, or VibeFlow itself. */
  source: 'cli' | 'user' | 'host'
}

/** The cards one switch-on released, and what happened to them. */
export interface ReleaseBatch {
  id: string
  startedAt: number
  endedAt?: number
  /** Released cards in release order. */
  taskIds: string[]
  /** Title of each released card when it was released, so the report outlives the card. */
  titles?: Record<string, string>
  events: StatusEvent[]
}

export interface ReportEntry {
  id: string
  batchId: string
  createdAt: number
  /** complete = has the agent's narrative; pending = table only, narrative still to be written. */
  status: 'complete' | 'pending'
  title: string
  /** Epoch ms after which a pending report's narrative may be tried again. */
  retryAt?: number
}

/** One shell on the 終端機 page. Its cwd is resolved again from `taskId` or `projectPath` at every start. */
export interface StandaloneTerminalEntry {
  /** `terminal_<uuid>`, also its session key. */
  sessionKey: string
  title: string
  /** Absent = no project: the shell opens in the home directory, like a default terminal. */
  projectPath?: string
  taskId?: string
}

const DEFAULT_BOARD: BoardState = {
  backlog: [],
  inventory: [],
  in_progress: [],
  done: [],
}

/** A board read from disk with every column present: an older binary may have written one without `inventory`. */
export function normalizeBoard(board: Partial<BoardState> | undefined): BoardState {
  const b = board ?? {}
  return {
    backlog: b.backlog ?? [],
    inventory: b.inventory ?? [],
    in_progress: b.in_progress ?? [],
    done: b.done ?? [],
  }
}

const DEFAULT_SETTINGS: AppSettings = {
  autoMode: true,
}

/**
 * Current persisted-state schema version. Bumped when a migration must run on
 * existing stores (see `migrateStore`). v3 introduced workspaces; v4 the
 * recent-projects list; v5 the inventory column, release batches and reports.
 */
export const STATE_VERSION = 5

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
  if (!store.has('terminals')) store.set('terminals', [])
  if (!store.has('tags')) store.set('tags', [])
  const board = store.get('board') as Partial<BoardState> | undefined
  if (board && !Array.isArray(board.inventory)) store.set('board', normalizeBoard(board))
  if (!store.has('release')) store.set('release', { enabled: false })
  if (!store.has('batches')) store.set('batches', [])
  if (!store.has('reports')) store.set('reports', [])
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
    board: normalizeBoard(store.get('board')),
    // `settings` may be absent in state persisted before this field existed;
    // fall back to defaults so the renderer always receives a value.
    settings: store.get('settings') ?? DEFAULT_SETTINGS,
    terminals: store.get('terminals') ?? [],
    tags: store.get('tags') ?? [],
    release: store.get('release') ?? { enabled: false },
    batches: store.get('batches') ?? [],
    reports: store.get('reports') ?? [],
  }
}

export function listTerminals(): StandaloneTerminalEntry[] {
  return getStore().get('terminals') ?? []
}

/** Replace the entry with the same key in place, or append a new one. */
export function saveTerminal(entry: StandaloneTerminalEntry): void {
  const current = listTerminals()
  const index = current.findIndex((t) => t.sessionKey === entry.sessionKey)
  getStore().set('terminals', index === -1
    ? [...current, entry]
    : current.map((t, i) => (i === index ? entry : t)))
}

export function removeTerminals(sessionKeys: Iterable<string>): void {
  const removing = new Set(sessionKeys)
  const current = listTerminals()
  if (current.some((t) => removing.has(t.sessionKey))) {
    getStore().set('terminals', current.filter((t) => !removing.has(t.sessionKey)))
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
  if (patch.autonomous !== undefined) {
    next.autonomous = resolveAutonomousSettings({
      autonomous: { ...resolveAutonomousSettings(getSettings()), ...(patch.autonomous ?? {}) },
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

/**
 * Tags say what a card is waiting on, which a finished card no longer is: a
 * card loses its tags on reaching Done, whichever path took it there. Every
 * board write goes through here so no path can skip that.
 */
export function writeBoard(store: JsonStore<VibeFlowState>, board: BoardState): void {
  store.set('board', {
    ...normalizeBoard(board),
    done: board.done.map((t) => {
      if (!t.tags) return t
      const { tags: _cleared, ...rest } = t
      return rest
    }),
  })
}

export function setBoard(board: BoardState): void {
  writeBoard(getStore(), board)
}


export function setProjectPath(projectPath: string | null): void {
  getStore().set('projectPath', projectPath)
}

export function getProjectPath(): string | null {
  return getStore().get('projectPath')
}

/** Add a task to the backlog column and persist. */
export function addTask(task: Task): void {
  const board = normalizeBoard(getStore().get('board'))
  board.backlog = [task, ...board.backlog]
  writeBoard(getStore(), board)
}

/** Find a task by id across all columns. */
export function findTask(taskId: string): Task | null {
  const board = normalizeBoard(getStore().get('board'))
  for (const column of Object.values(board)) {
    const found = column.find((t) => t.id === taskId)
    if (found) return found
  }
  return null
}

/** Shallow-merge a patch into a task (by id) across all columns, and persist. */
export function updateTask(taskId: string, patch: Partial<Task>): void {
  const board = normalizeBoard(getStore().get('board'))
  ;(Object.keys(board) as ColumnId[]).forEach((col) => {
    board[col] = board[col].map((t) =>
      t.id === taskId ? { ...t, ...patch } : t
    )
  })
  writeBoard(getStore(), board)
}

function withoutRef(task: Task, removedId: string): Task {
  let next = task
  if (next.masterId === removedId) next = { ...next, masterId: undefined, after: undefined }
  if (next.after?.includes(removedId)) {
    const after = next.after.filter((id) => id !== removedId)
    next = { ...next, after: after.length ? after : undefined }
  }
  return next
}

/** Remove a task by id from whichever column holds it, and persist. */
export function removeTask(taskId: string): void {
  const board = normalizeBoard(getStore().get('board'))
  ;(Object.keys(board) as ColumnId[]).forEach((col) => {
    board[col] = board[col]
      .filter((t) => t.id !== taskId)
      // A dispatched card outlives its master; it just stops belonging to one,
      // and a card that waited on the removed one no longer does.
      .map((t) => withoutRef(t, taskId))
  })
  writeBoard(getStore(), board)
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
