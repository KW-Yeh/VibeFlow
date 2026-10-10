import fs from 'fs'
import os from 'os'
import path from 'path'
import { randomUUID } from 'crypto'
import {
  findTask,
  getSettings,
  getState,
  getStore,
  getStorePath,
  removeTask,
  resolveNotificationSettings,
  resolveWorkstationPath,
  setBoard,
  setSettings,
  updateTask,
  type AppSettings,
  type BoardState,
  type ColumnId,
  type Task,
  type TaskOutcome,
  type VibeFlowState,
} from './store'
import { projectWorkstationPath, taskAttachmentStagingPath } from './workspace'
import { AGENT_EFFORTS, detectAgents, type AgentCliId, type AgentEffort } from './agents'
import { createModelCatalog, type ModelCatalog } from './agent-models'
import { createJevRouter, type JevRouter } from './jev-router'
import { jevKeyStatus, readJevApiKey, removeJevApiKey, saveJevApiKey } from './jev-credentials'
import { clampEffort } from './effort'
import {
  cancelGitHubCliLogin,
  getGitHubCliAuthStatus,
  logoutGitHubCli,
  startGitHubCliLogin,
  type GitHubCliAuthStatus,
} from './github-auth'
import { createGithubService, isGithubRef, parseGithubRepo, type GhRunner, type GithubRef } from './github'
import { createJiraService, DEFAULT_POINT_FIELDS, isJiraRef, type JiraRef } from './jira'
import { cancelJiraLogin, getJiraAuthStatus, inputJiraLogin, logoutJira, startJiraLogin, type AcliRunner, type JiraAuthStatus } from './jira-auth'
import {
  captureTaskOutcome,
  commitAndPush,
  deleteBranch,
  fallbackBranchName,
  generateCommitMessage,
  getGitInfo,
  getGithubCompareUrl,
  getPrStatus,
  getWorktreeDiff,
  getWorktreeDiffEntries,
  getWorktreeDiffFile,
  assertBranchAvailable,
  initRepository,
  removeWorktree,
  resetWorktreeToBase,
  syncBaseBranch,
} from './git'
import { createTaskFromInput, provisionTaskWorktree } from './tasks'
import { listRecentProjects, recordRecentProject } from './recent-projects'
import { boardCliLaunchInfo } from './board-cli'
import { decisionsKey, deleteDecisions } from './decisions'
import { readBranchSpecs, readWorktreeSpecs } from './specs'
import { agentArtifactsPath, deleteArtifacts, listArtifacts, readArtifact } from './artifacts'
import { resetSubAgents, unwatchAllSubAgents, unwatchSubAgents, watchSubAgents } from './subagents'
import { cancelAllChatSends, cancelChatSend, startChatSend } from './chat-session'
import { clearConversation, clearMessages, loadConversation } from './chat-store'
import { writeAttachments, writeAttachmentsTo, type AttachmentInput } from './attachments'
import {
  createEntry as createLibraryEntry,
  deleteEntry as deleteLibraryEntry,
  importEntry as importLibraryEntry,
  libraryLaunchInfo,
  libraryPaths,
  libraryRoot,
  listLibrary,
  readEntryContent as readLibraryEntry,
  setEntryDescription as setLibraryEntryDescription,
  setEntryEnabled as setLibraryEntryEnabled,
  updateEntry as updateLibraryEntry,
  type LibraryKind,
} from './library'
import { builtinSkillsDir, removedBuiltinSkills, restoreBuiltinSkill } from './library-builtins'
import { buildAgentCommand, executorSessionId, taskAgent, taskModel } from './launch'
import { createProgressTracker, type ProgressTarget } from './progress-tracker'
import type { ProgressNotification, TaskProgress, TokenUsage } from './progress'
import { EventBus } from './events'
import type { SessionBackend } from './session-backend'
import { getPlatform } from './platform'
import type { PickFolderResult } from './folder-dialog'

/** What a terminal start asks for. Core turns it into a command. */
export interface LaunchIntent {
  /** Resume the task's pinned conversation instead of starting it over. */
  resume?: boolean
  /** False starts the agent with settings + Artifact context only, without the card text. */
  includeTaskPrompt?: boolean
}

export interface PtyStartPayload {
  taskId: string
  /** `<taskId>` or `<taskId>:<tab>`. Absent = the task id. */
  sessionKey?: string
  /** Absent = an interactive shell. */
  launch?: LaunchIntent
  /** Clear buffered output when replacing the current interactive shell. */
  fresh?: boolean
  cols?: number
  rows?: number
}

export interface StandaloneTerminalPayload {
  sessionKey: string
  /** A card resolves its own project root; otherwise the user selected a folder. */
  taskId?: string
  projectPath?: string
  cols?: number
  rows?: number
}

export interface CreateTaskPayload {
  title: string
  description?: string
  projectPath: string
  baseBranch: string | null
  /** User-chosen branch name; blank/absent = derive one from the card. */
  branch?: string
  mode?: 'existing' | 'new'
  agentCli?: AgentCliId
  model?: string
  effort?: AgentEffort
  autoMode?: boolean
  attachments?: AttachmentInput[]
  github?: GithubRef
  jira?: JiraRef
}

export interface UpdateTaskPayload {
  taskId: string
  title: string
  description?: string
  agentCli?: AgentCliId
  model?: string
  effort?: AgentEffort
  autoMode?: boolean
  projectPath?: string
  baseBranch?: string | null
  /** New branch name; blank/absent keeps the current one. */
  branch?: string
}

export interface ChatSendPayload {
  taskId: string
  text: string
  attachments?: AttachmentInput[]
  sessionId: string
  resume: boolean
  systemPrompt: string
  agentCli?: AgentCliId
  model: string
}

/** Refused before a handler runs: the frontend sent something core will not act on. */
export class InvalidRequestError extends Error {
  readonly code = 'INVALID_REQUEST'
}

