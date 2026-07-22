import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import type {
  AppSettings,
  BoardState,
  ConnectableAgentId,
  Role,
  Task,
  VibeFlowState,
} from './helpers/store'
import type { AgentCli, AgentCliId } from './helpers/agents'
import type { DiffFile, FinalizeResult, GitInfo, PrStatus } from './helpers/git'
import type { TaskProgress } from './helpers/progress'
import type {
  MemoryCheckpoint,
  MemoryLaunchInfo,
  MemoryTaskLink,
  RelatedTask,
} from './helpers/memory'
import type { SubAgentRun } from './helpers/subagents'
import type { ChatAttachment, Conversation } from './helpers/chat-store'
import type { AttachmentInput } from './helpers/attachments'
import type { ChatChunk, ChatPhase } from './helpers/chat-session'
import type {
  GitHubCliAuthEvent,
  GitHubCliAuthStatus,
} from './helpers/github-auth'
import type { RemoteUpdateSnapshot } from './helpers/remote-update'

const handler = {
  send<T>(channel: string, value?: T) {
    ipcRenderer.send(channel, value)
  },
  on<T>(channel: string, callback: (...args: T[]) => void) {
    const subscription = (_event: IpcRendererEvent, ...args: T[]) =>
      callback(...args)
    ipcRenderer.on(channel, subscription)

    return () => {
      ipcRenderer.removeListener(channel, subscription)
    }
  },
}

contextBridge.exposeInMainWorld('ipc', handler)

export type IpcHandler = typeof handler

