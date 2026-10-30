import { parseArgs } from 'node:util'
import { createTaskFromInput, updateTaskFromInput } from '../../core/src/tasks'
import { addTaskArtifact } from '../../core/src/artifacts'
import { fileToAttachmentInput, type AttachmentInput } from '../../core/src/attachments'
import { AGENT_CLIS, AGENT_EFFORTS, type AgentCliId, type AgentEffort } from '../../core/src/agents'
import { createNodePlatform, defaultUserDataDir, setPlatform } from '../../core/src/platform'
import { findTask } from '../../core/src/store'
import { liveHost } from '../../core/src/lock'
import { connectToHost } from './remote'
import type { ColumnId } from '../../core/src/store'

const AGENT_IDS: string[] = AGENT_CLIS.map((agent) => agent.id)
const STATUSES = ['backlog', 'in_progress', 'done']
const SUBCOMMANDS = ['create', 'update', 'start', 'list', 'show', 'artifact']
const ROLES = ['slave', 'master']
const MODES = ['existing', 'new']
const AUTO_MODES = ['on', 'off']

export const TASK_USAGE = `
VibeFlow task commands

Usage:
  vibeflow task create [options]
  vibeflow task update [options]
  vibeflow task start --task <id> [options]
  vibeflow task list [--master <id>] [options]
  vibeflow task show --task <id> [options]
  vibeflow task artifact add --file <path> [options]

task create options:
  --role <role>          ${ROLES.join(' | ')}  (default: slave). A master has no project:
                         it runs in its own folder and dispatches other cards.
  --project <path>       Target project directory (required for a slave)
  --work-dir <path>      Master only: run in this existing folder (git or not)
                         instead of one VibeFlow creates
  --master <id>          Dispatch the new card under this master card
  --title <text>         Task title (required)
  --prompt <text>        Task prompt / description (required)
  --status <column>      ${STATUSES.join(' | ')}  (default: backlog)
  --base-branch <name>   Branch the worktree is created from (default: repo's current branch)
  --branch <name>        Branch to create for the task (default: derived from the title).
                         If origin already publishes it, the branch is fetched and
                         checked out instead of being created.
  --mode <mode>          ${MODES.join(' | ')}  (default: existing; "new" runs git init first)
  --agent <id>           Task agent: ${AGENT_IDS.join(' | ')}  (default: claude)
  --model <id>           Task model (default: the agent's own default)
  --effort <level>       ${AGENT_EFFORTS.join(' | ')}  (default: auto, same as the UI)
  --auto-mode <on|off>   Let the agent act without asking for approval
                         (default: the board-wide setting, same as the UI)
  --attach <path>        Attach a file; repeat the flag for several files
  --store-path <dir>     Explicit store directory
  --profile <name>       dev | prod — shorthand for common store paths
  -h, --help             Show this help

task update options:
  --task <id>            Card to update (required)
  --title <text>         New card title
  --prompt <text>        New card description (empty string clears it)
  --status <column>      ${STATUSES.join(' | ')}  — moves the card between columns
  --master <id|none>     Put the card under a master, or "none" to take it out
  --store-path <dir>     Explicit store directory
  --profile <name>       dev | prod — shorthand for common store paths

  At least one of --title / --prompt / --status / --master is required. Branch,
  worktree and project path are provisioned on disk and cannot be changed here.

task start / list / show (need the running VibeFlow host):
  start --task <id>      Move a Backlog card to In Progress and start its agent,
                         the same as dragging it in the app
  list [--master <id>]   Every card, or one master's cards, with column, whether
                         its agent is running, todo progress, activity and PR
  show --task <id>       The same summary for one card

task artifact add options:
  --file <path>         Copy a file into the card's user-facing Artifacts folder
  --task <id>           Card ID (defaults to VIBEFLOW_TASK_ID in a task shell)
  --store-path <dir>    Store directory (defaults to VIBEFLOW_STORE_DIR in a task shell)
  --profile <name>      dev | prod — when no store path is given

Notes:
  A card created with --status in_progress does NOT start running by itself.
  Use "task start" on a Backlog card, or start it from the app.

Examples:
  vibeflow task create \\
    --project /path/to/project \\
    --title "Fix login bug" \\
    --prompt "Investigate and fix the login failure" \\
    --effort high \\
    --attach ./screenshot.png \\
    --profile dev
`.trim()

