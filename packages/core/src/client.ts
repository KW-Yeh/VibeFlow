/*
 * The frontend API, the same for every transport. The browser builds it on a
 * WebSocket, and the TUI on an in-process call or a WebSocket. Frontends import this module at runtime, so it imports types only.
 */
import type {
  AppSettings,
  BoardState,
  Task,
  VibeFlowState,
} from './store'
import type { AgentCli, AgentCliId, AgentEffort } from './agents'
import type { AgentModelList } from './agent-models'
import type {
  DiffEntry,
  DiffFile,
  FinalizeResult,
  GitInfo,
  PrStatus,
} from './git'
import type { ArtifactContent, TaskArtifact } from './artifacts'
import type { BoardCliLaunchInfo } from './board-cli'
import type { TaskSpec } from './specs'
import type { RecentProjectEntry } from './recent-projects'
import type { SubAgentRun } from './subagents'
import type { ProgressNotification, TaskProgress } from './progress'
import type { ChatAttachment, Conversation } from './chat-store'
import type { AttachmentInput } from './attachments'
import type { PickFolderOptions, PickFolderResult } from './folder-dialog'
import type {
  LibraryEntry,
  LibraryKind,
} from './library'
import type { ChatChunk, ChatPhase } from './chat-session'
import type {
  GitHubCliAuthEvent,
  GitHubCliAuthStatus,
} from './github-auth'
import type { GithubInbox, GithubRef, GithubTaskLinks } from './github'
import type { JiraInbox, JiraRef } from './jira'
import type { JiraAuthEvent, JiraAuthStatus } from './jira-auth'
import type { LaunchIntent } from './service'
import type { StartResult } from './session-backend'

export interface ProgressUpdatePayload {
  taskId: string
  progress: TaskProgress
}

export interface ProgressNotifyPayload {
  taskId: string
  /** The card's title when it was announced. */
  title: string
  notifications: ProgressNotification[]
}

export interface AvailableUpdate {
  currentVersion: string
  latestVersion: string
}

/** How a frontend reaches core. `invoke` answers; `send` is fire-and-forget. */
export interface BridgeTransport {
  /** `ws` = browser or a remote TUI, `local` = same process. */
  readonly kind: 'ws' | 'local'
  invoke<T>(channel: string, ...args: unknown[]): Promise<T>
  send(channel: string, ...args: unknown[]): void
  /** Subscribe to an event channel; returns the unsubscribe. */
  on(channel: string, callback: (payload: unknown) => void): () => void
}

