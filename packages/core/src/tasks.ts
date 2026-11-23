import path from 'path'
import { randomUUID } from 'crypto'
import fs from 'fs/promises'
import {
  getStore,
  getStoreAtPath,
  isMasterTask,
  moveTaskInColumn,
  resolveWorkstationPath,
  writeBoard,
  type ColumnId,
  type Task,
} from './store'
import { generateBranchName, type TitleTranslator } from './branch-name'
import {
  assertBranchAvailable,
  fallbackBranchName,
  getGitInfo,
  initRepository,
  provisionDetachedWorktree,
  provisionWorktree,
} from './git'
import { projectWorkstationPath, taskAttachmentStagingPath } from './workspace'
import { recordRecentProject } from './recent-projects'
import { DEFAULT_TASK_EFFORT, type AgentCliId, type AgentEffort } from './agents'
import { writeAttachments, writeAttachmentsTo, type AttachmentInput } from './attachments'
import type { GithubRef } from './github'
import type { JiraRef } from './jira'

export interface CreateTaskInput {
  /** Required for an ordinary card; a master has no project. */
  projectPath?: string
  /** `master` creates an orchestrator card — see Task.role. */
  role?: 'master'
  /** A master's own folder (any existing directory, git or not). Absent = one VibeFlow owns. */
  workDir?: string
  /** The master card dispatching this one. */
  masterId?: string
  /** Cards of the same master that must be Done before this one starts. */
  after?: string[]
  /** A master's related projects (existing folders its agent may read). */
  projects?: string[]
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
  /**
   * false = the card never gets a branch: a detached worktree in a git
   * project, or the folder itself when the project is not a repo. Default true.
   */
  createBranch?: boolean
  agentCli?: AgentCliId
  model?: string
  effort?: AgentEffort
  /** Absent = inherit the board-wide default (settings.autoMode). */
  autoMode?: boolean
  attachments?: AttachmentInput[]
  /** The GitHub Issue or PR this card is converted from. */
  github?: GithubRef
  jira?: JiraRef
  /** CLI-only: explicit store directory; absent = use the host's getStore(). */
  storePath?: string
}

export interface CreateTaskResult {
  task: Task
  /** Absolute path of the store JSON file that was written. */
  storePath: string
}

/** Where a store keeps its master cards' folders. */
export function mastersRoot(storeFile: string): string {
  return path.join(path.dirname(storeFile), 'masters')
}

function taskError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code })
}

/** A master must exist and be a master; a master cannot itself be dispatched. */
export function assertMasterRef(board: Record<ColumnId, Task[]>, masterId: string, taskId?: string): void {
  const master = (Object.values(board) as Task[][]).flat().find((t) => t.id === masterId)
  if (!master) throw taskError(`找不到 master 卡片：${masterId}`, 'MASTER_NOT_FOUND')
  if (!isMasterTask(master)) throw taskError(`卡片 ${masterId} 不是 master`, 'NOT_A_MASTER')
  if (taskId && masterId === taskId) throw taskError('卡片不能指定自己為 master', 'NOT_A_MASTER')
}

/**
 * A card may only wait on cards of its own master, never on itself, and the
 * waits must not loop — otherwise none of them could ever start.
 */
export function assertDependencies(
  board: Record<ColumnId, Task[]>,
  taskId: string,
  masterId: string | undefined,
  after: string[]
): void {
  if (after.length === 0) return
  if (!masterId) throw taskError('只有隸屬 master 的卡片可以設定 --after', 'INVALID_DEPENDENCY')
  const all = (Object.values(board) as Task[][]).flat()
  const byId = new Map(all.map((t) => [t.id, t]))
  for (const id of after) {
    if (id === taskId) throw taskError('卡片不能等待自己', 'INVALID_DEPENDENCY')
    const dep = byId.get(id)
    if (!dep) throw taskError(`找不到前置卡片：${id}`, 'INVALID_DEPENDENCY')
    if (dep.masterId !== masterId) throw taskError(`前置卡片 ${id} 不屬於同一張 master`, 'INVALID_DEPENDENCY')
  }
  const waitsOn = (id: string): string[] => (id === taskId ? after : byId.get(id)?.after ?? [])
  const seen = new Set<string>()
  const stack = [...after]
  while (stack.length) {
    const id = stack.pop() as string
    if (id === taskId) throw taskError('前置卡片形成循環', 'INVALID_DEPENDENCY')
    if (seen.has(id)) continue
    seen.add(id)
    stack.push(...waitsOn(id))
  }
}

