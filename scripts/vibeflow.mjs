#!/usr/bin/env node
// Run via: node --experimental-strip-types scripts/vibeflow.mjs <command>
// Or:      npm run vibeflow -- <command>
import { parseArgs } from 'node:util'
import { homedir } from 'node:os'
import { createTaskFromInput } from '../main/helpers/tasks.ts'
import { fileToAttachmentInput } from '../main/helpers/attachments.ts'
import { AGENT_CLIS, AGENT_EFFORTS } from '../main/helpers/agents.ts'
import { getStoreAtPath } from '../main/helpers/store.ts'

const AGENT_IDS = AGENT_CLIS.map((agent) => agent.id)
const STATUSES = ['backlog', 'in_progress', 'done']
const MODES = ['existing', 'new']

const USAGE = `
VibeFlow CLI

Usage:
  vibeflow task create [options]
  vibeflow role list [--json]

task create options:
  --project <path>       Target project directory (required)
  --title <text>         Task title (required)
  --prompt <text>        Task prompt / description (required)
  --status <column>      ${STATUSES.join(' | ')}  (default: backlog)
  --base-branch <name>   Branch the worktree is created from (default: repo's current branch)
  --mode <mode>          ${MODES.join(' | ')}  (default: existing; "new" runs git init first)
  --agent <id>           Planning/review agent: ${AGENT_IDS.join(' | ')}  (default: claude)
  --model <id>           Planning/review model (default: the agent's own default)
  --exec-agent <id>      Execution agent (default: --agent)
  --exec-model <id>      Execution model (default: --model, or the agent's default)
  --effort <level>       ${AGENT_EFFORTS.join(' | ')}  (default: medium, same as the UI)
  --role <id|name>       Executor role; see \`role list\` (default: none)
  --attach <path>        Attach a file; repeat the flag for several files
  --store-path <dir>     Explicit electron-store directory
  --profile <name>       dev | prod — shorthand for common store paths
  -h, --help             Show this help

role list options:
  --json                 Machine-readable output instead of a table
  --store-path <dir>     Explicit electron-store directory
  --profile <name>       dev | prod — shorthand for common store paths

Notes:
  A card created with --status in_progress does NOT start running by itself;
  auto-launch only fires when a card is moved in the app. Leave it in backlog
  unless you plan to start it from the UI.

Examples:
  node --experimental-strip-types scripts/vibeflow.mjs task create \\
    --project /path/to/project \\
    --title "Fix login bug" \\
    --prompt "Investigate and fix the login failure" \\
    --effort high \\
    --role 87969ac0 \\
    --attach ./screenshot.png \\
    --profile dev
`.trim()

/** Resolve the store directory from --store-path or --profile (macOS only). */
function resolveStorePath(storePath, profile) {
  if (storePath) return storePath
  const home = homedir()
  if (profile === 'dev') return `${home}/Library/Application Support/VibeFlow (development)`
  // Default to prod path (matches packaged Electron app on macOS).
  return `${home}/Library/Application Support/VibeFlow`
}

function fail(code, message) {
  process.stdout.write(JSON.stringify({ ok: false, error: { code, message } }) + '\n')
  process.exit(1)
}

/** Reject a flag whose value is outside the allowed set. */
function requireOneOf(flag, value, allowed) {
  if (value !== undefined && !allowed.includes(value)) {
    fail('INVALID_ARGUMENT', `${flag} must be one of: ${allowed.join(', ')}`)
  }
}

function readRoles(storePath) {
  try {
    return getStoreAtPath(storePath).get('roles') ?? []
  } catch (err) {
    fail('STORE_READ_FAILED', `無法讀取 store：${err.message}`)
  }
}

/** Match --role against role ids first, then exact names (case-insensitive). */
function resolveRoleId(input, roles) {
  const byId = roles.find((role) => role.id === input)
  if (byId) return byId.id

  const wanted = input.trim().toLowerCase()
  const byName = roles.filter((role) => role.name.trim().toLowerCase() === wanted)
  if (byName.length === 1) return byName[0].id
  if (byName.length > 1) {
    fail('ROLE_AMBIGUOUS', `Role name "${input}" matches ${byName.length} roles — pass the id instead (see: role list)`)
  }
  fail('ROLE_NOT_FOUND', `No role matched "${input}" (see: role list)`)
}

