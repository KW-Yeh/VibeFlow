import type {
  AgentCli,
  AgentCliId,
  AgentEffort,
  AppSettings,
  ArtifactContent,
  AttachmentInput,
  BoardCliLaunchInfo,
  BoardState,
  ChatChunk,
  ChatAttachment,
  ChatPhase,
  Conversation,
  ConnectableAgentId,
  DiffEntry,
  DiffFile,
  FinalizeResult,
  GitInfo,
  GitHubCliAuthEvent,
  GitHubCliAuthStatus,
  LibraryEntry,
  LibraryKind,
  PrStatus,
  RecentProjectEntry,
  SubAgentRun,
  Task,
  TaskArtifact,
  TaskDecisions,
  VibeFlowState,
  LaunchIntent,
  StartResult,
} from '@/lib/types'

/**
 * Returns the bridge to core, or null when it is unavailable (e.g. during the
 * static export, before `installWebBridge` runs).
 */
function bridge() {
  if (typeof window === 'undefined') return null
  return window.vibeflow ?? null
}

export function hasBridge(): boolean {
  return bridge() !== null
}

export async function loadState(): Promise<VibeFlowState | null> {
  const b = bridge()
  return b ? b.getState() : null
}

export async function getAppVersion(): Promise<string | null> {
  const b = bridge()
  return b ? b.getVersion() : null
}

export async function persistBoard(board: BoardState): Promise<void> {
  const b = bridge()
  if (b) await b.setBoard(board)
}

export async function setSettings(
  patch: Partial<AppSettings>
): Promise<VibeFlowState | null> {
  const b = bridge()
  return b ? b.setSettings(patch) : null
}

export async function connectAgent(
  agentId: ConnectableAgentId,
  apiKey: string
): Promise<VibeFlowState | null> {
  const b = bridge()
  return b ? b.connectAgent(agentId, apiKey) : null
}

export async function refreshAgentModels(
  agentId: ConnectableAgentId
): Promise<VibeFlowState | null> {
  const b = bridge()
  return b ? b.refreshAgentModels(agentId) : null
}

export async function getGithubAuthStatus(): Promise<GitHubCliAuthStatus | null> {
  const b = bridge()
  return b ? b.getGithubAuthStatus() : null
}

export async function startGithubAuthLogin(): Promise<void> {
  const b = bridge()
  if (b) await b.startGithubAuthLogin()
}

export async function cancelGithubAuthLogin(): Promise<void> {
  const b = bridge()
  if (b) await b.cancelGithubAuthLogin()
}

export async function logoutGithubAuth(): Promise<GitHubCliAuthStatus | null> {
  const b = bridge()
  return b ? b.logoutGithubAuth() : null
}

export function onGithubAuthEvent(
  callback: (payload: GitHubCliAuthEvent) => void
): () => void {
  const b = bridge()
  return b ? b.onGithubAuthEvent(callback) : () => {}
}

/**
 * Ask for a path by typing it: the browser has no dialog that reveals an
 * absolute path, and core runs on this same machine, so the typed path is the
 * one it opens.
 */
function promptForPath(message: string): string | null {
  if (typeof window === 'undefined') return null
  const typed = window.prompt(message)?.trim()
  return typed ? typed : null
}

export async function pickFolder(): Promise<string | null> {
  if (!bridge()) return null
  return promptForPath('輸入專案資料夾的絕對路徑')
}

export async function getGitInfo(projectPath: string): Promise<GitInfo | null> {
  const b = bridge()
  return b ? b.getGitInfo(projectPath) : null
}

/** Recently used project folders ([] without the bridge). */
export async function listRecentProjects(): Promise<RecentProjectEntry[]> {
  const b = bridge()
  return b ? b.listRecentProjects() : []
}

export async function initRepository(
  projectPath: string
): Promise<GitInfo | null> {
  const b = bridge()
  return b ? b.initRepository(projectPath) : null
}

/** Agent CLIs installed on PATH ([] without the bridge). */
export async function detectAgents(): Promise<AgentCli[]> {
  const b = bridge()
  return b ? b.detectAgents() : []
}

export async function createTask(payload: {
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
}): Promise<{ state: VibeFlowState; task: Task } | null> {
  const b = bridge()
  return b ? b.createTask(payload) : null
}

export async function updateTask(payload: {
  taskId: string
  title: string
  description?: string
  agentCli?: AgentCliId
  model?: string
  effort?: AgentEffort
  autoMode?: boolean
  projectPath?: string
  baseBranch?: string | null
}): Promise<VibeFlowState | null> {
  const b = bridge()
  return b ? b.updateTask(payload) : null
}