function uniqueIds(ids: string[] | undefined): string[] {
  return [...new Set((ids ?? []).map((id) => id.trim()).filter(Boolean))]
}

/** A master's related projects: existing absolute folders, each once. */
export async function resolveProjects(projects: string[] | undefined): Promise<string[]> {
  const unique = [...new Set((projects ?? []).map((dir) => dir.trim()).filter(Boolean))]
  for (const dir of unique) {
    const stat = await fs.stat(dir).catch(() => null)
    if (!path.isAbsolute(dir) || !stat?.isDirectory()) {
      throw taskError(`找不到專案資料夾：${dir}`, 'PROJECT_NOT_FOUND')
    }
  }
  return unique
}

async function assertDirectory(dir: string): Promise<void> {
  const stat = await fs.stat(dir).catch(() => null)
  if (!path.isAbsolute(dir) || !stat?.isDirectory()) {
    throw taskError(`找不到資料夾：${dir}`, 'WORK_DIR_NOT_FOUND')
  }
}

export interface CreateTaskOptions {
  /** Translates a non-English title into a branch slug. Without one a card is never translated. */
  translateTitle?: TitleTranslator
}

export async function createTaskFromInput(
  input: CreateTaskInput,
  options: CreateTaskOptions = {}
): Promise<CreateTaskResult> {
  if (input.role === 'master') return createMasterTask(input)
  if (input.projects?.length) throw taskError('相關專案只能設定在 master 卡片', 'INVALID_ARGUMENT')
  const projectPath = input.projectPath
  if (!projectPath) throw taskError('尚未選擇專案資料夾', 'PROJECT_NOT_FOUND')

  try {
    await fs.access(projectPath)
  } catch {
    throw Object.assign(new Error(`找不到專案路徑：${projectPath}`), { code: 'PROJECT_NOT_FOUND' })
  }

  if (input.mode === 'new') {
    await initRepository(projectPath)
  }

  const noBranch = input.createBranch === false
  const info = await getGitInfo(projectPath)
  if (!info.isRepo && !noBranch) {
    throw Object.assign(new Error('目標路徑不是 git repository'), { code: 'PROJECT_NOT_GIT_REPO' })
  }

  const taskId = randomUUID().slice(0, 8)
  const explicitBranch = noBranch ? null : input.branch?.trim() || null

  const store = input.storePath ? getStoreAtPath(input.storePath) : getStore()
  if (input.masterId) assertMasterRef(store.get('board'), input.masterId)
  const after = uniqueIds(input.after)
  assertDependencies(store.get('board'), taskId, input.masterId, after)

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

  // Vet the user's name now so a bad one surfaces as its own error at creation,
  // not later at launch. Generating a name is skipped entirely when one was
  // given — translating a title can cost a headless `claude -p` call.
  if (explicitBranch) {
    await assertBranchAvailable(projectPath, workspacePath, explicitBranch)
  }
  const branch = noBranch
    ? ''
    : explicitBranch ??
      (await generateBranchName(input.title, input.description, options.translateTitle)) ??
      fallbackBranchName(taskId)

  const draft: Task = {
    id: taskId,
    title: input.title.trim() || `Task ${taskId}`,
    branch,
    branchExplicit: explicitBranch ? true : undefined,
    projectPath,
    projectName,
    workspacePath,
    baseBranch: info.isRepo
      ? input.baseBranch || info.defaultBase || info.currentBranch || undefined
      : undefined,
    ...(noBranch ? { noBranch: true as const } : {}),
    ...(noBranch && !info.isRepo ? { inPlace: true as const } : {}),
  }

  // A backlog card stays a plan: its branch is cut from the base when it starts,
  // not when it was written down. Other columns never auto-launch, so a card
  // created straight into them gets its worktree now or could never run.
  const col: ColumnId = input.status ?? 'backlog'
  const provisioned = col === 'backlog' ? null : await provisionTaskWorktree(draft)

  const attachments = provisioned?.worktreePath
    ? writeAttachments(provisioned.worktreePath, input.attachments ?? [])
    : writeAttachmentsTo(
        taskAttachmentStagingPath(workspacePath, taskId),
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
    ...draft,
    ...provisioned,
    description,
    createdAt: Date.now(),
    agentCli: input.agentCli ?? 'claude',
    model: input.model || undefined,
    effort: input.effort ?? DEFAULT_TASK_EFFORT,
    autoMode: input.autoMode,
    ...(input.masterId ? { masterId: input.masterId } : {}),
    ...(after.length ? { after } : {}),
    ...(input.github ? { github: input.github } : {}),
    ...(input.jira ? { jira: input.jira } : {}),
  }

  try {
    const board = store.get('board')
    board[col] = [task, ...board[col]]
    writeBoard(store, board)
    recordRecentProject(store, projectPath)
  } catch (err) {
    throw Object.assign(
      new Error(`Store 寫入失敗：${(err as Error).message}`),
      { code: 'STORE_WRITE_FAILED' }
    )
  }

  return { task, storePath: store.path }
}

