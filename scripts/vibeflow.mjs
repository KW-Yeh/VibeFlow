#!/usr/bin/env node
// Run via: node --experimental-strip-types scripts/vibeflow.mjs <command>
// Or:      npm run vibeflow -- <command>
import { parseArgs } from 'node:util'
import { homedir } from 'node:os'
import { createTaskFromInput } from '../main/helpers/tasks.ts'

const USAGE = `
VibeFlow CLI

Usage:
  vibeflow task create [options]

Options:
  --project <path>      Target project directory (required)
  --title <text>        Task title (required)
  --prompt <text>       Task prompt / description (required)
  --status <column>     backlog | in_progress | done  (default: backlog)
  --store-path <dir>    Explicit electron-store directory
  --profile <name>      dev | prod — shorthand for common store paths
  -h, --help            Show this help

Examples:
  node --experimental-strip-types scripts/vibeflow.mjs task create \\
    --project /path/to/project \\
    --title "Fix login bug" \\
    --prompt "Investigate and fix the login failure" \\
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

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    project:      { type: 'string' },
    title:        { type: 'string' },
    prompt:       { type: 'string' },
    status:       { type: 'string' },
    'store-path': { type: 'string' },
    profile:      { type: 'string' },
    help:         { type: 'boolean', short: 'h' },
  },
  allowPositionals: true,
  strict: false,
})

const [cmd, sub] = positionals

if (values.help || (!cmd && !values.project)) {
  console.log(USAGE)
  process.exit(0)
}

if (cmd !== 'task' || sub !== 'create') {
  fail('UNKNOWN_COMMAND', `Unknown command: "${[cmd, sub].filter(Boolean).join(' ')}". Use: task create`)
}

const missing = []
if (!values.project) missing.push('--project')
if (!values.title)   missing.push('--title')
if (!values.prompt)  missing.push('--prompt')
if (missing.length) {
  fail('MISSING_ARGUMENT', `Missing required arguments: ${missing.join(', ')}`)
}

const validStatuses = ['backlog', 'in_progress', 'done']
if (values.status && !validStatuses.includes(values.status)) {
  fail('MISSING_ARGUMENT', `--status must be one of: ${validStatuses.join(', ')}`)
}

const storePath = resolveStorePath(values['store-path'], values.profile)

try {
  const { task, storePath: resolvedPath } = await createTaskFromInput({
    projectPath: values.project,
    title: values.title,
    description: values.prompt,
    status: values.status ?? 'backlog',
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
    },
  }, null, 2) + '\n')
} catch (err) {
  fail(err.code ?? 'UNKNOWN_ERROR', err.message)
}