export function createBridge(t: BridgeTransport) {
  return {
    transport: t.kind,
  getState: (): Promise<VibeFlowState> =>
    t.invoke('vibeflow:getState'),
  /** Running app version (package.json version baked into the build). */
  getVersion: (): Promise<string> => t.invoke('app:getVersion'),
  getUpdateStatus: (): Promise<AvailableUpdate | null> => t.invoke('host:updateStatus'),
  onUpdateAvailable: (callback: (update: AvailableUpdate | null) => void): (() => void) =>
    t.on('update:available', (payload) => callback(payload as AvailableUpdate | null)),
  /**
   * Fired when an external write (e.g. CLI) changes the store backing file.
   * The main process debounces and emits the fresh state so the board can
   * refresh without restarting the app.
   */
  onStateChanged: (callback: (state: VibeFlowState) => void): (() => void) => {
    return t.on('state:changed', (payload) => callback(payload as never))
  },
  setBoard: (board: BoardState): Promise<VibeFlowState> =>
    t.invoke('vibeflow:setBoard', board),
    setSettings: (patch: Partial<AppSettings>): Promise<VibeFlowState> =>
      t.invoke('vibeflow:setSettings', patch),
    getGithubAuthStatus: (): Promise<GitHubCliAuthStatus> =>
      t.invoke('settings:githubAuthStatus'),
    startGithubAuthLogin: (): Promise<void> =>
      t.invoke('settings:startGithubAuthLogin'),
    cancelGithubAuthLogin: (): Promise<void> =>
      t.invoke('settings:cancelGithubAuthLogin'),
    logoutGithubAuth: (): Promise<GitHubCliAuthStatus> =>
      t.invoke('settings:logoutGithubAuth'),
    /** Open Issues/PRs of the board's GitHub repos that involve me; cached unless `force`. */
    getGithubInbox: (opts?: { force?: boolean }): Promise<GithubInbox> =>
      t.invoke('github:inbox', opts ?? {}),
    getJiraAuthStatus: (): Promise<JiraAuthStatus> => t.invoke('jira:authStatus'),
    startJiraAuthLogin: (): Promise<void> => t.invoke('settings:startJiraAuthLogin'),
    cancelJiraAuthLogin: (): Promise<void> => t.invoke('settings:cancelJiraAuthLogin'),
    inputJiraAuthLogin: (input: string): Promise<void> => t.invoke('settings:inputJiraAuthLogin', input),
    logoutJiraAuth: (): Promise<JiraAuthStatus> => t.invoke('settings:logoutJiraAuth'),
    onJiraAuthEvent: (callback: (event: JiraAuthEvent) => void): (() => void) =>
      t.on('jira-auth:event', (event) => callback(event as JiraAuthEvent)),
    getJiraInbox: (opts?: { force?: boolean }): Promise<JiraInbox> => t.invoke('jira:inbox', opts ?? {}),
    /** The Issue/PR each card belongs to, keyed by task id. */
    getGithubTaskLinks: (opts?: { force?: boolean }): Promise<Record<string, GithubTaskLinks>> =>
      t.invoke('github:taskLinks', opts ?? {}),
    onGithubAuthEvent: (
      callback: (payload: GitHubCliAuthEvent) => void
    ): (() => void) => {
      return t.on('github-auth:event', (payload) => callback(payload as never))
    },
  getGitInfo: (projectPath: string): Promise<GitInfo> =>
    t.invoke('git:getInfo', projectPath),
  /** Recently used project folders, each flagged when it no longer exists. */
  listRecentProjects: (): Promise<RecentProjectEntry[]> =>
    t.invoke('projects:listRecent'),
  /** Initialise a new git repository and return its GitInfo. */
  initRepository: (projectPath: string): Promise<GitInfo> =>
    t.invoke('git:initRepository', projectPath),
  /** Agent CLIs (claude / codex) actually installed on PATH. */
  detectAgents: (): Promise<AgentCli[]> =>
    t.invoke('env:detectAgents'),
  /** Models the agent's own CLI offers; `refresh` asks the CLI instead of its cache. */
  listAgentModels: (agentId: AgentCliId, refresh = false): Promise<AgentModelList> =>
    t.invoke('agents:listModels', { agentId, refresh }),
  createTask: (payload: {
    title: string
    description?: string
    projectPath: string
    baseBranch: string | null
    branch?: string
    mode?: 'existing' | 'new'
    agentCli?: AgentCliId
    model?: string
    effort?: AgentEffort
    autoMode?: boolean
    attachments?: AttachmentInput[]
    github?: GithubRef
    jira?: JiraRef
  }): Promise<{ state: VibeFlowState; task: Task }> =>
    t.invoke('vibeflow:createTask', payload),
  updateTask: (payload: {
    taskId: string
    title: string
    description?: string
    agentCli?: AgentCliId
    model?: string
    effort?: AgentEffort
    autoMode?: boolean
    projectPath?: string
    baseBranch?: string | null
    branch?: string
  }): Promise<VibeFlowState> =>
    t.invoke('vibeflow:updateTask', payload),
  /** Clear prior execution state and prepare a fresh run of this task. */
  resetTaskRun: (
    taskId: string
  ): Promise<{ state: VibeFlowState; task: Task }> =>
    t.invoke('vibeflow:resetTaskRun', taskId),

  removeTask: (taskId: string): Promise<VibeFlowState> =>
    t.invoke('vibeflow:removeTask', taskId),

  // Review & finalize (Phase 4).
  /** Full diff with content for every changed file — backs the full-screen view. */
  getDiff: (taskId: string): Promise<DiffFile[]> =>
    t.invoke('git:getDiff', taskId),
  /** Changed-file list without content. Pass `{ fetch: false }` when polling. */
  getDiffEntries: (taskId: string, opts?: { fetch?: boolean }): Promise<DiffEntry[]> =>
    t.invoke('git:getDiffEntries', taskId, opts),
  /** Content for one changed file, loaded when its row is expanded. */
  getDiffFile: (taskId: string, filePath: string): Promise<DiffFile | null> =>
    t.invoke('git:getDiffFile', taskId, filePath),
  /** Temporary artifacts the agent wrote for this task (metadata only). */
  listArtifacts: (taskId: string): Promise<TaskArtifact[]> =>
    t.invoke('task:listArtifacts', taskId),
  /** Content of one artifact, by its name relative to the artifacts dir. */
  readArtifact: (taskId: string, name: string): Promise<ArtifactContent | null> =>
    t.invoke('task:readArtifact', taskId, name),
  /**
   * Reveal the task's artifact directory in the OS file manager, for files the
   * in-app preview will not inline. Resolves to '' on success, else a reason.
   */
  openArtifactsDir: (taskId: string): Promise<string> =>
    t.invoke('task:openArtifactsDir', taskId),
  /** Every spec.md the task's branch added or changed; empty when there is none. */
  getSpecs: (taskId: string): Promise<TaskSpec[]> =>
    t.invoke('task:getSpecs', taskId),
  /** Store dir + CLI paths for launch injection, so an agent can write cards. */
  getBoardCliLaunchInfo: (): Promise<BoardCliLaunchInfo> =>
    t.invoke('board:getCliLaunchInfo'),
  /** VibeFlow's own skill / prompt / script store. */
  listLibrary: (): Promise<LibraryEntry[]> => t.invoke('library:list'),
  importLibraryEntry: (payload: {
    kind: LibraryKind
    sourcePath: string
  }): Promise<LibraryEntry> => t.invoke('library:import', payload),
  createLibraryEntry: (payload: {
    kind: LibraryKind
    name: string
    content: string
    description?: string
  }): Promise<LibraryEntry> => t.invoke('library:create', payload),
  readLibraryEntry: (payload: { kind: LibraryKind; name: string }): Promise<string> =>
    t.invoke('library:read', payload),
  updateLibraryEntry: (payload: {
    kind: LibraryKind
    name: string
    content: string
  }): Promise<LibraryEntry> => t.invoke('library:update', payload),
  setLibraryEntryDescription: (payload: {
    kind: LibraryKind
    name: string
    description: string
  }): Promise<boolean> => t.invoke('library:setDescription', payload),
  setLibraryEntryEnabled: (payload: {
    kind: LibraryKind
    name: string
    enabled: boolean
  }): Promise<boolean> => t.invoke('library:setEnabled', payload),
  deleteLibraryEntry: (payload: { kind: LibraryKind; name: string }): Promise<boolean> =>
    t.invoke('library:delete', payload),
  /** Overwrite or bring back a shipped skill with the version this install carries. */
  restoreBuiltinSkill: (payload: { name: string }): Promise<LibraryEntry> =>
    t.invoke('library:restoreBuiltin', payload),
  /** Shipped skills the user deleted, offered for restore. */
  listRemovedBuiltinSkills: (): Promise<string[]> => t.invoke('library:removedBuiltins'),
  approve: (
    taskId: string,
    message: string
  ): Promise<{ result: FinalizeResult; state: VibeFlowState }> =>
    t.invoke('git:approve', { taskId, message }),
  /** Use the task's agent CLI to generate a commit message for branch changes. */
  generateCommitMessage: (taskId: string): Promise<string> =>
    t.invoke('git:generateCommitMessage', taskId),
  /** Check whether a PR exists for the task's branch. */
  getPrStatus: (taskId: string): Promise<PrStatus | null> =>
    t.invoke('git:getPrStatus', taskId),
  /** Get the GitHub compare URL for creating a new PR. */
  getGithubCompareUrl: (taskId: string): Promise<string | null> =>
    t.invoke('git:getGithubCompareUrl', taskId),
  /** Open a URL in the system default browser. */
  openExternal: (url: string): Promise<void> =>
    t.invoke('shell:openExternal', url),
  /** The OS folder dialog, shown on the machine core runs on. */
  pickFolder: (options?: PickFolderOptions): Promise<PickFolderResult> =>
    t.invoke('dialog:pickFolder', options),
  cleanupTask: (taskId: string): Promise<VibeFlowState> =>
    t.invoke('vibeflow:cleanupTask', taskId),
  /** Live sub-agent updates pushed from main while a session runs. */
  onSubAgentsUpdate: (
    callback: (payload: { taskId: string; subAgents: SubAgentRun[] }) => void
  ): (() => void) => {
    return t.on('subagents:update', (payload) => callback(payload as never))
  },
  deleteTask: (taskId: string): Promise<VibeFlowState> =>
    t.invoke('vibeflow:deleteTask', taskId),

  /** A running card's progress now (todos, usage, activity); null = nothing to show yet. */
  getProgress: (taskId: string): Promise<TaskProgress | null> =>
    t.invoke('progress:get', taskId),
  /** Every change to a card's progress, read from its agent's transcript. */
  onProgressUpdate: (
    callback: (payload: ProgressUpdatePayload) => void
  ): (() => void) => {
    return t.on('progress:update', (payload) => callback(payload as never))
  },
  /** Stage notifications, already filtered by the user's notification settings. */
  onProgressNotify: (
    callback: (payload: ProgressNotifyPayload) => void
  ): (() => void) => {
    return t.on('progress:notify', (payload) => callback(payload as never))
  },

  attachments: {
    write: (payload: {
      taskId: string
      attachments: AttachmentInput[]
    }): Promise<ChatAttachment[]> =>
      t.invoke('attachments:write', payload),
  },

  // Chat (structured output) bridge.
  chat: {
    load: (taskId: string): Promise<Conversation | null> =>
      t.invoke('chat:load', taskId),
    send: (payload: {
      taskId: string
      text: string
      attachments?: AttachmentInput[]
      sessionId: string
      resume: boolean
      systemPrompt: string
      agentCli?: AgentCliId
      model: string
    }): Promise<void> => t.invoke('chat:send', payload),
    cancel: (taskId: string): Promise<void> =>
      t.invoke('chat:cancel', taskId),
    compact: (taskId: string): Promise<{ newSessionId: string }> =>
      t.invoke('chat:compact', taskId),
    onChunk: (callback: (chunk: ChatChunk) => void): (() => void) => {
      return t.on('chat:chunk', (payload) => callback(payload as never))
    },
    onPhase: (callback: (phase: ChatPhase) => void): (() => void) => {
      return t.on('chat:phase', (payload) => callback(payload as never))
    },
  },

  // Interactive terminal bridge (Phase 3).
  term: {
    /**
     * Start a terminal for a task: its agent when `launch` is given, else an
     * interactive shell. Core resolves the cwd and builds the command.
     * `sessionKey` defaults to `taskId`.
     */
    start: (payload: {
      taskId: string
      sessionKey?: string
      launch?: LaunchIntent
      fresh?: boolean
      cols?: number
      rows?: number
    }): Promise<StartResult> => t.invoke('pty:start', payload),
    startStandalone: (payload: {
      sessionKey: string
      taskId?: string
      projectPath?: string
      cols?: number
      rows?: number
    }): Promise<StartResult> => t.invoke('terminal:start', payload),
    /** Join a running session without restarting it. */
    peek: (sessionKey: string): Promise<{ alive: boolean; scrollback: string | null }> =>
      t.invoke('pty:peek', sessionKey),
    /** Which session backend runs terminals, and the sessions it has running. */
    list: (): Promise<{ backend: 'pty' | 'tmux'; sessions: string[] }> =>
      t.invoke('sessions:list'),
    /** Send keystrokes to the session identified by `sessionKey`. */
    input: (sessionKey: string, data: string): void =>
      t.send('pty:input', { sessionKey, data }),
    /** Resize the session identified by `sessionKey`. */
    resize: (sessionKey: string, cols: number, rows: number): void =>
      t.send('pty:resize', { sessionKey, cols, rows }),
    /** Kill a task's PTY session (tears down the session and its watchers). */
    kill: (sessionKey: string): void => t.send('pty:kill', sessionKey),
    /** Whether the session's own history view (tmux copy-mode) is off the live output. */
    isScrolledBack: (sessionKey: string): Promise<boolean> =>
      t.invoke('pty:scrolled', sessionKey),
    /** Return the session's own history view to the live output. */
    scrollToBottom: (sessionKey: string): Promise<void> =>
      t.invoke('pty:scroll-bottom', sessionKey),
    /** Whether the task's pinned Claude conversation already exists on disk. */
    sessionExists: (taskId: string): Promise<boolean> =>
      t.invoke('claude:sessionExists', taskId),
    /**
     * Data pushed from the PTY. The payload carries `sessionKey` to let the
     * renderer route output to the correct terminal pane.
     */
    onData: (
      callback: (payload: { sessionKey: string; data: string }) => void
    ): (() => void) => {
      return t.on('pty:data', (payload) => callback(payload as never))
    },
    /** Exit event pushed when a PTY session ends. Carries `sessionKey`. */
    onExit: (
      callback: (payload: {
        sessionKey: string
        exitCode: number
        intentional: boolean
      }) => void
    ): (() => void) => {
      return t.on('pty:exit', (payload) => callback(payload as never))
    },
  },
}
}

export type VibeFlowApi = ReturnType<typeof createBridge>