/**
 * A master is a card without a repo: no git checks, no branch name, no
 * worktree. It gets a folder of its own under the store unless the user named
 * one, and that folder is only created when the card first runs.
 */
async function createMasterTask(input: CreateTaskInput): Promise<CreateTaskResult> {
  if (input.masterId) throw taskError('master 卡片不能再隸屬其他 master', 'NOT_A_MASTER')
  if (input.after?.length) throw taskError('master 卡片不能設定 --after', 'INVALID_DEPENDENCY')
  const workDir = input.workDir?.trim() || undefined
  if (workDir) await assertDirectory(workDir)
  const projects = await resolveProjects(input.projects)
  const store = input.storePath ? getStoreAtPath(input.storePath) : getStore()
  const taskId = randomUUID().slice(0, 8)
  const workspacePath = path.join(mastersRoot(store.path), taskId)

  const draft: Task = {
    id: taskId,
    title: input.title.trim() || `Master ${taskId}`,
    branch: '',
    role: 'master',
    workspacePath,
    ...(workDir ? { workDir } : {}),
    ...(projects.length ? { projects } : {}),
  }
  const col: ColumnId = input.status ?? 'backlog'
  const provisioned = col === 'backlog' ? null : await provisionTaskWorktree(draft)
  const attachments = provisioned?.worktreePath
    ? writeAttachments(provisioned.worktreePath, input.attachments ?? [])
    : writeAttachmentsTo(taskAttachmentStagingPath(workspacePath, taskId), input.attachments ?? [])
  const attachmentLines = attachments.map((attachment) => `[附件: ${attachment.path}]`)
  const baseDescription = input.description?.trim()
  const description = attachmentLines.length
    ? [baseDescription, attachmentLines.join('\n')].filter(Boolean).join('\n\n')
    : baseDescription || undefined

  const task: Task = {
    ...draft,
    ...provisioned,
    description,
    createdAt: Date.now(),
    agentCli: input.agentCli ?? 'claude',
    model: input.model || undefined,
    effort: input.effort ?? DEFAULT_TASK_EFFORT,
    autoMode: input.autoMode,
    ...(input.github ? { github: input.github } : {}),
    ...(input.jira ? { jira: input.jira } : {}),
  }

  try {
    const board = store.get('board')
    board[col] = [task, ...board[col]]
    writeBoard(store, board)
  } catch (err) {
    throw taskError(`Store 寫入失敗：${(err as Error).message}`, 'STORE_WRITE_FAILED')
  }
  return { task, storePath: store.path }
}

export type ProvisionedFields = Pick<Task, 'branch' | 'worktreePath' | 'baseBranch' | 'pushed' | 'provisionedAt'
>

/**
 * Create the card's branch and worktree from the base as it is right now. The
 * branch stays local until a PR publishes it. Returns the fields to write back: the
 * branch can differ from the card's when a generated name had to be
 * de-duplicated.
 */
