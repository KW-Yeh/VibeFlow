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
  executionAgentCli?: AgentCliId
  executionModel?: string
  effort?: AgentEffort
  roleId?: string
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
  // worktree and all runtime files (PLAN.md, progress/review json, plan.html)
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
    executionAgentCli: input.executionAgentCli ?? input.agentCli ?? 'claude',
    executionModel:
      input.executionModel ||
      (input.executionAgentCli ? undefined : input.model) ||
      undefined,
    effort: input.effort ?? DEFAULT_TASK_EFFORT,
    roleId: input.roleId || undefined,
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