export async function resetTaskRun(
  taskId: string
): Promise<{ state: VibeFlowState; task: Task } | null> {
  const b = bridge()
  return b ? b.resetTaskRun(taskId) : null
}


export async function removeTask(taskId: string): Promise<VibeFlowState | null> {
  const b = bridge()
  return b ? b.removeTask(taskId) : null
}

export async function getDiff(taskId: string): Promise<DiffFile[]> {
  const b = bridge()
  return b ? b.getDiff(taskId) : []
}

export async function getDiffEntries(
  taskId: string,
  opts?: { fetch?: boolean }
): Promise<DiffEntry[]> {
  const b = bridge()
  return b ? b.getDiffEntries(taskId, opts) : []
}

export async function getDiffFile(
  taskId: string,
  filePath: string
): Promise<DiffFile | null> {
  const b = bridge()
  return b ? b.getDiffFile(taskId, filePath) : null
}

export async function listArtifacts(taskId: string): Promise<TaskArtifact[]> {
  const b = bridge()
  return b ? b.listArtifacts(taskId) : []
}

export async function readArtifact(
  taskId: string,
  name: string
): Promise<ArtifactContent | null> {
  const b = bridge()
  return b ? b.readArtifact(taskId, name) : null
}

/** Reveal the task's artifact directory. Resolves to '' on success, else why not. */
export async function openArtifactsDir(taskId: string): Promise<string> {
  const b = bridge()
  return b ? b.openArtifactsDir(taskId) : 'bridge unavailable'
}

/** The task's decision record; null without the bridge or a workspace folder. */
export async function getDecisions(taskId: string): Promise<TaskDecisions | null> {
  const b = bridge()
  return b ? b.getDecisions(taskId) : null
}

export async function pickLibrarySource(kind: LibraryKind): Promise<string | null> {
  if (!bridge()) return null
  return promptForPath(kind === 'skill' ? '輸入 skill 目錄的絕對路徑（需含 SKILL.md）' : `輸入 ${kind} 檔案的絕對路徑`)
}

export async function listLibrary(): Promise<LibraryEntry[]> {
  const b = bridge()
  return b ? b.listLibrary() : []
}

export async function importLibraryEntry(
  kind: LibraryKind,
  sourcePath: string
): Promise<LibraryEntry | null> {
  const b = bridge()
  return b ? b.importLibraryEntry({ kind, sourcePath }) : null
}

export async function createLibraryEntry(
  kind: LibraryKind,
  name: string,
  content: string,
  description?: string
): Promise<LibraryEntry | null> {
  const b = bridge()
  return b ? b.createLibraryEntry({ kind, name, content, description }) : null
}

export async function readLibraryEntry(
  kind: LibraryKind,
  name: string
): Promise<string | null> {
  const b = bridge()
  return b ? b.readLibraryEntry({ kind, name }) : null
}

export async function updateLibraryEntry(
  kind: LibraryKind,
  name: string,
  content: string
): Promise<LibraryEntry | null> {
  const b = bridge()
  return b ? b.updateLibraryEntry({ kind, name, content }) : null
}

export async function setLibraryEntryDescription(
  kind: LibraryKind,
  name: string,
  description: string
): Promise<boolean> {
  const b = bridge()
  return b ? b.setLibraryEntryDescription({ kind, name, description }) : false
}

export async function setLibraryEntryEnabled(
  kind: LibraryKind,
  name: string,
  enabled: boolean
): Promise<boolean> {
  const b = bridge()
  return b ? b.setLibraryEntryEnabled({ kind, name, enabled }) : false
}

export async function deleteLibraryEntry(
  kind: LibraryKind,
  name: string
): Promise<boolean> {
  const b = bridge()
  return b ? b.deleteLibraryEntry({ kind, name }) : false
}

export async function getBoardCliLaunchInfo(): Promise<BoardCliLaunchInfo | null> {
  const b = bridge()
  return b ? b.getBoardCliLaunchInfo() : null
}

export async function approve(
  taskId: string,
  message: string
): Promise<{ result: FinalizeResult; state: VibeFlowState } | null> {
  const b = bridge()
  return b ? b.approve(taskId, message) : null
}

export async function generateCommitMessage(taskId: string): Promise<string | null> {
  const b = bridge()
  return b ? b.generateCommitMessage(taskId) : null
}

export async function getPrStatus(taskId: string): Promise<PrStatus | null> {
  const b = bridge()
  return b ? b.getPrStatus(taskId) : null
}