class CliFailure extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

function fail(code: string, message: string): never {
  throw new CliFailure(code, message)
}

/** Reject a flag whose value is outside the allowed set. */
function requireOneOf(flag: string, value: string | undefined, allowed: readonly string[]): void {
  if (value !== undefined && !allowed.includes(value)) {
    fail('INVALID_ARGUMENT', `${flag} must be one of: ${allowed.join(', ')}`)
  }
}

/** Resolve the store directory from --store-path or --profile. */
export function resolveStorePath(storePath: string | undefined, profile: string | undefined): string {
  return storePath || defaultUserDataDir(profile === 'dev' ? 'dev' : 'prod')
}

/**
 * `vibeflow task create|update …`. Writes one JSON object to stdout, with
 * `ok: false` and an error code on failure, and resolves to the exit code.
 */
export async function runTaskCommand(argv: string[]): Promise<number> {
  try {
    const result = await taskCommand(argv)
    if (result === null) {
      console.log(TASK_USAGE)
      return 0
    }
    process.stdout.write(JSON.stringify({ ok: true, ...result }, null, 2) + '\n')
    return 0
  } catch (err) {
    const e = err as { code?: string; message?: string }
    process.stdout.write(
      JSON.stringify({ ok: false, error: { code: e.code ?? 'UNKNOWN_ERROR', message: e.message ?? String(err) } }) + '\n'
    )
    return 1
  }
}

