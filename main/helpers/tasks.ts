import path from 'path'
import { randomUUID } from 'crypto'
import fs from 'fs/promises'
import {
  getStore,
  getStoreAtPath,
  DEFAULT_MAX_REVIEW_ROUNDS,
  type ColumnId,
  type PipelineRun,
  type Task,
} from './store'
import { generateBranchName } from './branch-name'
import { getGitInfo, initRepository, provisionWorktree } from './git'
import { defaultWorkspacePath, ensureContextFiles } from './workspace'
import type { AgentCliId } from './agents'

export interface CreateTaskInput {
  projectPath: string
  title: string
  description?: string
  status?: ColumnId
  baseBranch?: string | null
  mode?: 'existing' | 'new'
  agentCli?: AgentCliId
  model?: string
  executionAgentCli?: AgentCliId
  executionModel?: string
  roleId?: string
  reviewerRoleId?: string
  workspaceId?: string
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
  const preferredBranch = await generateBranchName(input.title, input.description)

  const store = input.storePath ? getStoreAtPath(input.storePath) : getStore()

  // Resolve the workspace folder: an assigned workspace's path, else a sibling
  // `<slug>-workspace` folder next to the project. The worktree lives inside it.
  const assignedWorkspace = input.workspaceId
    ? (store.get('workspaces') ?? []).find((w) => w.id === input.workspaceId)
    : undefined
  const workspacePath = assignedWorkspace?.path ?? defaultWorkspacePath(projectPath)
  await ensureContextFiles(workspacePath)

  let provisionResult
  try {
    provisionResult = await provisionWorktree(
      projectPath,
      workspacePath,
      taskId,
      input.baseBranch ?? null,
      preferredBranch
    )
  } catch (err) {
    throw Object.assign(
      new Error(`Worktree 建立失敗：${(err as Error).message}`),
      { code: 'WORKTREE_CREATE_FAILED' }
    )
  }

  const pipeline: PipelineRun | undefined = input.reviewerRoleId
    ? { stage: 'developing', round: 0, maxRounds: DEFAULT_MAX_REVIEW_ROUNDS }
    : undefined

  const task: Task = {
    id: taskId,
    title: input.title.trim() || `Task ${taskId}`,
    description: input.description?.trim() || undefined,
    branch: provisionResult.branch,
    projectPath,
    projectName: path.basename(projectPath),
    worktreePath: provisionResult.worktreePath,
    workspacePath,
    baseBranch: provisionResult.baseBranch,
    pushed: provisionResult.pushed,
    agentCli: input.agentCli ?? 'claude',
    model: input.model || undefined,
    executionAgentCli: input.executionAgentCli ?? input.agentCli ?? 'claude',
    executionModel:
      input.executionModel ||
      (input.executionAgentCli ? undefined : input.model) ||
      undefined,
    roleId: input.roleId || undefined,
    reviewerRoleId: input.reviewerRoleId || undefined,
    workspaceId: input.workspaceId || undefined,
    pipeline,
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
