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
import { projectWorkstationPath } from './workspace'
import { AGENT_EFFORTS, detectAgents, type AgentCliId, type AgentEffort } from './agents'
import { listAgentModels } from './agent-models'
import {
  cancelGitHubCliLogin,
  getGitHubCliAuthStatus,
  logoutGitHubCli,
  startGitHubCliLogin,
} from './github-auth'
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
  initRepository,
  provisionWorktree,
  removeWorktree,
  resetWorktreeToBase,
  syncBaseBranch,
} from './git'
import { createTaskFromInput } from './tasks'
import { listRecentProjects, recordRecentProject } from './recent-projects'
import { boardCliLaunchInfo } from './board-cli'
import { decisionsKey, deleteDecisions } from './decisions'
import { readBranchSpecs, readWorktreeSpecs } from './specs'
import { agentArtifactsPath, deleteArtifacts, listArtifacts, readArtifact } from './artifacts'
import { resetSubAgents, unwatchAllSubAgents, unwatchSubAgents, watchSubAgents } from './subagents'
import { cancelAllChatSends, cancelChatSend, startChatSend } from './chat-session'
import { clearConversation, clearMessages, loadConversation } from './chat-store'
import { writeAttachments, type AttachmentInput } from './attachments'
import {
  createEntry as createLibraryEntry,
  deleteEntry as deleteLibraryEntry,
  importEntry as importLibraryEntry,
  libraryLaunchInfo,
  libraryRoot,
  listLibrary,
  readEntryContent as readLibraryEntry,
  setEntryDescription as setLibraryEntryDescription,
  setEntryEnabled as setLibraryEntryEnabled,
  updateEntry as updateLibraryEntry,
  type LibraryKind,
} from './library'
import { builtinSkillsDir, removedBuiltinSkills, restoreBuiltinSkill } from './library-builtins'
import { buildAgentCommand, executorSessionId } from './launch'
import { EventBus } from './events'
import type { SessionBackend } from './session-backend'
import { getPlatform } from './platform'

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
  /** Stop every watcher and child this core started. Sessions follow the backend's shutdown rule. */
  shutdown(): void
}

/**
 * Build the core: one handler per channel in IPC_API_MAP.md, all taking task
 * ids rather than paths or commands, and all events on one bus.
 */
