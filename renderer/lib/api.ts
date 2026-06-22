import type {
  AgentCli,
  AgentCliId,
  AppSettings,
  AttachmentInput,
  BoardState,
  ChatChunk,
  ChatPhase,
  Conversation,
  DiffFile,
  FinalizeResult,
  GitInfo,
  PrStatus,
  Role,
  SubAgentRun,
  Task,
  TaskProgress,
  VibeFlowState,
  Workspace,
} from '@/lib/types'

/**
 * Returns the preload-exposed VibeFlow bridge, or null when it is unavailable
 * (e.g. during static export / running the renderer in a plain browser).
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

/** Restart the app to pick up a newer build (no-op without the bridge). */
export async function relaunchApp(): Promise<void> {
  const b = bridge()
  if (b) await b.relaunch()
}

/**
 * Subscribe to the "a newer build replaced the running bundle" signal.
 * Returns an unsubscribe function (no-op when the bridge is absent).
 */
export function onUpdateAvailable(callback: () => void): () => void {
  const b = bridge()
  return b ? b.onUpdateAvailable(callback) : () => {}
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

export async function pickFolder(): Promise<string | null> {
  const b = bridge()
  return b ? b.pickFolder() : null
}

export async function getGitInfo(projectPath: string): Promise<GitInfo | null> {
  const b = bridge()
  return b ? b.getGitInfo(projectPath) : null
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
  mode?: 'existing' | 'new'
  agentCli?: AgentCliId
  model?: string
  executionAgentCli?: AgentCliId
  executionModel?: string
  roleId?: string
  reviewerRoleId?: string
  workspaceId?: string
}): Promise<{ state: VibeFlowState; task: Task } | null> {
  const b = bridge()
  return b ? b.createTask(payload) : null
}

export async function updateTask(payload: {
  taskId: string
  title: string
  description?: string
  roleId?: string
  reviewerRoleId?: string
}): Promise<VibeFlowState | null> {
  const b = bridge()
  return b ? b.updateTask(payload) : null
}

export async function createRole(
  input: Omit<Role, 'id'>
): Promise<{ state: VibeFlowState; role: Role } | null> {
  const b = bridge()
  return b ? b.createRole(input) : null
}

export async function updateRole(
  roleId: string,
  patch: Partial<Role>
): Promise<VibeFlowState | null> {
  const b = bridge()
  return b ? b.updateRole(roleId, patch) : null
}

export async function removeRole(
  roleId: string
): Promise<VibeFlowState | null> {
  const b = bridge()
  return b ? b.removeRole(roleId) : null
}

export async function createWorkspace(
  input: { name: string; path: string }
): Promise<{ state: VibeFlowState; workspace: Workspace; scan: { folderExists: boolean; hasContextFile: boolean } } | null> {
  const b = bridge()
  return b ? b.createWorkspace(input) : null
}

export async function updateWorkspace(
  id: string,
  patch: Partial<Workspace>
): Promise<VibeFlowState | null> {
  const b = bridge()
  return b ? b.updateWorkspace(id, patch) : null
}

export async function removeWorkspace(
  id: string
): Promise<VibeFlowState | null> {
  const b = bridge()
  return b ? b.removeWorkspace(id) : null
}

export async function refreshWorkspaces(): Promise<VibeFlowState | null> {
  const b = bridge()
  return b ? b.refreshWorkspaces() : null
}

export async function removeTask(taskId: string): Promise<VibeFlowState | null> {
  const b = bridge()
  return b ? b.removeTask(taskId) : null
}

export async function getDiff(taskId: string): Promise<DiffFile[]> {
  const b = bridge()
  return b ? b.getDiff(taskId) : []
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
 * Subscribe to live task-progress updates pushed from the main process.
 * Returns an unsubscribe function (no-op when the bridge is absent).
 */
export function onProgressUpdate(
  callback: (payload: { taskId: string; progress: TaskProgress }) => void
): () => void {
  const b = bridge()
  return b ? b.onProgressUpdate(callback) : () => {}
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

// --- Chat API wrappers ---

export async function chatLoad(taskId: string): Promise<Conversation | null> {
  const b = bridge()
  return b ? b.chat.load(taskId) : null
}

export async function chatSend(payload: {
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
 * Start a PTY session. `sessionKey` defaults to `taskId` (executor session).
 * Pass `${taskId}:review` for the independent reviewer PTY.
 */
export async function termStart(
  taskId: string,
  cwd: string,
  command?: string,
  sessionKey?: string
): Promise<{ pid: number } | null> {
  const b = bridge()
  return b ? b.term.start(taskId, cwd, command, sessionKey) : null
}

/** Send keystrokes to the session identified by `sessionKey`. */
export function termInput(sessionKey: string, data: string): void {
  bridge()?.term.input(sessionKey, data)
}

/** Resize the session identified by `sessionKey`. */
export function termResize(sessionKey: string, cols: number, rows: number): void {
  bridge()?.term.resize(sessionKey, cols, rows)
}

/**
 * Kill a session. Pass a plain taskId to tear down both executor and reviewer
 * sessions; pass `${taskId}:review` to kill only the reviewer session.
 */
export function termKill(sessionKey: string): void {
  bridge()?.term.kill(sessionKey)
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
  callback: (payload: { sessionKey: string; exitCode: number }) => void
): () => void {
  const b = bridge()
  return b ? b.term.onExit(callback) : () => {}
}