export async function getGithubCompareUrl(taskId: string): Promise<string | null> {
  const b = bridge()
  return b ? b.getGithubCompareUrl(taskId) : null
}

export async function openExternal(url: string): Promise<void> {
  const b = bridge()
  if (b) await b.openExternal(url)
}

/**
 * Subscribe to store changes triggered by external writes (e.g. CLI).
 * Returns an unsubscribe function (no-op when the bridge is absent).
 */
export function onStateChanged(
  callback: (state: VibeFlowState) => void
): () => void {
  const b = bridge()
  return b ? b.onStateChanged(callback) : () => {}
}

/**
 * Subscribe to live sub-agent updates pushed from the main process while a
 * session runs. Returns an unsubscribe function (no-op without the bridge).
 */
export function onSubAgentsUpdate(
  callback: (payload: { taskId: string; subAgents: SubAgentRun[] }) => void
): () => void {
  const b = bridge()
  return b ? b.onSubAgentsUpdate(callback) : () => {}
}

export async function cleanupTask(
  taskId: string
): Promise<VibeFlowState | null> {
  const b = bridge()
  return b ? b.cleanupTask(taskId) : null
}

export async function deleteTask(
  taskId: string
): Promise<VibeFlowState | null> {
  const b = bridge()
  return b ? b.deleteTask(taskId) : null
}

export async function writeAttachments(payload: {
  taskId: string
  attachments: AttachmentInput[]
}): Promise<ChatAttachment[]> {
  const b = bridge()
  return b ? b.attachments.write(payload) : []
}

// --- Chat API wrappers ---

export async function chatLoad(taskId: string): Promise<Conversation | null> {
  const b = bridge()
  return b ? b.chat.load(taskId) : null
}

export async function chatSend(payload: {
  taskId: string
  text: string
  attachments?: AttachmentInput[]
  sessionId: string
  resume: boolean
  systemPrompt: string
  agentCli?: AgentCliId
  model: string
}): Promise<void> {
  bridge()?.chat.send(payload)
}

export function chatCancel(taskId: string): void {
  bridge()?.chat.cancel(taskId)
}

export async function chatCompact(taskId: string): Promise<{ newSessionId: string } | null> {
  return (await bridge()?.chat.compact(taskId)) ?? null
}

export function onChatChunk(callback: (chunk: ChatChunk) => void): () => void {
  const b = bridge()
  return b ? b.chat.onChunk(callback) : () => {}
}

export function onChatPhase(callback: (phase: ChatPhase) => void): () => void {
  const b = bridge()
  return b ? b.chat.onPhase(callback) : () => {}
}

// --- Terminal API wrappers (sessionKey-aware) ---

/**
 * Start a task's terminal: its agent when `launch` is given, else a shell.
 * Core resolves the cwd and builds the command.
 */
export async function termStart(payload: {
  taskId: string
  sessionKey?: string
  launch?: LaunchIntent
  fresh?: boolean
  cols?: number
  rows?: number
}): Promise<StartResult | null> {
  const b = bridge()
  return b ? b.term.start(payload) : null
}

/** Send keystrokes to the session identified by `sessionKey`. */
export function termInput(sessionKey: string, data: string): void {
  bridge()?.term.input(sessionKey, data)
}

/** Resize the session identified by `sessionKey`. */
export function termResize(sessionKey: string, cols: number, rows: number): void {
  bridge()?.term.resize(sessionKey, cols, rows)
}

/** Kill a task's PTY session (tears down the session and its watchers). */
export function termKill(sessionKey: string): void {
  bridge()?.term.kill(sessionKey)
}

/** Whether the task's pinned Claude conversation already exists on disk. */
export async function termSessionExists(taskId: string): Promise<boolean> {
  const b = bridge()
  return b ? b.term.sessionExists(taskId) : false
}

/** Which session backend runs terminals, and the sessions it has running. */
export async function listSessions(): Promise<{ backend: 'pty' | 'tmux'; sessions: string[] } | null> {
  const b = bridge()
  return b ? b.term.list() : null
}

/**
 * Subscribe to PTY data. The payload carries `sessionKey` to identify which
 * terminal pane the data belongs to.
 */
export function onTermData(
  callback: (payload: { sessionKey: string; data: string }) => void
): () => void {
  const b = bridge()
  return b ? b.term.onData(callback) : () => {}
}

/**
 * Subscribe to PTY exit events. Carries `sessionKey`.
 */
export function onTermExit(
  callback: (payload: {
    sessionKey: string
    exitCode: number
    intentional: boolean
  }) => void
): () => void {
  const b = bridge()
  return b ? b.term.onExit(callback) : () => {}
}
