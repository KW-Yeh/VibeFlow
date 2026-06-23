import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import type {
  AppSettings,
  BoardState,
  Role,
  Task,
  VibeFlowState,
  Workspace,
} from './helpers/store'
import type { AgentCli, AgentCliId } from './helpers/agents'
import type { DiffFile, FinalizeResult, GitInfo, PrStatus } from './helpers/git'
import type { TaskProgress } from './helpers/progress'
import type { SubAgentRun } from './helpers/subagents'
import type { Conversation } from './helpers/chat-store'
import type { AttachmentInput, ChatChunk, ChatPhase } from './helpers/chat-session'

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
    reviewerRoleId?: string
    workspaceId?: string
  }): Promise<{ state: VibeFlowState; task: Task }> =>
    ipcRenderer.invoke('vibeflow:createTask', payload),
  updateTask: (payload: {
    taskId: string
    title: string
    description?: string
    roleId?: string
    reviewerRoleId?: string
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

  // --- Workspaces ---
  createWorkspace: (input: { name: string; path: string }): Promise<{ state: VibeFlowState; workspace: Workspace; scan: { folderExists: boolean; hasContextFile: boolean } }> =>
    ipcRenderer.invoke('workspaces:create', input),
  updateWorkspace: (id: string, patch: Partial<Workspace>): Promise<VibeFlowState> =>
    ipcRenderer.invoke('workspaces:update', { id, patch }),
  removeWorkspace: (id: string): Promise<VibeFlowState> =>
    ipcRenderer.invoke('workspaces:remove', id),
  refreshWorkspaces: (): Promise<VibeFlowState> =>
    ipcRenderer.invoke('workspaces:refresh'),

  removeTask: (taskId: string): Promise<VibeFlowState> =>
    ipcRenderer.invoke('vibeflow:removeTask', taskId),

  // Review & finalize (Phase 4).
  getDiff: (taskId: string): Promise<DiffFile[]> =>
    ipcRenderer.invoke('git:getDiff', taskId),
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
    /**
     * Start a PTY session. Pass `sessionKey` to specify the composite session
     * identifier (defaults to `taskId` for the executor). Use
     * `${taskId}:review` for the reviewer's independent PTY session.
     */
    start: (
      taskId: string,
      cwd: string,
      command?: string,
      sessionKey?: string
    ): Promise<{ pid: number }> =>
      ipcRenderer.invoke('pty:start', { taskId, cwd, command, sessionKey }),
    /** Send keystrokes to the session identified by `sessionKey`. */
    input: (sessionKey: string, data: string): void =>
      ipcRenderer.send('pty:input', { sessionKey, data }),
    /** Resize the session identified by `sessionKey`. */
    resize: (sessionKey: string, cols: number, rows: number): void =>
      ipcRenderer.send('pty:resize', { sessionKey, cols, rows }),
    /**
     * Kill a session. Pass a taskId to tear down both the executor and reviewer
     * sessions; pass `${taskId}:review` to kill only the reviewer session.
     */
    kill: (sessionKey: string): void => ipcRenderer.send('pty:kill', sessionKey),
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
      callback: (payload: { sessionKey: string; exitCode: number }) => void
    ): (() => void) => {
      const sub = (
        _event: IpcRendererEvent,
        payload: { sessionKey: string; exitCode: number }
      ) => callback(payload)
      ipcRenderer.on('pty:exit', sub)
      return () => ipcRenderer.removeListener('pty:exit', sub)
    },
  },
}

contextBridge.exposeInMainWorld('vibeflow', vibeflow)

export type VibeFlowApi = typeof vibeflow