export function createCore({ sessions, bus, version }: CoreOptions): Core {
  const sink = bus.sink()

  async function teardownSession(key: string): Promise<void> {
    await sessions.kill(key)
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

  /** Session keys belong to known tasks. */
  function requireSessionKey(sessionKey: unknown): string {
    const key = str(sessionKey, 'sessionKey')
    requireTask(key.split(':')[0])
    return key
  }

  async function launchCommand(task: Task, intent: LaunchIntent): Promise<string> {
    const settings = getSettings()
    const library = await libraryLaunchInfo(task.worktreePath)
    const boardCli = await boardCliLaunchInfo()
    return buildAgentCommand(
      task,
      settings.systemPrompt ?? '',
      {
        resume: intent.resume === true,
        includeTaskPrompt: intent.includeTaskPrompt !== false,
        library: library ?? undefined,
        boardCli,
        autoMode: task.autoMode ?? settings.autoMode,
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

  const handlers: CoreHandlers = {
    'vibeflow:getState': () => getState(),
    'app:getVersion': () => version,

    'vibeflow:setBoard': (board) => {
      setBoard(validBoard(board))
      return getState()
    },

    'vibeflow:setSettings': (patch) => {
      setSettings(obj<Partial<AppSettings>>(patch, 'patch'))
      return getState()
    },

    'settings:githubAuthStatus': () => getGitHubCliAuthStatus(),
    'settings:startGithubAuthLogin': () => {
      startGitHubCliLogin((payload) => bus.emit('github-auth:event', payload))
    },
    'settings:cancelGithubAuthLogin': () => {
      cancelGitHubCliLogin()
    },
    'settings:logoutGithubAuth': () => logoutGitHubCli(),

    'env:detectAgents': () => detectAgents(),

    'agents:listModels': (payload) => {
      const { agentId: rawId, refresh } = obj<{ agentId: unknown; refresh?: unknown }>(payload, 'payload')
      return listAgentModels(agentId(rawId), { refresh: refresh === true })
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
      })
      return { state: getState(), task }
    },

    'vibeflow:removeTask': (taskId) => {
      removeTask(requireTask(taskId).id)
      return getState()
    },

    // Discard everything the last run left behind — the PTY session, the
    // sub-agent timeline, the conversation id, the code it changed, its artifacts
    // and its legacy decision record — so the next launch starts over as if the card
    // were new. Launching again is the caller's decision.
    'vibeflow:resetTaskRun': async (taskId) => {
      const task = requireTask(taskId)
      if (!task.worktreePath) throw new Error('任務沒有可用的 worktree')
      if (!task.baseBranch) throw new Error('任務沒有記錄 base branch，無法還原 worktree')
      await teardownTask(task.id)
      await resetWorktreeToBase(task.worktreePath, task.baseBranch)
      const workspacePath = task.workspacePath ?? path.dirname(task.worktreePath)
      deleteArtifacts(workspacePath, task.worktreePath)
      deleteDecisions(workspacePath, decisionsKey(task.worktreePath, task.branch))
      resetSubAgents(task.worktreePath)
      updateTask(task.id, { launchedAt: Date.now(), runId: randomUUID() })
      const reset = findTask(task.id)
      if (!reset) throw new Error('找不到要重置的任務')
      bus.emit('subagents:update', { taskId: task.id, subAgents: [] })
      return { state: getState(), task: reset }
    },

    // Edit an existing card's fields. Most are plain metadata read at launch time
    // (title / description / agent / model / workspace). The project folder
    // and base branch are git-bound: re-selecting them rebuilds the worktree, which
    // is only allowed for not-yet-launched tasks (no work to lose).
    'vibeflow:updateTask': async (payload) => {
      const p = obj<UpdateTaskPayload>(payload, 'payload')
      const existing = requireTask(p.taskId)
      let gitPatch: Partial<Task> = {}
      const nextProject = p.projectPath || existing.projectPath
      const projectChanged = Boolean(p.projectPath && p.projectPath !== existing.projectPath)
      const baseChanged = p.baseBranch != null && p.baseBranch !== (existing.baseBranch ?? null)
      if (nextProject && (projectChanged || baseChanged)) {
        if (existing.launchedAt) {
          throw new Error('任務已開始執行，無法更換專案資料夾或基準分支')
        }
        if (existing.worktreePath) {
          // Only the count matters here, so use the entry list — it reads no
          // blob content and skips the network fetch.
          const diff = await getWorktreeDiffEntries(
            existing.worktreePath,
            existing.baseBranch ?? 'HEAD',
            { fetch: false }
          )
          if (diff.length > 0) {
            throw new Error('目前 worktree 已有變更，無法更換專案資料夾或基準分支')
          }
        }
        const info = await getGitInfo(nextProject)
        if (!info.isRepo) throw new Error('目標資料夾不是 git repository')
        // Tear down the old (empty) worktree before rebuilding on the target.
        await teardownTask(existing.id)
        await removeTaskWorktree(existing)
        const projectName = path.basename(nextProject)
        const workspacePath = projectWorkstationPath(resolveWorkstationPath(getSettings()), projectName)
        await fs.promises.mkdir(workspacePath, { recursive: true })
        const result = await provisionWorktree(
          nextProject,
          workspacePath,
          existing.id,
          p.baseBranch ?? existing.baseBranch ?? null,
          existing.branch
        )
        recordRecentProject(getStore(), nextProject)
        gitPatch = {
          projectPath: nextProject,
          projectName,
          branch: result.branch,
          worktreePath: result.worktreePath,
          workspacePath,
          baseBranch: result.baseBranch,
          pushed: result.pushed,
        }
      }
      updateTask(existing.id, {
        title: (p.title ?? '').trim() || `Task ${existing.id}`,
        description: p.description?.trim() || undefined,
        agentCli: p.agentCli,
        model: p.model || undefined,
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
      const task = requireTask(p.taskId)
      const key = sessionKeyFor(task.id, p.sessionKey)
      const cwd = task.worktreePath ?? task.projectPath
      if (!cwd) throw new Error('任務沒有可用的工作目錄')
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
      if (!task.projectPath) return []
      const changed = task.outcome?.files.filter((f) => f.status !== 'D').map((f) => f.path)
      return readBranchSpecs(task.projectPath, task.branch, base, changed)
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
      if (task.projectPath && task.worktreePath) {
        await removeTaskWorktree(task)
        await syncBaseBranch(task.projectPath, task.baseBranch ?? 'main')
      }
      // Only write the outcome when this call actually captured one. Completing
      // an already-completed card (done -> in_progress -> done) has no worktree
      // left to read, and must not blank the snapshot taken the first time.
      updateTask(task.id, outcome ? { worktreePath: undefined, outcome } : { worktreePath: undefined })
      return getState()
    },

    // Delete: cleanup (PTY + worktree) AND drop the card from the board.
    'vibeflow:deleteTask': async (taskId) => {
      const task = requireTask(taskId)
      await teardownTask(task.id)
      cancelChatSend(task.id)
      if (task.workspacePath) {
        deleteDecisions(task.workspacePath, decisionsKey(task.worktreePath, task.branch))
      }
      await removeTaskWorktree(task)
      clearConversation(task.id)
      removeTask(task.id)
      return getState()
    },

    'attachments:write': (payload) => {
      const p = obj<{ taskId: unknown; attachments: unknown }>(payload, 'payload')
      const task = requireTask(p.taskId)
      if (!task.worktreePath) throw new Error('找不到任務 worktree')
      if (!Array.isArray(p.attachments)) invalid('attachments must be an array')
      return writeAttachments(task.worktreePath, p.attachments as AttachmentInput[])
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
    shutdown() {
      sessions.shutdown()
      cancelAllChatSends()
      unwatchAllSubAgents()
      storeWatcher?.close()
    },
  }
}
