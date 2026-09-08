import path from 'path'
import { randomUUID } from 'crypto'
import fs from 'fs/promises'
import {
  getStore,
  getStoreAtPath,
  resolveWorkstationPath,
  type ColumnId,
  type Task,
} from './store'
import { generateBranchName } from './branch-name'
import {
  assertBranchAvailable,
  getGitInfo,
  initRepository,
  provisionWorktree,
} from './git'
import { projectWorkstationPath } from './workspace'
import { DEFAULT_TASK_EFFORT, type AgentCliId, type AgentEffort } from './agents'
import { writeAttachments, type AttachmentInput } from './attachments'

export interface CreateTaskInput {
  projectPath: string
  title: string
  description?: string
  status?: ColumnId
  baseBranch?: string | null
  /**
   * Branch name chosen by the user. Absent/blank = derive one from the card
   * (branch-name.ts). A name given here is created verbatim, or — when origin
   * already publishes it — checked out so the card continues that work.
   */
  branch?: string
  mode?: 'existing' | 'new'
  agentCli?: AgentCliId
  model?: string
  effort?: AgentEffort
  attachments?: AttachmentInput[]
  /** CLI-only: explicit store directory; absent = use Electron getStore(). */
  storePath?: string
}

export interface CreateTaskResult {
  task: Task
  /** Absolute path of the store JSON file that was written. */
  storePath: string
}

export async function createTaskFromInput(input: CreateTaskInput): Promise<CreateTaskResult> {
  const { projectPath } = input

  try {
    await fs.access(projectPath)
  } catch {
    throw Object.assign(new Error(`找不到專案路徑：${projectPath}`), { code: 'PROJECT_NOT_FOUND' })
  }

  if (input.mode === 'new') {
    await initRepository(projectPath)
  }

  const info = await getGitInfo(projectPath)
  if (!info.isRepo) {
    throw Object.assign(new Error('目標路徑不是 git repository'), { code: 'PROJECT_NOT_GIT_REPO' })
  }

  const taskId = randomUUID().slice(0, 8)
  const explicitBranch = input.branch?.trim() || null

  const store = input.storePath ? getStoreAtPath(input.storePath) : getStore()

  // The task's workspace folder is `<workstationRoot>/<projectName>` under the
  // global workstation (settings.workstationPath, default ~/Desktop). The
  // worktree and runtime artifact files
  // live directly inside it. Create it up front so provisioning has a home.
  const projectName = path.basename(projectPath)
  const workspacePath = projectWorkstationPath(
    resolveWorkstationPath(store.get('settings')),
    projectName
  )
  await fs.mkdir(workspacePath, { recursive: true })

  // Vet the user's name before provisioning so a bad one surfaces as its own
  // error instead of a generic "worktree 建立失敗". Generating a name is skipped
  // entirely when one was given — it can cost a headless `claude -p` call.
  if (explicitBranch) {
    await assertBranchAvailable(projectPath, workspacePath, explicitBranch)
  }
  const preferredBranch =
    explicitBranch ?? (await generateBranchName(input.title, input.description))

  let provisionResult
  try {
    provisionResult = await provisionWorktree(
      projectPath,
      workspacePath,
      taskId,
      input.baseBranch ?? null,
      preferredBranch,
      { explicitBranch: Boolean(explicitBranch) }
    )
  } catch (err) {
    throw Object.assign(
      new Error(`Worktree 建立失敗：${(err as Error).message}`),
      { code: 'WORKTREE_CREATE_FAILED' }
    )
  }

  const attachments = writeAttachments(
    provisionResult.worktreePath,
    input.attachments ?? []
  )
  const attachmentLines = attachments.map(
    (attachment) => `[附件: ${attachment.path}]`
  )
  const baseDescription = input.description?.trim()
  const description = attachmentLines.length
    ? [baseDescription, attachmentLines.join('\n')].filter(Boolean).join('\n\n')
    : baseDescription || undefined

  const task: Task = {
    id: taskId,
    title: input.title.trim() || `Task ${taskId}`,
    description,
    branch: provisionResult.branch,
    projectPath,
    projectName,
    worktreePath: provisionResult.worktreePath,
    workspacePath,
    baseBranch: provisionResult.baseBranch,
    pushed: provisionResult.pushed,
    createdAt: Date.now(),
    agentCli: input.agentCli ?? 'claude',
    model: input.model || undefined,
    effort: input.effort ?? DEFAULT_TASK_EFFORT,
  }

  try {
    const board = store.get('board')
    const col: ColumnId = input.status ?? 'backlog'
    board[col] = [task, ...board[col]]
    store.set('board', board)
  } catch (err) {
    throw Object.assign(
      new Error(`Store 寫入失敗：${(err as Error).message}`),
      { code: 'STORE_WRITE_FAILED' }
    )
  }

  return { task, storePath: store.path }
}

export interface UpdateTaskInput {
  taskId: string
  title?: string
  /** Empty string clears the description; absent leaves it untouched. */
  description?: string
  status?: ColumnId
  /** CLI-only: explicit store directory; absent = use Electron getStore(). */
  storePath?: string
}

export interface UpdateTaskResult {
  task: Task
  /** Absolute path of the store JSON file that was written. */
  storePath: string
}

/**
 * Patch a card's text and column. Only those are editable here: branch,
 * worktree and project path are provisioned on disk, so a card must never be
 * able to claim a different one without re-provisioning.
 */
export function updateTaskFromInput(input: UpdateTaskInput): UpdateTaskResult {
  const store = input.storePath ? getStoreAtPath(input.storePath) : getStore()
  const board = store.get('board')
  const columns = Object.keys(board) as ColumnId[]
  const from = columns.find((col) => board[col].some((t) => t.id === input.taskId))
  if (!from) {
    throw Object.assign(new Error(`找不到卡片：${input.taskId}`), {
      code: 'TASK_NOT_FOUND',
    })
  }

  const current = board[from].find((t) => t.id === input.taskId) as Task
  const title = input.title?.trim()
  const description = input.description?.trim()
  const task: Task = {
    ...current,
    ...(title ? { title } : {}),
    ...(input.description !== undefined
      ? { description: description || undefined }
      : {}),
  }

  const to = input.status ?? from
  if (to === from) {
    board[from] = board[from].map((t) => (t.id === task.id ? task : t))
  } else {
    board[from] = board[from].filter((t) => t.id !== task.id)
    board[to] = [task, ...board[to]]
  }

  try {
    store.set('board', board)
  } catch (err) {
    throw Object.assign(
      new Error(`Store 寫入失敗：${(err as Error).message}`),
      { code: 'STORE_WRITE_FAILED' }
    )
  }

  return { task, storePath: store.path }
}
