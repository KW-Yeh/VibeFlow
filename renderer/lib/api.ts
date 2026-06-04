import type {
  AppSettings,
  BoardState,
  DiffFile,
  FinalizeResult,
  GitInfo,
  Task,
  TaskProgress,
  VibeFlowState,
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

export async function createTask(payload: {
  title: string
  description?: string
  projectPath: string
  baseBranch: string | null
}): Promise<{ state: VibeFlowState; task: Task } | null> {
  const b = bridge()
  return b ? b.createTask(payload) : null
}

export async function updateTask(payload: {
  taskId: string
  title: string
  description?: string
}): Promise<VibeFlowState | null> {
  const b = bridge()
  return b ? b.updateTask(payload) : null
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