// Typed VibeFlow domain API backed by ipcRenderer.invoke <-> ipcMain.handle.
const vibeflow = {
  getState: (): Promise<VibeFlowState> =>
    ipcRenderer.invoke('vibeflow:getState'),
  /** Running app version (package.json version baked into the build). */
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),
  /** Restart the app — picks up a newer build installed over the bundle. */
  relaunch: (): Promise<void> => ipcRenderer.invoke('app:relaunch'),
  /** Fired once when a newer build has replaced the running bundle on disk. */
  onUpdateAvailable: (callback: () => void): (() => void) => {
    const sub = () => callback()
    ipcRenderer.on('update:available', sub)
    return () => ipcRenderer.removeListener('update:available', sub)
  },
  getRemoteUpdateState: (): Promise<RemoteUpdateSnapshot> =>
    ipcRenderer.invoke('remote-update:getState'),
  checkForRemoteUpdate: (): Promise<RemoteUpdateSnapshot> =>
    ipcRenderer.invoke('remote-update:check'),
  downloadRemoteUpdate: (): Promise<RemoteUpdateSnapshot> =>
    ipcRenderer.invoke('remote-update:download'),
  installRemoteUpdate: (): Promise<void> =>
    ipcRenderer.invoke('remote-update:install'),
  onRemoteUpdateState: (
    callback: (state: RemoteUpdateSnapshot) => void
  ): (() => void) => {
    const sub = (_event: IpcRendererEvent, state: RemoteUpdateSnapshot) => callback(state)
    ipcRenderer.on('remote-update:state', sub)
    return () => ipcRenderer.removeListener('remote-update:state', sub)
  },
  /**
   * Fired when an external write (e.g. CLI) changes the store backing file.
   * The main process debounces and emits the fresh state so the board can
   * refresh without restarting the app.
   */
  onStateChanged: (callback: (state: VibeFlowState) => void): (() => void) => {
    const sub = (_event: IpcRendererEvent, state: VibeFlowState) => callback(state)
    ipcRenderer.on('state:changed', sub)
    return () => ipcRenderer.removeListener('state:changed', sub)
  },
  setBoard: (board: BoardState): Promise<VibeFlowState> =>
    ipcRenderer.invoke('vibeflow:setBoard', board),
    setSettings: (patch: Partial<AppSettings>): Promise<VibeFlowState> =>
      ipcRenderer.invoke('vibeflow:setSettings', patch),
    connectAgent: (
      agentId: ConnectableAgentId,
      apiKey: string
    ): Promise<VibeFlowState> =>
      ipcRenderer.invoke('settings:connectAgent', { agentId, apiKey }),
    refreshAgentModels: (agentId: ConnectableAgentId): Promise<VibeFlowState> =>
      ipcRenderer.invoke('settings:refreshAgentModels', agentId),
    getGithubAuthStatus: (): Promise<GitHubCliAuthStatus> =>
      ipcRenderer.invoke('settings:githubAuthStatus'),
    startGithubAuthLogin: (): Promise<void> =>
      ipcRenderer.invoke('settings:startGithubAuthLogin'),
    cancelGithubAuthLogin: (): Promise<void> =>
      ipcRenderer.invoke('settings:cancelGithubAuthLogin'),
    logoutGithubAuth: (): Promise<GitHubCliAuthStatus> =>
      ipcRenderer.invoke('settings:logoutGithubAuth'),
    onGithubAuthEvent: (
      callback: (payload: GitHubCliAuthEvent) => void
    ): (() => void) => {
      const sub = (_event: IpcRendererEvent, payload: GitHubCliAuthEvent) => callback(payload)
      ipcRenderer.on('github-auth:event', sub)
      return () => ipcRenderer.removeListener('github-auth:event', sub)
    },
  /** Native folder picker — returns the chosen absolute path, or null. */
  pickFolder: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:pickFolder'),
  getGitInfo: (projectPath: string): Promise<GitInfo> =>
    ipcRenderer.invoke('git:getInfo', projectPath),
  /** Initialise a new git repository and return its GitInfo. */
  initRepository: (projectPath: string): Promise<GitInfo> =>
    ipcRenderer.invoke('git:initRepository', projectPath),
  /** Agent CLIs (claude / codex / gemini) actually installed on PATH. */
  detectAgents: (): Promise<AgentCli[]> =>
    ipcRenderer.invoke('env:detectAgents'),
  createTask: (payload: {
    title: string
    description?: string
    projectPath: string
    baseBranch: string | null
    mode?: 'existing' | 'new'
    agentCli?: AgentCliId
    model?: string
    executionAgentCli?: AgentCliId
    executionModel?: string
    roleId?: string
    attachments?: AttachmentInput[]
  }): Promise<{ state: VibeFlowState; task: Task }> =>
    ipcRenderer.invoke('vibeflow:createTask', payload),
  updateTask: (payload: {
    taskId: string
    title: string
    description?: string
    roleId?: string
    agentCli?: AgentCliId
    model?: string
    executionAgentCli?: AgentCliId
    executionModel?: string
    projectPath?: string
    baseBranch?: string | null
  }): Promise<VibeFlowState> =>
    ipcRenderer.invoke('vibeflow:updateTask', payload),

  // --- Roles ---
  createRole: (
    input: Omit<Role, 'id'>
  ): Promise<{ state: VibeFlowState; role: Role }> =>
    ipcRenderer.invoke('roles:create', input),
  updateRole: (
    roleId: string,
    patch: Partial<Role>
  ): Promise<VibeFlowState> =>
    ipcRenderer.invoke('roles:update', { roleId, patch }),
  removeRole: (roleId: string): Promise<VibeFlowState> =>
    ipcRenderer.invoke('roles:remove', roleId),

  removeTask: (taskId: string): Promise<VibeFlowState> =>
    ipcRenderer.invoke('vibeflow:removeTask', taskId),

  // Review & finalize (Phase 4).
  getDiff: (taskId: string): Promise<DiffFile[]> =>
    ipcRenderer.invoke('git:getDiff', taskId),
  /** Read the task's runtime PLAN.md artifact, when present. */
  getPlan: (taskId: string): Promise<string | null> =>
    ipcRenderer.invoke('task:getPlan', taskId),
  /** Convert PLAN.md to plan.html and return the HTML string. */
  getPlanHtml: (taskId: string): Promise<string | null> =>
    ipcRenderer.invoke('task:getPlanHtml', taskId),
  /** Agent-memory checkpoints for the task (keyed by branch name). */
  getCheckpoints: (taskId: string): Promise<MemoryCheckpoint[]> =>
    ipcRenderer.invoke('task:getCheckpoints', taskId),
  /** Built-in memory MCP server + unified db paths for launch injection. */
  getMemoryLaunchInfo: (): Promise<MemoryLaunchInfo> =>
    ipcRenderer.invoke('memory:getLaunchInfo'),
  /** FTS-similar prior tasks across the unified store. */
  getRelatedTasks: (taskId: string): Promise<RelatedTask[]> =>
    ipcRenderer.invoke('task:getRelatedTasks', taskId),
  /** Explicit task_links neighbours for the task. */
  getTaskLinks: (taskId: string): Promise<MemoryTaskLink[]> =>
    ipcRenderer.invoke('task:getTaskLinks', taskId),
  approve: (
    taskId: string,
    message: string
  ): Promise<{ result: FinalizeResult; state: VibeFlowState }> =>
    ipcRenderer.invoke('git:approve', { taskId, message }),
  /** Use the task's agent CLI to generate a commit message for branch changes. */
  generateCommitMessage: (taskId: string): Promise<string> =>
    ipcRenderer.invoke('git:generateCommitMessage', taskId),
  /** Check whether a PR exists for the task's branch. */
  getPrStatus: (taskId: string): Promise<PrStatus | null> =>
    ipcRenderer.invoke('git:getPrStatus', taskId),
  /** Get the GitHub compare URL for creating a new PR. */
  getGithubCompareUrl: (taskId: string): Promise<string | null> =>
    ipcRenderer.invoke('git:getGithubCompareUrl', taskId),
  /** Open a URL in the system default browser. */
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke('shell:openExternal', url),
  cleanupTask: (taskId: string): Promise<VibeFlowState> =>
    ipcRenderer.invoke('vibeflow:cleanupTask', taskId),
  /** Live task-progress updates pushed from main while a session runs. */
  onProgressUpdate: (
    callback: (payload: { taskId: string; progress: TaskProgress }) => void
  ): (() => void) => {
    const sub = (
      _event: IpcRendererEvent,
      payload: { taskId: string; progress: TaskProgress }
    ) => callback(payload)
    ipcRenderer.on('progress:update', sub)
    return () => ipcRenderer.removeListener('progress:update', sub)
  },
  /** Live sub-agent updates pushed from main while a session runs. */
  onSubAgentsUpdate: (
    callback: (payload: { taskId: string; subAgents: SubAgentRun[] }) => void
  ): (() => void) => {
    const sub = (
      _event: IpcRendererEvent,
      payload: { taskId: string; subAgents: SubAgentRun[] }
    ) => callback(payload)
    ipcRenderer.on('subagents:update', sub)
    return () => ipcRenderer.removeListener('subagents:update', sub)
  },
  deleteTask: (taskId: string): Promise<VibeFlowState> =>
    ipcRenderer.invoke('vibeflow:deleteTask', taskId),

  attachments: {
    write: (payload: {
      taskId: string
      attachments: AttachmentInput[]
    }): Promise<ChatAttachment[]> =>
      ipcRenderer.invoke('attachments:write', payload),
  },

  // Chat (structured output) bridge.
  chat: {
    load: (taskId: string): Promise<Conversation | null> =>
      ipcRenderer.invoke('chat:load', taskId),
    send: (payload: {
      taskId: string
      worktreePath: string
      text: string
      attachments?: AttachmentInput[]
      sessionId: string
      resume: boolean
      systemPrompt: string
      agentCli?: AgentCliId
      model: string
      workspacePath?: string
    }): Promise<void> => ipcRenderer.invoke('chat:send', payload),
    cancel: (taskId: string): Promise<void> =>
      ipcRenderer.invoke('chat:cancel', taskId),
    compact: (taskId: string): Promise<{ newSessionId: string }> =>
      ipcRenderer.invoke('chat:compact', taskId),
    onChunk: (callback: (chunk: ChatChunk) => void): (() => void) => {
      const sub = (_event: IpcRendererEvent, chunk: ChatChunk) => callback(chunk)
      ipcRenderer.on('chat:chunk', sub)
      return () => ipcRenderer.removeListener('chat:chunk', sub)
    },
    onPhase: (callback: (phase: ChatPhase) => void): (() => void) => {
      const sub = (_event: IpcRendererEvent, phase: ChatPhase) => callback(phase)
      ipcRenderer.on('chat:phase', sub)
      return () => ipcRenderer.removeListener('chat:phase', sub)
    },
  },

  // Interactive terminal bridge (Phase 3).
  term: {
    /** Start a PTY session. `sessionKey` defaults to `taskId`. */
    start: (
      taskId: string,
      cwd: string,
      command?: string,
      sessionKey?: string,
      cols?: number,
      rows?: number
    ): Promise<{ pid: number; scrollback: string | null }> =>
      ipcRenderer.invoke('pty:start', { taskId, cwd, command, sessionKey, cols, rows }),
    /** Send keystrokes to the session identified by `sessionKey`. */
    input: (sessionKey: string, data: string): void =>
      ipcRenderer.send('pty:input', { sessionKey, data }),
    /** Resize the session identified by `sessionKey`. */
    resize: (sessionKey: string, cols: number, rows: number): void =>
      ipcRenderer.send('pty:resize', { sessionKey, cols, rows }),
    /** Kill a task's PTY session (tears down the session and its watchers). */
    kill: (sessionKey: string): void => ipcRenderer.send('pty:kill', sessionKey),
    /** Whether a pinned Claude conversation already exists on disk for `cwd`. */
    sessionExists: (cwd: string, sessionId: string): Promise<boolean> =>
      ipcRenderer.invoke('claude:sessionExists', { cwd, sessionId }),
    /**
     * Data pushed from the PTY. The payload carries `sessionKey` to let the
     * renderer route output to the correct terminal pane.
     */
    onData: (
      callback: (payload: { sessionKey: string; data: string }) => void
    ): (() => void) => {
      const sub = (
        _event: IpcRendererEvent,
        payload: { sessionKey: string; data: string }
      ) => callback(payload)
      ipcRenderer.on('pty:data', sub)
      return () => ipcRenderer.removeListener('pty:data', sub)
    },
    /** Exit event pushed when a PTY session ends. Carries `sessionKey`. */
    onExit: (
      callback: (payload: {
        sessionKey: string
        exitCode: number
        intentional: boolean
      }) => void
    ): (() => void) => {
      const sub = (
        _event: IpcRendererEvent,
        payload: { sessionKey: string; exitCode: number; intentional: boolean }
      ) => callback(payload)
      ipcRenderer.on('pty:exit', sub)
      return () => ipcRenderer.removeListener('pty:exit', sub)
    },
  },
}

contextBridge.exposeInMainWorld('vibeflow', vibeflow)

export type VibeFlowApi = typeof vibeflow