async function taskCommand(argv: string[]): Promise<Record<string, unknown> | null> {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        project:       { type: 'string' },
        role:          { type: 'string' },
        'work-dir':    { type: 'string' },
        master:        { type: 'string' },
        title:         { type: 'string' },
        prompt:        { type: 'string' },
        task:          { type: 'string' },
        status:        { type: 'string' },
        'base-branch': { type: 'string' },
        branch:        { type: 'string' },
        mode:          { type: 'string' },
        agent:         { type: 'string' },
        model:         { type: 'string' },
        effort:        { type: 'string' },
        'auto-mode':   { type: 'string' },
        attach:        { type: 'string', multiple: true },
        file:          { type: 'string' },
        'store-path':  { type: 'string' },
        profile:       { type: 'string' },
        help:          { type: 'boolean', short: 'h' },
      },
      allowPositionals: true,
      strict: true,
    })
  } catch (err) {
    fail('INVALID_ARGUMENT', (err as Error).message)
  }

  const { values, positionals } = parsed
  const [sub, action] = positionals
  if (values.help || !sub) return null

  const storePath = resolveStorePath(
    values['store-path'] ?? (sub === 'artifact' || HOST_COMMANDS.includes(sub) ? process.env.VIBEFLOW_STORE_DIR : undefined),
    values.profile
  )
  setPlatform(createNodePlatform({ userDataDir: storePath }))

  if (!SUBCOMMANDS.includes(sub)) {
    fail('UNKNOWN_COMMAND', `Unknown command: "task ${sub}". Use: ${SUBCOMMANDS.map((s) => `task ${s}`).join(' | ')}`)
  }

  if (sub === 'artifact') {
    if (action !== 'add') fail('UNKNOWN_COMMAND', 'Use: task artifact add --file <path>')
    const taskId = values.task ?? process.env.VIBEFLOW_TASK_ID
    if (!taskId || !values.file) fail('MISSING_ARGUMENT', 'task artifact add needs --file and --task (or VIBEFLOW_TASK_ID)')
    const task = findTask(taskId)
    if (!task) fail('TASK_NOT_FOUND', `Task not found: ${taskId}`)
    return { taskId, path: addTaskArtifact(task, values.file) }
  }

  if (HOST_COMMANDS.includes(sub)) return hostCommand(sub, values, storePath)

  if (sub === 'update') {
    if (!values.task) fail('MISSING_ARGUMENT', 'Missing required arguments: --task')
    requireOneOf('--status', values.status, STATUSES)
    if (values.title === undefined && values.prompt === undefined && values.status === undefined && values.master === undefined) {
      fail('MISSING_ARGUMENT', 'task update needs at least one of: --title, --prompt, --status, --master')
    }
    const { task, storePath: resolvedPath } = updateTaskFromInput({
      taskId: values.task,
      title: values.title,
      description: values.prompt,
      status: values.status as ColumnId | undefined,
      masterId: values.master === undefined ? undefined : values.master === 'none' ? null : values.master,
      storePath,
    })
    return {
      storePath: resolvedPath,
      task: {
        id: task.id,
        title: task.title,
        description: task.description,
        branch: task.branch,
        worktreePath: task.worktreePath ?? null,
        masterId: task.masterId ?? null,
      },
    }
  }

  requireOneOf('--role', values.role, ROLES)
  const master = values.role === 'master'
  if (!master && values['work-dir'] !== undefined) fail('INVALID_ARGUMENT', '--work-dir is only for --role master')
  if (master && (values.project || values['base-branch'] || values.branch || values.mode)) {
    fail('INVALID_ARGUMENT', 'A master card has no project: drop --project / --base-branch / --branch / --mode')
  }
  const missing = []
  if (!master && !values.project) missing.push('--project')
  if (!values.title) missing.push('--title')
  if (!values.prompt) missing.push('--prompt')
  if (missing.length) fail('MISSING_ARGUMENT', `Missing required arguments: ${missing.join(', ')}`)

  requireOneOf('--status', values.status, STATUSES)
  requireOneOf('--mode', values.mode, MODES)
  requireOneOf('--agent', values.agent, AGENT_IDS)
  requireOneOf('--effort', values.effort, AGENT_EFFORTS)
  requireOneOf('--auto-mode', values['auto-mode'], AUTO_MODES)

  let attachments: AttachmentInput[] = []
  try {
    attachments = (values.attach ?? []).map(fileToAttachmentInput)
  } catch (err) {
    fail('ATTACHMENT_READ_FAILED', `無法讀取附件：${(err as Error).message}`)
  }

  const { task, storePath: resolvedPath } = await createTaskFromInput({
    projectPath: values.project,
    role: master ? 'master' : undefined,
    workDir: values['work-dir'],
    masterId: values.master,
    title: values.title!,
    description: values.prompt,
    status: (values.status ?? 'backlog') as ColumnId,
    baseBranch: values['base-branch'] ?? null,
    branch: values.branch,
    mode: (values.mode ?? 'existing') as 'existing' | 'new',
    agentCli: values.agent as AgentCliId | undefined,
    model: values.model,
    effort: values.effort as AgentEffort | undefined,
    autoMode: values['auto-mode'] ? values['auto-mode'] === 'on' : undefined,
    attachments,
    storePath,
  })
  return {
    storePath: resolvedPath,
    task: {
      id: task.id,
      title: task.title,
      role: task.role ?? 'slave',
      masterId: task.masterId ?? null,
      projectPath: task.projectPath ?? null,
      branch: task.branch,
      worktreePath: task.worktreePath ?? null,
      baseBranch: task.baseBranch,
      agentCli: task.agentCli,
      model: task.model,
      effort: task.effort,
      autoMode: task.autoMode,
    },
  }
}

const HOST_COMMANDS = ['start', 'list', 'show']

/**
 * Starting a card runs its agent, and only the host owns sessions; summaries
 * need the host's live progress. So these go to the running host instead of
 * writing the store — and fail rather than half-work without one.
 */
async function hostCommand(
  sub: string,
  values: { task?: string; master?: string },
  storePath: string
): Promise<Record<string, unknown>> {
  if (sub !== 'list' && !values.task) fail('MISSING_ARGUMENT', 'Missing required arguments: --task')
  const lock = liveHost(storePath)
  if (!lock) fail('HOST_NOT_RUNNING', `No VibeFlow host is running for ${storePath}. Start it with \`vibeflow\` first.`)
  const remote = connectToHost(lock)
  try {
    if (sub === 'start') {
      const { task } = await remote.api.startTask(values.task!)
      return { task: { id: task.id, title: task.title, worktreePath: task.worktreePath ?? null } }
    }
    if (sub === 'show') {
      const [task] = await remote.api.taskSummaries({ taskId: values.task })
      return { task }
    }
    return { tasks: await remote.api.taskSummaries(values.master ? { masterId: values.master } : undefined) }
  } catch (err) {
    fail('HOST_ERROR', (err as Error).message)
  } finally {
    remote.close()
  }
}
