import type { AgentCliId } from './agents'
import type { ManualEffort } from './effort'

/**
 * The headless inventory pass: one agent run, no terminal, that writes a
 * card's spec.md and plan.md (with its 執行準備) and checks what the run will
 * need. It must never be able to do the work itself, so it runs on a fixed
 * allowlist (Claude) or a workspace-only sandbox (Codex).
 */

/** Where an inventory may write. Everything else in the worktree is read-only to it. */
export const INVENTORY_DOCS_DIR = 'docs/features'

/**
 * Shell commands an inventory may run without asking, as command prefixes.
 * Each checks something without printing a secret: auth checks report who is
 * signed in, not the token.
 */
export const BUILTIN_INVENTORY_COMMANDS: readonly string[] = [
  'git status',
  'git log',
  'git diff',
  'git branch',
  'git fetch',
  'git remote -v',
  'ls',
  'npm ping',
  'npm whoami',
  'npm view',
  'npm config get registry',
  'npm ls',
  'npm run typecheck',
  'npm run lint',
  'npm test',
  'npm run test',
  'npx tsc --noEmit',
  'gh auth status',
  'gh repo view',
]

/** Reading these could print a secret, so even the Read tool is refused them. */
const SECRET_PATHS = ['./.env', './.env.*', './**/.env', './**/.env.*', './.npmrc', './**/.npmrc', '~/.npmrc', '~/.ssh/**', '~/.aws/**', '~/.config/gh/**']

/** A command prefix a user may add: plain words, no shell syntax that could chain or quote. */
export function isSafeInventoryCommand(command: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9 ._:/@=+-]*$/.test(command.trim()) && command.trim().length <= 120
}

export function inventoryCommands(extra: readonly string[]): string[] {
  const all = [...BUILTIN_INVENTORY_COMMANDS, ...extra.map((c) => c.trim()).filter(isSafeInventoryCommand)]
  return all.filter((c, i) => all.indexOf(c) === i)
}

/** Claude's `--allowedTools` for an inventory: read anything, write only the feature docs, run only the listed checks. */
export function inventoryAllowedTools(extra: readonly string[]): string[] {
  return [
    'Read',
    'Glob',
    'Grep',
    'LS',
    `Edit(./${INVENTORY_DOCS_DIR}/**)`,
    ...inventoryCommands(extra).map((c) => `Bash(${c}:*)`),
  ]
}

export function inventoryDisallowedTools(): string[] {
  return SECRET_PATHS.map((p) => `Read(${p})`)
}

/** cmd.exe gets one joined line: a token with a space or parenthesis must be quoted there. */
function platformToken(token: string, platform: NodeJS.Platform): string {
  return platform === 'win32' && /[\s()*]/.test(token) ? `"${token}"` : token
}

export interface InventoryLaunch {
  agent: AgentCliId
  model?: string
  effort?: ManualEffort
  /** Claude session id, so the pass's transcript can be read for a usage limit. */
  sessionId: string
  extraCommands: readonly string[]
  platform?: NodeJS.Platform
}

/**
 * The CLI arguments for one pass; the prompt goes in on stdin. Claude runs in
 * `dontAsk`: any tool not on the list is refused instead of waiting for an
 * approval nobody can give.
 */
export function inventoryArgs(launch: InventoryLaunch): string[] {
  const platform = launch.platform ?? process.platform
  if (launch.agent === 'claude') {
    return [
      '-p',
      '--permission-mode', 'dontAsk',
      '--session-id', launch.sessionId,
      ...(launch.model ? ['--model', launch.model] : []),
      ...(launch.effort ? ['--effort', launch.effort] : []),
      '--allowedTools', ...inventoryAllowedTools(launch.extraCommands).map((t) => platformToken(t, platform)),
      '--disallowedTools', ...inventoryDisallowedTools().map((t) => platformToken(t, platform)),
    ]
  }
  return [
    'exec',
    '--sandbox', 'workspace-write',
    // The sandbox has no network by default, and checking a registry or a
    // login needs one (measured with codex-cli 0.170.0).
    '-c', 'sandbox_workspace_write.network_access=true',
    '--skip-git-repo-check',
    ...(launch.model ? ['--model', launch.model] : []),
    ...(launch.effort ? ['-c', `model_reasoning_effort=${launch.effort}`] : []),
    '-',
  ]
}

export const INVENTORY_RESULT_MARK = 'VIBEFLOW_INVENTORY_RESULT:'
const MAX_SUMMARY_CHARS = 6000

export interface InventoryResult {
  /** null = the pass did not say. */
  result: 'ready' | 'needs_answer' | null
  /** What the pass said, without the result line. */
  summary: string
}

/** The pass's closing reply: its last result line decides, the rest is the summary shown in the panel. */
export function parseInventoryResult(stdout: string): InventoryResult {
  const lines = stdout.replace(/\r/g, '').split('\n')
  let result: InventoryResult['result'] = null
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const m = lines[i].match(/VIBEFLOW_INVENTORY_RESULT:\s*`?(ready|needs_answer)`?/)
    if (m) {
      result = m[1] as 'ready' | 'needs_answer'
      break
    }
  }
  const summary = lines.filter((l) => !l.includes(INVENTORY_RESULT_MARK)).join('\n').trim()
  return { result, summary: summary.length > MAX_SUMMARY_CHARS ? `…${summary.slice(-MAX_SUMMARY_CHARS)}` : summary }
}