function invalid(message: string): never {
  throw new InvalidRequestError(message)
}

function str(value: unknown, name: string): string {
  if (typeof value !== 'string') invalid(`${name} must be a string`)
  return value
}

function obj<T>(value: unknown, name: string): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${name} must be an object`)
  return value as T
}

const LIBRARY_KINDS = ['skill', 'prompt', 'script']
const AGENT_IDS = ['claude', 'codex']
const COLUMNS: ColumnId[] = ['backlog', 'in_progress', 'done']

function libraryKind(value: unknown): LibraryKind {
  if (!LIBRARY_KINDS.includes(value as string)) invalid('kind must be skill | prompt | script')
  return value as LibraryKind
}

function agentId(value: unknown): AgentCliId {
  if (!AGENT_IDS.includes(value as string)) invalid('agentId must be claude | codex')
  return value as AgentCliId
}

/** Only ids core already knows are accepted; nothing addresses a task by path. */
function requireTask(taskId: unknown): Task {
  const task = findTask(str(taskId, 'taskId'))
  if (!task) invalid(`unknown task ${String(taskId)}`)
  return task
}

function validBoard(value: unknown): BoardState {
  const board = obj<BoardState>(value, 'board')
  for (const col of COLUMNS) {
    if (!Array.isArray(board[col])) invalid(`board.${col} must be an array`)
  }
  // A board write reorders and moves cards; it must not invent new ones or
  // rewrite their provisioned fields (worktree, project) from the outside.
  const known = new Map<string, Task>()
  for (const col of COLUMNS) for (const t of getState().board[col]) known.set(t.id, t)
  const next: BoardState = { backlog: [], in_progress: [], done: [] }
  for (const col of COLUMNS) {
    for (const t of board[col]) {
      const current = known.get(obj<Task>(t, 'task').id)
      if (!current) continue
      next[col].push({
        ...current,
        // The renderer stamps these when it starts a card.
        launchedAt: typeof t.launchedAt === 'number' ? t.launchedAt : current.launchedAt,
      })
    }
  }
  return next
}

export interface CoreOptions {
  sessions: SessionBackend
  bus: EventBus
  /** The running version, for `app:getVersion`. */
  version: string
  /** Where agent transcripts live (`~/.claude`, `~/.codex`). Defaults to os.homedir(); tests override it. */
  homeDir?: string
  /** Stand-in for the `gh` CLI; tests override it. */
  ghRunner?: GhRunner
  githubAuthStatus?: () => Promise<GitHubCliAuthStatus>
  acliRunner?: AcliRunner
  jiraAuthStatus?: () => Promise<JiraAuthStatus>
  /** Where the agent model lists come from; tests pass one that never starts a CLI. */
  modelCatalog?: ModelCatalog
  /** Injectable Jev routing for tests. */
  jevRouter?: JevRouter
}

export type CoreHandler = (...args: unknown[]) => unknown
/** Channel → handler. Every transport exposes exactly this table. */
export type CoreHandlers = Record<string, CoreHandler>

export interface Core {
  handlers: CoreHandlers
  bus: EventBus
  sessions: SessionBackend
  /** Push fresh state whenever the store file changes on disk (this core's writes, the CLI's). */
  watchStore(): () => void
  /** Ask the agent CLIs for their model lists in the background. */
  warmModelCatalog(): void
  /** Stop every watcher and child this core started. Sessions follow the backend's shutdown rule. */
  shutdown(): void
}

/**
 * Build the core: one handler per channel in IPC_API_MAP.md. Task operations
 * take ids; a standalone shell may take a selected folder when no task exists.
 * No channel accepts a client-supplied shell command. Events use one bus.
 */
export function createCore({ sessions, bus, version, homeDir, ghRunner, githubAuthStatus, acliRunner, jiraAuthStatus, modelCatalog, jevRouter }: CoreOptions): Core {
  const sink = bus.sink()
  const models = modelCatalog ?? createModelCatalog({ version })
  const router = jevRouter ?? createJevRouter({ getApiKey: readJevApiKey })
  const routing = new Map<string, Promise<Task['jevRoute']>>()
  const standaloneTerminals = new Map<string, string>()

  // Codex writes rollouts under whichever CODEX_HOME the launch used: the
  // user's, or the one the library assembles. Resolved once, in the background.
  let libraryCodexHome: string | null = null
  void libraryRoot()
    .then((root) => { libraryCodexHome = libraryPaths(root).codexHome })
    .catch(() => {})

  const home = homeDir ?? os.homedir()
  const progress = createProgressTracker({
    homeDir: home,
    codexHomes: () => [path.join(home, '.codex'), ...(libraryCodexHome ? [libraryCodexHome] : [])],
    onUpdate: (taskId, value) => bus.emit('progress:update', { taskId, progress: value }),
    onNotify: (taskId, list) => {
      const prefs = resolveNotificationSettings(getSettings())
      if (!prefs.enabled) return
      const wanted: Record<ProgressNotification['kind'], boolean> = {
        step_completed: prefs.stepCompleted,
        all_completed: prefs.allCompleted,
        waiting_input: prefs.waitingInput,
      }
      const notifications = list.filter((n) => wanted[n.kind])
      const task = findTask(taskId)
      if (!task || !notifications.length) return
      bus.emit('progress:notify', { taskId, title: task.title, notifications })
    },
  })

  /** What the tracker follows for a card; null when it has no worktree to run in. */
  function progressTarget(task: Task): ProgressTarget | null {
    if (!task.worktreePath) return null
    const agent = taskAgent(task)
    return {
      taskId: task.id,
      agent,
      worktreePath: task.worktreePath,
      sessionId: agent === 'claude' ? executorSessionId(task.id, task.runId) : undefined,
      since: task.launchedAt,
      priorUsage: task.usage,
    }
  }

  function trackProgress(task: Task): void {
    const target = progressTarget(task)
    if (target) progress.track(target)
  }

  /**
   * The card's usage including the run that is ending, for folding into
   * Task.usage before the run's transcripts stop counting (restart, completion).
   */
  function usageThroughCurrentRun(task: Task): TokenUsage | undefined {
    const target = progressTarget(task)
    if (!target) return task.usage
    const wasTracking = progress.isTracking(task.id)
    progress.track(target)
    const snapshot = progress.snapshot(task.id)
    if (!wasTracking) progress.untrack(task.id)
    return snapshot?.totalUsage ?? task.usage
  }

  // Cards already running when the host starts (tmux kept them alive, or an
  // agent finished while nothing watched) are followed without a frontend.
  try {
    for (const task of getState().board.in_progress) trackProgress(task)
  } catch {
    // No store yet (first run): nothing is running.
  }

  async function teardownSession(key: string): Promise<void> {
    const standalone = standaloneTerminals.has(key)
    await sessions.kill(key)
    if (standalone) sessions.discardScrollback?.(key)
    standaloneTerminals.delete(key)
    unwatchSubAgents(key)
  }

  /** Tear down every terminal a task has (its own key and any `<id>:<tab>`). */
  async function teardownTask(taskId: string): Promise<void> {
    const keys = new Set([taskId, ...(await sessions.list()).filter((k) => k.startsWith(`${taskId}:`))])
    await Promise.all(Array.from(keys, (k) => teardownSession(k)))
  }

  function sessionKeyFor(taskId: string, sessionKey: unknown): string {
    if (sessionKey === undefined || sessionKey === null || sessionKey === taskId) return taskId
    const key = str(sessionKey, 'sessionKey')
    if (!key.startsWith(`${taskId}:`)) invalid('sessionKey must be <taskId> or <taskId>:<tab>')
    return key
  }

  /** Session keys belong to known tasks or a standalone terminal opened here. */
  function requireSessionKey(sessionKey: unknown): string {
    const key = str(sessionKey, 'sessionKey')
    if (standaloneTerminals.has(key)) return key
    requireTask(key.split(':')[0])
    return key
  }

  /**
   * The card keeps the effort the user picked; what reaches the CLI is what
   * the model actually running accepts. Unknown models get the card's value.
   */
  function launchEffort(task: Task, selectedModel = taskModel(task)): Task['effort'] {
    const model = models.findModel(taskAgent(task), selectedModel)
    return model?.efforts ? clampEffort(task.effort, model.efforts) : task.effort
  }

  async function launchCommand(task: Task, intent: LaunchIntent): Promise<string> {
    const settings = getSettings()
    const library = await libraryLaunchInfo(task.worktreePath)
    const boardCli = await boardCliLaunchInfo()
    let route = task.model?.trim() ? undefined : task.jevRoute
    if (!task.model?.trim() && !intent.resume && intent.includeTaskPrompt !== false) {
      let pending = routing.get(task.id)
      if (!pending) {
        pending = (async () => {
          const candidateModels = (await (router.enabled === false
            ? models.get(taskAgent(task))
            : models.refresh(taskAgent(task)))).models
          const selected = await router.route(task, candidateModels)
          updateTask(task.id, { jevRoute: selected })
          bus.emit('state:changed', getState())
          return selected
        })().finally(() => routing.delete(task.id))
        routing.set(task.id, pending)
      }
      route = await pending
    }
    const selectedModel = task.model?.trim() ? taskModel(task) : route?.model
    return buildAgentCommand(
      { ...task, model: selectedModel, effort: launchEffort(task, selectedModel) },
      settings.systemPrompt ?? '',
      {
        resume: intent.resume === true,
        includeTaskPrompt: intent.includeTaskPrompt !== false,
        library: library ?? undefined,
        boardCli,
        autoMode: task.autoMode ?? settings.autoMode,
        preflightPlan: !intent.resume ? route?.plan : undefined,
      },
      task.workspacePath
    )
  }

  function claudeSessionFile(cwd: string, sessionId: string): string {
    // Claude stores each session at ~/.claude/projects/<cwd-with-non-alphanumerics-as-dashes>/<id>.jsonl.
    const munged = cwd.replace(/[^a-zA-Z0-9]/g, '-')
    return path.join(os.homedir(), '.claude', 'projects', munged, `${sessionId}.jsonl`)
  }

  async function removeTaskWorktree(task: Task): Promise<void> {
    if (!task.projectPath || !task.worktreePath) return
    const branch = task.branch || fallbackBranchName(task.id)
    await removeWorktree(task.projectPath, task.worktreePath)
    deleteArtifacts(task.workspacePath ?? path.dirname(task.worktreePath), task.worktreePath)
    await deleteBranch(task.projectPath, branch)
  }

  function columnOf(taskId: string): ColumnId | null {
    const board = getState().board
    return COLUMNS.find((col) => board[col].some((t) => t.id === taskId)) ?? null
  }

  // One provisioning per card at a time: the agent launch and a shell tab can
  // both ask while `fetch` + `push` are still running.
  const provisioning = new Map<string, Promise<Task>>()

  /**
   * A card's branch is cut from its base when it first runs, so the start point
   * is the base as it is then, not when the card was written. A failed attempt
   * sends the card back to Backlog unstarted, where it can be edited and retried.
   */
  function ensureProvisioned(task: Task): Promise<Task> {
    if (task.worktreePath) return Promise.resolve(task)
    const pending = provisioning.get(task.id)
    if (pending) return pending
    const run = (async () => {
      try {
        updateTask(task.id, { ...(await provisionTaskWorktree(task)), launchError: undefined })
        bus.emit('state:changed', getState())
      } catch (err) {
        returnUnstarted(task.id, (err as Error).message)
        throw err
      }
      const provisioned = findTask(task.id)
      if (!provisioned) throw new Error('找不到要執行的任務')
      return provisioned
    })().finally(() => provisioning.delete(task.id))
    provisioning.set(task.id, run)
    return run
  }

  function returnUnstarted(taskId: string, launchError: string): void {
    const current = findTask(taskId)
    if (!current) return
    const board = getState().board
    const next: BoardState = {
      backlog: [
        { ...current, launchedAt: undefined, launchError },
        ...board.backlog.filter((t) => t.id !== taskId),
      ],
      in_progress: board.in_progress.filter((t) => t.id !== taskId),
      done: board.done.filter((t) => t.id !== taskId),
    }
    setBoard(next)
    bus.emit('state:changed', getState())
  }

  let folderDialog: Promise<PickFolderResult> | null = null

  const github = createGithubService({
    run: ghRunner,
    authStatus: githubAuthStatus ?? getGitHubCliAuthStatus,
    repoOf: async (projectPath) => parseGithubRepo((await getGitInfo(projectPath)).remoteUrl),
  })
  const jira = createJiraService({
    run: acliRunner,
    authStatus: jiraAuthStatus ?? (() => getJiraAuthStatus(acliRunner)),
    pointFields: () => getSettings().jira?.storyPointsFields?.length ? getSettings().jira!.storyPointsFields! : DEFAULT_POINT_FIELDS,
  })

  const handlers: CoreHandlers = {
    'vibeflow:getState': () => getState(),

    // A card's progress right now (todo list, usage, activity), for a frontend
    // that just connected; 'progress:update' carries every later change. Null
    // when the card has no transcript yet or is not running.
    'progress:get': (taskId): TaskProgress | null => {
      const task = requireTask(taskId)
      if (!progress.isTracking(task.id)) {
        if (columnOf(task.id) !== 'in_progress') return null
        trackProgress(task)
      }
      return progress.snapshot(task.id)
    },
    'app:getVersion': () => version,

    'vibeflow:setBoard': (board) => {
      setBoard(validBoard(board))
      return getState()
    },

    'vibeflow:setSettings': (patch) => {
      const value = obj<Partial<AppSettings>>(patch, 'patch')
      if (value.jira !== undefined) {
        const fields = obj<{ storyPointsFields?: unknown }>(value.jira, 'jira')?.storyPointsFields
        if (fields !== undefined && (!Array.isArray(fields) || !fields.every((field) => typeof field === 'string' && /^customfield_\d+$/.test(field)))) invalid('jira.storyPointsFields must contain customfield IDs')
        jira.clear()
      }
      setSettings(value)
      return getState()
    },

    'settings:jevKeyStatus': () => jevKeyStatus(),
    'settings:saveJevApiKey': (payload) => {
      const p = obj<{ apiKey: unknown }>(payload, 'payload')
      return saveJevApiKey(str(p.apiKey, 'apiKey'))
    },
    'settings:removeJevApiKey': () => removeJevApiKey(),

    'settings:githubAuthStatus': () => getGitHubCliAuthStatus(),
    'settings:startGithubAuthLogin': () => {
      startGitHubCliLogin((payload) => bus.emit('github-auth:event', payload))
    },
    'settings:cancelGithubAuthLogin': () => {
      cancelGitHubCliLogin()
    },
    'settings:logoutGithubAuth': () => logoutGitHubCli(),

    // Open Issues/PRs of the board's GitHub repos that involve the signed-in
    // `gh` user; cached per repo, `force` refetches.
    'github:inbox': async (payload) => {
      const p = payload === undefined ? {} : obj<{ force?: unknown }>(payload, 'payload')
      return github.inbox(getState().board, { force: p.force === true })
    },
    'github:taskLinks': async (payload) => {
      const p = payload === undefined ? {} : obj<{ force?: unknown }>(payload, 'payload')
      return github.taskLinks(getState().board, { force: p.force === true })
    },
    'jira:authStatus': () => (jiraAuthStatus ?? (() => getJiraAuthStatus(acliRunner)))(),
    'settings:startJiraAuthLogin': () => {
      startJiraLogin((event) => {
        if (event.type === 'success') jira.clear()
        bus.emit('jira-auth:event', event)
      }, acliRunner)
    },
    'settings:cancelJiraAuthLogin': () => cancelJiraLogin(),
    'settings:inputJiraAuthLogin': (payload) => inputJiraLogin(str(payload, 'input').slice(0, 1000)),
    'settings:logoutJiraAuth': async () => {
      const status = await logoutJira(acliRunner)
      jira.clear()
      bus.emit('jira-auth:event', { type: 'signed-out', status })
      return status
    },
    'jira:inbox': (payload) => {
      const p = payload === undefined ? {} : obj<{ force?: unknown }>(payload, 'payload')
      return jira.inbox({ force: p.force === true })
    },

    'env:detectAgents': () => detectAgents(),

    'agents:listModels': (payload) => {
      const { agentId: rawId, refresh } = obj<{ agentId: unknown; refresh?: unknown }>(payload, 'payload')
      const id = agentId(rawId)
      return refresh === true ? models.refresh(id) : models.get(id)
    },

    // A task does not exist yet when a project is picked, so these two are the
    // ones that must take a path. They only inspect or `git init` it.
    'git:getInfo': (projectPath) => getGitInfo(str(projectPath ?? '', 'projectPath')),
    'git:initRepository': async (projectPath) => {
      const p = str(projectPath, 'projectPath')
      if (!p) throw new Error('尚未選擇專案資料夾')
      await initRepository(p)
      return getGitInfo(p)
    },

    'projects:listRecent': () => listRecentProjects(getStore()),
    // `vibeflow open <path>` while a host runs: only the host writes the store.
    'projects:record': (projectPath) => {
      const p = path.resolve(str(projectPath, 'projectPath'))
      if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) invalid(`not a directory: ${p}`)
      recordRecentProject(getStore(), p)
      return listRecentProjects(getStore())
    },

    'vibeflow:createTask': async (payload) => {
      const p = obj<CreateTaskPayload>(payload, 'payload')
      if (!p.projectPath) throw new Error('尚未選擇專案資料夾')
      str(p.projectPath, 'projectPath')
      str(p.title ?? '', 'title')
      if (p.effort !== undefined && !AGENT_EFFORTS.includes(p.effort)) invalid('unknown effort')
      if (p.agentCli !== undefined && !AGENT_IDS.includes(p.agentCli)) invalid('unknown agent')
      if (p.github !== undefined && !isGithubRef(p.github)) invalid('github must be an issue or pr ref on github.com')
      if (p.jira !== undefined && !isJiraRef(p.jira)) invalid('jira must be a Jira ticket ref')
      const { task } = await createTaskFromInput({
        projectPath: p.projectPath,
        title: p.title,
        description: p.description,
        baseBranch: p.baseBranch,
        branch: p.branch,
        mode: p.mode,
        agentCli: p.agentCli,
        model: p.model,
        effort: p.effort,
        autoMode: p.autoMode,
        attachments: p.attachments,
        github: p.github,
        jira: p.jira,
      })
      return { state: getState(), task }
    },

    'vibeflow:removeTask': (taskId) => {
      const id = requireTask(taskId).id
      progress.untrack(id)
      removeTask(id)
      return getState()
    },

    // Discard everything the last run left behind — the PTY session, the
    // sub-agent timeline, the conversation id, the code it changed, its artifacts
    // and its legacy decision record — so the next launch starts over as if the card
    // were new. Launching again is the caller's decision.
    'vibeflow:resetTaskRun': async (taskId) => {
      const task = requireTask(taskId)
      if (!task.worktreePath) {
        // Never provisioned: no code, artifacts or sub-agents to discard.
        await teardownTask(task.id)
        progress.untrack(task.id)
        updateTask(task.id, { launchedAt: Date.now(), runId: randomUUID(), jevRoute: undefined })
        const reset = findTask(task.id)
        if (!reset) throw new Error('找不到要重置的任務')
        return { state: getState(), task: reset }
      }
      if (!task.baseBranch) throw new Error('任務沒有記錄 base branch，無法還原 worktree')
      await teardownTask(task.id)
      await resetWorktreeToBase(task.worktreePath, task.baseBranch)
      const workspacePath = task.workspacePath ?? path.dirname(task.worktreePath)
      deleteArtifacts(workspacePath, task.worktreePath)
      deleteDecisions(workspacePath, decisionsKey(task.worktreePath, task.branch))
      resetSubAgents(task.worktreePath)
      // The tokens are spent even though the work is thrown away.
      const usage = usageThroughCurrentRun(task)
      progress.untrack(task.id)
      updateTask(task.id, { launchedAt: Date.now(), runId: randomUUID(), jevRoute: undefined, ...(usage ? { usage } : {}) })
      const reset = findTask(task.id)
      if (!reset) throw new Error('找不到要重置的任務')
      bus.emit('subagents:update', { taskId: task.id, subAgents: [] })
      return { state: getState(), task: reset }
    },

    // Edit an existing card's fields. Only a Backlog card is editable: once it
    // runs, what it was asked to do and where it does it are history. The
    // git-bound fields (project, base, branch) are just stored — the worktree is
    // built when the card starts. A Backlog card that already has one (made
    // before provisioning moved to launch, or returned from a run) gives it up,
    // but only while it holds no changes.
    'vibeflow:updateTask': async (payload) => {
      const p = obj<UpdateTaskPayload>(payload, 'payload')
      const existing = requireTask(p.taskId)
      if (columnOf(existing.id) !== 'backlog') {
        throw new Error('只有 Backlog 的任務可以編輯')
      }
      if (p.effort !== undefined && !AGENT_EFFORTS.includes(p.effort)) invalid('unknown effort')
      let gitPatch: Partial<Task> = {}
      const nextProject = p.projectPath || existing.projectPath
      const nextBranch = p.branch === undefined ? '' : str(p.branch, 'branch').trim()
      const projectChanged = Boolean(p.projectPath && p.projectPath !== existing.projectPath)
      const baseChanged = p.baseBranch != null && p.baseBranch !== (existing.baseBranch ?? null)
      const branchChanged = Boolean(nextBranch && nextBranch !== existing.branch)
      if (nextProject && (projectChanged || baseChanged || branchChanged)) {
        if (existing.worktreePath) {
          // Only the count matters here, so use the entry list — it reads no
          // blob content and skips the network fetch.
          const diff = await getWorktreeDiffEntries(
            existing.worktreePath,
            existing.baseBranch ?? 'HEAD',
            { fetch: false }
          )
          if (diff.length > 0) {
            throw new Error('目前 worktree 已有變更，無法更換專案資料夾、基準分支或分支名稱')
          }
        }
        const info = await getGitInfo(nextProject)
        if (!info.isRepo) throw new Error('目標資料夾不是 git repository')
        const projectName = path.basename(nextProject)
        const workspacePath = projectWorkstationPath(resolveWorkstationPath(getSettings()), projectName)
        // Free the old branch first, so renaming back to it is not reported as taken.
        await teardownTask(existing.id)
        await removeTaskWorktree(existing)
        if (branchChanged) await assertBranchAvailable(nextProject, workspacePath, nextBranch)
        recordRecentProject(getStore(), nextProject)
        gitPatch = {
          projectPath: nextProject,
          projectName,
          workspacePath,
          baseBranch:
            (p.baseBranch ?? (projectChanged ? null : existing.baseBranch)) ||
            info.defaultBase ||
            info.currentBranch ||
            undefined,
          ...(branchChanged ? { branch: nextBranch, branchExplicit: true } : {}),
          worktreePath: undefined,
          pushed: undefined,
          provisionedAt: undefined,
          launchedAt: undefined,
        }
      }
      updateTask(existing.id, {
        launchError: undefined,
        title: (p.title ?? '').trim() || `Task ${existing.id}`,
        description: p.description?.trim() || undefined,
        agentCli: p.agentCli,
        model: p.model || undefined,
        jevRoute: undefined,
        effort: p.effort,
        autoMode: p.autoMode,
        ...gitPatch,
      })
      return getState()
    },

    // The frontend says what to run (the task's agent, resumed or not, or a
    // plain shell); core builds the command. No channel accepts a command
    // string or a cwd, so a connected client cannot run anything else.
    'pty:start': async (payload) => {
      const p = obj<PtyStartPayload>(payload, 'payload')
      const requested = requireTask(p.taskId)
      const key = sessionKeyFor(requested.id, p.sessionKey)
      // Only a launch provisions; a shell asked for meanwhile waits for it. A
      // shell must never fall back to the project checkout — work done there
      // would land on whatever branch the project has out.
      const pending = provisioning.get(requested.id)
      const task = p.launch ? await ensureProvisioned(requested) : pending ? await pending : requested
      const cwd = task.worktreePath
      if (!cwd) throw new Error('任務尚未開始執行，還沒有 worktree')
      let command: string | undefined
      let fresh = p.fresh === true
      if (p.launch) {
        const intent = obj<LaunchIntent>(p.launch, 'launch')
        // An agent that is still running (tmux kept it through a restart) is
        // re-attached, not restarted with --resume on top of itself.
        if (intent.resume && (await sessions.isAlive(key))) {
          fresh = false
        } else {
          command = (await launchCommand(task, intent)).replace(/\r$/, '')
        }
      }
      const result = await sessions.start(key, {
        cwd,
        command,
        fresh,
        cols: typeof p.cols === 'number' ? p.cols : undefined,
        rows: typeof p.rows === 'number' ? p.rows : undefined,
        // Session ended (natural exit included), so stop its watcher.
        onExit: () => unwatchSubAgents(key),
      })
      watchSubAgents(key, cwd, (subAgents) => {
        bus.emit('subagents:update', { taskId: task.id, subAgents })
      })
      // Only the card's own launch decides what run is being followed; a
      // shell tab must not retarget it.
      if (p.launch) {
        const current = findTask(task.id)
        if (current) trackProgress(current)
      }
      return result
    },

    'terminal:start': async (payload) => {
      const p = obj<StandaloneTerminalPayload>(payload, 'payload')
      const key = str(p.sessionKey, 'sessionKey')
      if (!/^terminal_[0-9a-f-]{36}$/.test(key)) invalid('invalid standalone terminal key')
      if (Boolean(p.taskId) === Boolean(p.projectPath)) invalid('provide taskId or projectPath')
      const cwd = str(p.taskId ? requireTask(p.taskId).projectPath : p.projectPath, 'projectPath')
      if (!path.isAbsolute(cwd) || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
        invalid('projectPath must be an existing absolute directory')
      }
      const previous = standaloneTerminals.get(key)
      if (previous && previous !== cwd) invalid('terminal key already belongs to another directory')
      const result = await sessions.start(key, {
        cwd,
        cols: typeof p.cols === 'number' ? p.cols : undefined,
        rows: typeof p.rows === 'number' ? p.rows : undefined,
      })
      standaloneTerminals.set(key, cwd)
      if (!p.taskId) recordRecentProject(getStore(), cwd)
      return result
    },

    // Join a session as it is: no restart, for a frontend that attaches
    // after it started (the TUI's terminal view).
    'pty:peek': async (sessionKey) => {
      const key = requireSessionKey(sessionKey)
      return { alive: await sessions.isAlive(key), scrollback: sessions.scrollback(key) }
    },

    'pty:input': (payload) => {
      const p = obj<{ sessionKey: unknown; data: unknown }>(payload, 'payload')
      sessions.write(requireSessionKey(p.sessionKey), str(p.data, 'data'))
    },

    'pty:resize': (payload) => {
      const p = obj<{ sessionKey: unknown; cols: unknown; rows: unknown }>(payload, 'payload')
      if (typeof p.cols !== 'number' || typeof p.rows !== 'number') invalid('cols/rows must be numbers')
      sessions.resize(requireSessionKey(p.sessionKey), p.cols, p.rows)
    },

    'pty:kill': (sessionKey) => teardownSession(requireSessionKey(sessionKey)),

    // History a frontend cannot scroll itself (tmux copy-mode).
    'pty:scrolled': (sessionKey) => sessions.isScrolledBack(requireSessionKey(sessionKey)),
    'pty:scroll-bottom': (sessionKey) => sessions.scrollToBottom(requireSessionKey(sessionKey)),

    // Does the task's pinned Claude conversation exist on disk? Used to decide
    // whether selecting a task may auto-resume (session present) or should
    // leave the interactive terminal for manual commands.
    'claude:sessionExists': (taskId) => {
      const task = requireTask(taskId)
      if (!task.worktreePath) return false
      return fs.existsSync(claudeSessionFile(task.worktreePath, executorSessionId(task.id, task.runId)))
    },

    'sessions:list': async () => {
      const keys = await sessions.list()
      return { backend: sessions.kind, sessions: keys }
    },

    'git:getDiff': (taskId) => {
      const task = requireTask(taskId)
      if (!task.worktreePath) return []
      return getWorktreeDiff(task.worktreePath, task.baseBranch ?? 'HEAD')
    },

    /**
     * Changed-file list without content — cheap enough for the sidebar to poll.
     * The renderer passes `fetch: false` when polling so a 3s tick never hits the
     * network; the manual refresh button omits it to get a full remote refresh.
     */
    'git:getDiffEntries': (taskId, opts) => {
      const task = requireTask(taskId)
      if (!task.worktreePath) return []
      const fetch = opts && typeof opts === 'object' ? (opts as { fetch?: unknown }).fetch : undefined
      return getWorktreeDiffEntries(task.worktreePath, task.baseBranch ?? 'HEAD', {
        fetch: typeof fetch === 'boolean' ? fetch : undefined,
      })
    },

    'git:getDiffFile': (taskId, filePath) => {
      const task = requireTask(taskId)
      if (!task.worktreePath) return null
      return getWorktreeDiffFile(task.worktreePath, task.baseBranch ?? 'HEAD', str(filePath, 'filePath'))
    },

    'task:listArtifacts': (taskId) => {
      const task = requireTask(taskId)
      if (!task.worktreePath || !task.workspacePath) return []
      return listArtifacts(agentArtifactsPath(task.workspacePath, task.worktreePath))
    },

    'task:readArtifact': (taskId, name) => {
      const task = requireTask(taskId)
      if (!task.worktreePath || !task.workspacePath) return null
      return readArtifact(agentArtifactsPath(task.workspacePath, task.worktreePath), str(name, 'name'))
    },

    /**
     * Reveal the task's artifact directory in the OS file manager. Returns an
     * error string (empty when it opened) so the UI can say why nothing happened.
     */
    'task:openArtifactsDir': async (taskId) => {
      const task = requireTask(taskId)
      if (!task.worktreePath || !task.workspacePath) return 'task has no worktree'
      const dir = agentArtifactsPath(task.workspacePath, task.worktreePath)
      if (!fs.existsSync(dir)) return 'artifacts directory does not exist yet'
      return getPlatform().openPath(dir)
    },

    'task:getSpecs': async (taskId) => {
      const task = requireTask(taskId)
      const base = task.baseBranch ?? 'main'
      if (task.worktreePath) return readWorktreeSpecs(task.worktreePath, base)
      // Never provisioned: the branch is only a name, there is nothing to read.
      // Cards from before provisionedAt existed: an app card was provisioned
      // when it launched; a CLI card in a later column at creation, which is
      // what a recorded `pushed` (set only by provisioning) says happened.
      const since =
        task.provisionedAt ??
        task.launchedAt ??
        (task.pushed !== undefined ? task.createdAt : undefined)
      if (!task.projectPath || !since) return []
      const changed = task.outcome?.files.filter((f) => f.status !== 'D').map((f) => f.path)
      return readBranchSpecs(task.projectPath, task.branch, base, changed, since)
    },

    'board:getCliLaunchInfo': () => boardCliLaunchInfo(),

    'library:list': async () => listLibrary(await libraryRoot(), builtinSkillsDir()),
    // The source path was picked by the user (native picker or typed path).
    'library:import': async (payload) => {
      const p = obj<{ kind: unknown; sourcePath: unknown }>(payload, 'payload')
      return importLibraryEntry(await libraryRoot(), libraryKind(p.kind), str(p.sourcePath, 'sourcePath'))
    },
    'library:create': async (payload) => {
      const p = obj<{ kind: unknown; name: unknown; content: unknown; description?: unknown }>(payload, 'payload')
      return createLibraryEntry(
        await libraryRoot(),
        libraryKind(p.kind),
        str(p.name, 'name'),
        str(p.content, 'content'),
        p.description === undefined ? undefined : str(p.description, 'description')
      )
    },
    'library:read': async (payload) => {
      const p = obj<{ kind: unknown; name: unknown }>(payload, 'payload')
      return readLibraryEntry(await libraryRoot(), libraryKind(p.kind), str(p.name, 'name'))
    },
    'library:update': async (payload) => {
      const p = obj<{ kind: unknown; name: unknown; content: unknown }>(payload, 'payload')
      return updateLibraryEntry(await libraryRoot(), libraryKind(p.kind), str(p.name, 'name'), str(p.content, 'content'))
    },
    'library:setDescription': async (payload) => {
      const p = obj<{ kind: unknown; name: unknown; description: unknown }>(payload, 'payload')
      setLibraryEntryDescription(await libraryRoot(), libraryKind(p.kind), str(p.name, 'name'), str(p.description, 'description'))
      return true
    },
    'library:setEnabled': async (payload) => {
      const p = obj<{ kind: unknown; name: unknown; enabled: unknown }>(payload, 'payload')
      setLibraryEntryEnabled(await libraryRoot(), libraryKind(p.kind), str(p.name, 'name'), p.enabled === true)
      return true
    },
    'library:delete': async (payload) => {
      const p = obj<{ kind: unknown; name: unknown }>(payload, 'payload')
      deleteLibraryEntry(await libraryRoot(), libraryKind(p.kind), str(p.name, 'name'))
      return true
    },
    'library:restoreBuiltin': async (payload) => {
      const p = obj<{ name: unknown }>(payload, 'payload')
      return restoreBuiltinSkill(await libraryRoot(), builtinSkillsDir(), str(p.name, 'name'))
    },
    'library:removedBuiltins': async () =>
      removedBuiltinSkills(await libraryRoot(), builtinSkillsDir()),

    // Approve: commit everything in the worktree and push the branch upstream.
    'git:approve': async (payload) => {
      const p = obj<{ taskId: unknown; message: unknown }>(payload, 'payload')
      const task = requireTask(p.taskId)
      if (!task.worktreePath) throw new Error('找不到此任務的 worktree')
      const result = await commitAndPush(task.worktreePath, str(p.message, 'message'))
      if (result.pushed) updateTask(task.id, { pushed: true })
      return { result, state: getState() }
    },

    'git:generateCommitMessage': (taskId) => {
      const task = requireTask(taskId)
      if (!task.worktreePath) throw new Error('找不到此任務的 worktree')
      return generateCommitMessage(task.worktreePath, task.baseBranch ?? 'main', task.agentCli ?? 'claude')
    },

    'git:getPrStatus': (taskId) => {
      const task = requireTask(taskId)
      if (!task.worktreePath) return null
      return getPrStatus(task.worktreePath)
    },

    'git:getGithubCompareUrl': (taskId) => {
      const task = requireTask(taskId)
      if (!task.worktreePath) return null
      return getGithubCompareUrl(task.worktreePath, task.baseBranch ?? 'main')
    },

    // One dialog at a time: a second click while it is open joins it instead
    // of stacking another window on the host.
    'dialog:pickFolder': (options) => {
      const o = options === undefined || options === null ? {} : obj<{ title?: unknown; defaultPath?: unknown }>(options, 'options')
      const title = o.title === undefined ? undefined : str(o.title, 'title')
      const defaultPath = o.defaultPath === undefined ? undefined : str(o.defaultPath, 'defaultPath')
      const pick = getPlatform().pickFolder
      if (!pick) return { unsupported: true } satisfies PickFolderResult
      folderDialog ??= pick({ title, defaultPath: defaultPath || undefined }).finally(() => {
        folderDialog = null
      })
      return folderDialog
    },

    'shell:openExternal': (url) => {
      const u = str(url, 'url')
      // Only web links: this opens whatever handler the OS has for the scheme.
      if (!/^https?:\/\//i.test(u)) invalid('only http(s) URLs can be opened')
      return getPlatform().openExternal(u)
    },

    // Cleanup: finalize a card moved to Done. Tear down the PTY, remove the
    // worktree, delete the local branch, then bring the main working tree back to
    // the task's base branch and fast-forward it. Git sync steps are best-effort.
    'vibeflow:cleanupTask': async (taskId) => {
      const task = requireTask(taskId)
      await teardownTask(task.id)
      cancelChatSend(task.id)
      // Snapshot what the branch changed before the worktree that holds it is
      // removed, so a done card can still account for the work.
      let outcome: TaskOutcome | undefined
      if (task.worktreePath) {
        outcome = (await captureTaskOutcome(task.worktreePath, task.baseBranch ?? 'main')) ?? undefined
      }
      // Last read of the run's transcripts while the worktree they are keyed by still exists.
      const usage = usageThroughCurrentRun(task)
      progress.untrack(task.id)
      if (task.projectPath && task.worktreePath) {
        await removeTaskWorktree(task)
        await syncBaseBranch(task.projectPath, task.baseBranch ?? 'main')
      }
      // Only write the outcome when this call actually captured one. Completing
      // an already-completed card (done -> in_progress -> done) has no worktree
      // left to read, and must not blank the snapshot taken the first time.
      updateTask(task.id, {
        worktreePath: undefined,
        ...(outcome ? { outcome } : {}),
        ...(usage ? { usage } : {}),
      })
      return getState()
    },

    // Delete: cleanup (PTY + worktree) AND drop the card from the board.
    'vibeflow:deleteTask': async (taskId) => {
      const task = requireTask(taskId)
      await teardownTask(task.id)
      progress.untrack(task.id)
      cancelChatSend(task.id)
      if (task.workspacePath) {
        deleteDecisions(task.workspacePath, decisionsKey(task.worktreePath, task.branch))
      }
      await removeTaskWorktree(task)
      if (task.workspacePath) {
        fs.rmSync(taskAttachmentStagingPath(task.workspacePath, task.id), { recursive: true, force: true })
      }
      clearConversation(task.id)
      removeTask(task.id)
      return getState()
    },

    'attachments:write': (payload) => {
      const p = obj<{ taskId: unknown; attachments: unknown }>(payload, 'payload')
      const task = requireTask(p.taskId)
      if (!Array.isArray(p.attachments)) invalid('attachments must be an array')
      const inputs = p.attachments as AttachmentInput[]
      if (task.worktreePath) return writeAttachments(task.worktreePath, inputs)
      if (!task.workspacePath) throw new Error('找不到任務 worktree')
      return writeAttachmentsTo(taskAttachmentStagingPath(task.workspacePath, task.id), inputs)
    },

    'chat:load': (taskId) => loadConversation(requireTask(taskId).id),
    'chat:cancel': (taskId) => {
      cancelChatSend(requireTask(taskId).id)
    },
    'chat:send': (payload) => {
      const p = obj<ChatSendPayload>(payload, 'payload')
      const task = requireTask(p.taskId)
      if (!task.worktreePath) throw new Error('找不到任務 worktree')
      startChatSend(
        {
          taskId: task.id,
          worktreePath: task.worktreePath,
          workspacePath: task.workspacePath,
          text: str(p.text, 'text'),
          attachments: p.attachments,
          sessionId: str(p.sessionId, 'sessionId'),
          resume: p.resume === true,
          systemPrompt: str(p.systemPrompt ?? '', 'systemPrompt'),
          agentCli: task.agentCli,
          model: str(p.model ?? '', 'model'),
        },
        sink
      )
    },
    'chat:compact': (taskId) => {
      const newSessionId = randomUUID()
      clearMessages(requireTask(taskId).id, newSessionId)
      return { newSessionId }
    },
  }

  let storeWatcher: fs.FSWatcher | null = null

  return {
    handlers,
    bus,
    sessions,
    // Watch the containing directory, not the file: JsonStore renames a temp
    // file over the target and so replaces the inode on every save.
    watchStore() {
      const file = path.basename(getStorePath())
      let debounce: ReturnType<typeof setTimeout> | null = null
      storeWatcher = fs.watch(path.dirname(getStorePath()), (_event, filename) => {
        if (filename !== file) return
        if (debounce) clearTimeout(debounce)
        debounce = setTimeout(() => {
          try {
            bus.emit('state:changed', getState() satisfies VibeFlowState)
          } catch {
            // A half-visible rename on some filesystems; the next event retries.
          }
        }, 200)
      })
      return () => storeWatcher?.close()
    },
    warmModelCatalog() {
      models.warm()
    },
    shutdown() {
      cancelJiraLogin()
      sessions.shutdown()
      cancelAllChatSends()
      unwatchAllSubAgents()
      progress.untrackAll()
      storeWatcher?.close()
    },
  }
}
