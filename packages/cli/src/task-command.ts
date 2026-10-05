import { parseArgs } from 'node:util'
import { createTaskFromInput, updateTaskFromInput } from '../../core/src/tasks'
import { fileToAttachmentInput, type AttachmentInput } from '../../core/src/attachments'
import { AGENT_CLIS, AGENT_EFFORTS, type AgentCliId, type AgentEffort } from '../../core/src/agents'
import { createNodePlatform, defaultUserDataDir, setPlatform } from '../../core/src/platform'
import type { ColumnId } from '../../core/src/store'

const AGENT_IDS: string[] = AGENT_CLIS.map((agent) => agent.id)
const STATUSES = ['backlog', 'in_progress', 'done']
const SUBCOMMANDS = ['create', 'update']
const MODES = ['existing', 'new']
const AUTO_MODES = ['on', 'off']

export const TASK_USAGE = `
VibeFlow task commands

Usage:
  vibeflow task create [options]
  vibeflow task update [options]

task create options:
  --project <path>       Target project directory (required)
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
  --effort <level>       ${AGENT_EFFORTS.join(' | ')}  (default: medium, same as the UI)
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
  --store-path <dir>     Explicit store directory
  --profile <name>       dev | prod — shorthand for common store paths

  At least one of --title / --prompt / --status is required. Branch, worktree
  and project path are provisioned on disk and cannot be changed here.

Notes:
  A card created with --status in_progress does NOT start running by itself.
  Every launch is started by hand from the app.

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
  const [sub] = positionals
  if (values.help || !sub) return null

  const storePath = resolveStorePath(values['store-path'], values.profile)
  setPlatform(createNodePlatform({ userDataDir: storePath }))

  if (!SUBCOMMANDS.includes(sub)) {
    fail('UNKNOWN_COMMAND', `Unknown command: "task ${sub}". Use: ${SUBCOMMANDS.map((s) => `task ${s}`).join(' | ')}`)
  }

  if (sub === 'update') {
    if (!values.task) fail('MISSING_ARGUMENT', 'Missing required arguments: --task')
    requireOneOf('--status', values.status, STATUSES)
    if (values.title === undefined && values.prompt === undefined && values.status === undefined) {
      fail('MISSING_ARGUMENT', 'task update needs at least one of: --title, --prompt, --status')
    }
    const { task, storePath: resolvedPath } = updateTaskFromInput({
      taskId: values.task,
      title: values.title,
      description: values.prompt,
      status: values.status as ColumnId | undefined,
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
      },
    }
  }

  const missing = []
  if (!values.project) missing.push('--project')
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
    projectPath: values.project!,
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
      projectPath: task.projectPath,
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