export async function provisionTaskWorktree(task: Task): Promise<ProvisionedFields> {
  if (isMasterTask(task)) {
    if (!task.workspacePath) throw taskError('master 卡片沒有工作資料夾', 'WORKTREE_CREATE_FAILED')
    const worktreePath = task.workDir ?? path.join(task.workspacePath, 'work')
    await fs.mkdir(worktreePath, { recursive: true })
    await fs.mkdir(task.workspacePath, { recursive: true })
    return { branch: '', worktreePath, provisionedAt: Date.now() }
  }
  if (!task.projectPath || !task.workspacePath) {
    throw Object.assign(new Error('任務沒有專案資料夾，無法建立 worktree'), {
      code: 'WORKTREE_CREATE_FAILED',
    })
  }
  if (task.inPlace) {
    return { branch: '', worktreePath: task.projectPath, provisionedAt: Date.now() }
  }
  await fs.mkdir(task.workspacePath, { recursive: true })
  if (task.noBranch) {
    try {
      const result = await provisionDetachedWorktree(
        task.projectPath,
        task.workspacePath,
        task.id,
        task.baseBranch ?? null
      )
      return { branch: '', ...result, provisionedAt: Date.now() }
    } catch (err) {
      throw taskError(`Worktree 建立失敗：${(err as Error).message}`, 'WORKTREE_CREATE_FAILED')
    }
  }
  if (task.branchExplicit) {
    await assertBranchAvailable(task.projectPath, task.workspacePath, task.branch)
  }
  try {
    const result = await provisionWorktree(
      task.projectPath,
      task.workspacePath,
      task.id,
      task.baseBranch ?? null,
      task.branch,
      { explicitBranch: task.branchExplicit === true }
    )
    return {
      branch: result.branch,
      worktreePath: result.worktreePath,
      baseBranch: result.baseBranch,
      pushed: result.pushed,
      provisionedAt: Date.now(),
    }
  } catch (err) {
    throw Object.assign(
      new Error(`Worktree 建立失敗：${(err as Error).message}`),
      { code: 'WORKTREE_CREATE_FAILED' }
    )
  }
}

export interface UpdateTaskInput {
  taskId: string
  title?: string
  /** Empty string clears the description; absent leaves it untouched. */
  description?: string
  status?: ColumnId
  /** A master's id to dispatch the card under; null removes it from its master. */
  masterId?: string | null
  /** Cards this one waits on; an empty list clears them. */
  after?: string[]
  /** CLI-only: explicit store directory; absent = use the host's getStore(). */
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
  if (input.masterId) {
    if (isMasterTask(current)) throw taskError('master 卡片不能再隸屬其他 master', 'NOT_A_MASTER')
    assertMasterRef(board, input.masterId, current.id)
  }
  const title = input.title?.trim()
  const description = input.description?.trim()
  const masterId = input.masterId !== undefined ? input.masterId || undefined : current.masterId
  // Waits only make sense among one master's cards, so a card that changes
  // master keeps none it did not restate.
  const after = input.after !== undefined
    ? uniqueIds(input.after)
    : masterId === current.masterId ? current.after ?? [] : []
  assertDependencies(board, current.id, masterId, after)
  const task: Task = {
    ...current,
    ...(title ? { title } : {}),
    ...(input.description !== undefined
      ? { description: description || undefined }
      : {}),
    ...(input.masterId !== undefined ? { masterId } : {}),
    ...(after.length ? { after } : {}),
  }
  if (!after.length) delete task.after

  const to = input.status ?? from
  if (to === from) {
    board[from] = board[from].map((t) => (t.id === task.id ? task : t))
  } else {
    board[from] = board[from].filter((t) => t.id !== task.id)
    board[to] = [task, ...board[to]]
  }

  try {
    writeBoard(store, board)
  } catch (err) {
    throw Object.assign(
      new Error(`Store 寫入失敗：${(err as Error).message}`),
      { code: 'STORE_WRITE_FAILED' }
    )
  }

  return { task, storePath: store.path }
}

export interface MoveTaskInput {
  taskId: string
  /** The card to sit right before, in the same column; null = the column's end. */
  beforeId: string | null
  storePath?: string
}

/** Reorder a card within its column. Moving between columns is not this; it starts or finishes work. */
export function moveTaskFromInput(input: MoveTaskInput): { task: Task; column: ColumnId; storePath: string } {
  const store = input.storePath ? getStoreAtPath(input.storePath) : getStore()
  const board = store.get('board')
  const column = (Object.keys(board) as ColumnId[]).find((c) => board[c].some((t) => t.id === input.taskId))
  if (!column) throw taskError(`找不到卡片：${input.taskId}`, 'TASK_NOT_FOUND')
  const next = moveTaskInColumn(board, input.taskId, input.beforeId)
  if (!next) throw taskError(`卡片 ${input.beforeId} 不在同一欄`, 'INVALID_MOVE')
  writeBoard(store, next)
  return { task: next[column].find((t) => t.id === input.taskId)!, column, storePath: store.path }
}