let parsed
try {
  parsed = parseArgs({
    args: process.argv.slice(2),
    options: {
      project:       { type: 'string' },
      title:         { type: 'string' },
      prompt:        { type: 'string' },
      status:        { type: 'string' },
      'base-branch': { type: 'string' },
      mode:          { type: 'string' },
      agent:         { type: 'string' },
      model:         { type: 'string' },
      'exec-agent':  { type: 'string' },
      'exec-model':  { type: 'string' },
      effort:        { type: 'string' },
      role:          { type: 'string' },
      attach:        { type: 'string', multiple: true },
      'store-path':  { type: 'string' },
      profile:       { type: 'string' },
      json:          { type: 'boolean' },
      help:          { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
    strict: true,
  })
} catch (err) {
  fail('INVALID_ARGUMENT', err.message)
}

const { values, positionals } = parsed
const [cmd, sub] = positionals

if (values.help || (!cmd && !values.project)) {
  console.log(USAGE)
  process.exit(0)
}

const storePath = resolveStorePath(values['store-path'], values.profile)

if (cmd === 'role' && sub === 'list') {
  const roles = readRoles(storePath)
  if (values.json) {
    // Avatars are inlined data-URL images — kilobytes of base64 that would bury
    // the fields a caller actually picks a role by. Report presence instead.
    const listed = roles.map(({ avatar, ...role }) => ({ ...role, hasAvatar: Boolean(avatar) }))
    process.stdout.write(JSON.stringify({ ok: true, storePath, roles: listed }, null, 2) + '\n')
  } else if (roles.length === 0) {
    process.stdout.write(`No roles found in ${storePath}\n`)
  } else {
    const width = Math.max(2, ...roles.map((role) => role.id.length))
    process.stdout.write(`${'ID'.padEnd(width)}  NAME\n`)
    for (const role of roles) {
      process.stdout.write(`${role.id.padEnd(width)}  ${role.name}\n`)
    }
  }
  process.exit(0)
}

if (cmd !== 'task' || sub !== 'create') {
  fail('UNKNOWN_COMMAND', `Unknown command: "${[cmd, sub].filter(Boolean).join(' ')}". Use: task create | role list`)
}

const missing = []
if (!values.project) missing.push('--project')
if (!values.title)   missing.push('--title')
if (!values.prompt)  missing.push('--prompt')
if (missing.length) {
  fail('MISSING_ARGUMENT', `Missing required arguments: ${missing.join(', ')}`)
}

requireOneOf('--status', values.status, STATUSES)
requireOneOf('--mode', values.mode, MODES)
requireOneOf('--agent', values.agent, AGENT_IDS)
requireOneOf('--exec-agent', values['exec-agent'], AGENT_IDS)
requireOneOf('--effort', values.effort, AGENT_EFFORTS)

const roleId = values.role ? resolveRoleId(values.role, readRoles(storePath)) : undefined

let attachments = []
try {
  attachments = (values.attach ?? []).map(fileToAttachmentInput)
} catch (err) {
  fail('ATTACHMENT_READ_FAILED', `無法讀取附件：${err.message}`)
}

try {
  const { task, storePath: resolvedPath } = await createTaskFromInput({
    projectPath: values.project,
    title: values.title,
    description: values.prompt,
    status: values.status ?? 'backlog',
    baseBranch: values['base-branch'] ?? null,
    mode: values.mode ?? 'existing',
    agentCli: values.agent,
    model: values.model,
    executionAgentCli: values['exec-agent'],
    executionModel: values['exec-model'],
    effort: values.effort,
    roleId,
    attachments,
    storePath,
  })
  process.stdout.write(JSON.stringify({
    ok: true,
    storePath: resolvedPath,
    task: {
      id: task.id,
      title: task.title,
      projectPath: task.projectPath,
      branch: task.branch,
      worktreePath: task.worktreePath,
      baseBranch: task.baseBranch,
      agentCli: task.agentCli,
      model: task.model,
      executionAgentCli: task.executionAgentCli,
      executionModel: task.executionModel,
      effort: task.effort,
      roleId: task.roleId,
    },
  }, null, 2) + '\n')
} catch (err) {
  fail(err.code ?? 'UNKNOWN_ERROR', err.message)
}
