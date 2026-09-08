import type {
  AgentCliId,
  BoardCliLaunchInfo,
  LibraryLaunchInfo,
  MemoryLaunchInfo,
  Task,
} from '@/lib/types'

/**
 * Temporary-artifact directory suffix. The agent writes screenshots, reports and
 * logs to `<workspacePath>/<worktree-dir>.artifacts/` (see agentFilePaths) —
 * outside the worktree so git never sees it — falling back to this bare,
 * cwd-relative name only when paths are unknown. Must match
 * ARTIFACTS_DIR_SUFFIX in main/helpers/artifacts.ts (string literal duplicated
 * because the renderer cannot runtime-import main-process modules).
 */
const ARTIFACTS_DIR_SUFFIX = '.artifacts'

/**
 * Subdirectory the agent keeps its own working files in, so the Artifacts view
 * can separate them from the screenshots and reports meant for the user. Must
 * match SCRATCH_DIR_NAME in main/helpers/artifacts.ts (string literal duplicated
 * because the renderer cannot runtime-import main-process modules).
 */
const SCRATCH_DIR_NAME = 'scratch'

/** cwd-relative fallback used when the workspace/worktree paths are unknown. */
const ARTIFACTS_FALLBACK_DIR = '.vibeflow-artifacts'

/** Last path segment, tolerant of both separators and a trailing slash. */
function pathBasename(p: string): string {
  const norm = p.replace(/\\/g, '/').replace(/\/+$/, '')
  const i = norm.lastIndexOf('/')
  return i >= 0 ? norm.slice(i + 1) : norm
}

/** Absolute task-artifact path; null when the workspace or worktree is unknown. */
function agentArtifactsDir(
  worktreePath: string | undefined,
  workspacePath: string | undefined
): string | null {
  if (!worktreePath || !workspacePath) return null
  const dir = toShellPath(workspacePath)
  const ws = pathBasename(worktreePath)
  return `${dir}/${ws}${ARTIFACTS_DIR_SUFFIX}`
}

/**
 * The task's temporary-artifact directory, for display in the UI (the empty
 * Artifacts state tells the user where the agent is expected to write). Null
 * when the workspace or worktree path is unknown.
 */
export function taskArtifactsDir(
  worktreePath: string | undefined,
  workspacePath: string | undefined
): string | null {
  return agentArtifactsDir(worktreePath, workspacePath)
}

/**
 * Session-level instructions for task artifacts. Claude receives this through
 * `--append-system-prompt`; Codex has no equivalent flag, so assembleCommand
 * folds it into the first prompt. Either way the agent sees the absolute path
 * at session start without relying on progress files or PLAN.md.
 */
export function buildArtifactPrompt(
  artifactsDir: string = ARTIFACTS_FALLBACK_DIR
): string {
  return [
    'Artifact 設定（本次 session 全程適用）：',
    `1. 本任務的 Artifact 資料夾是 ${artifactsDir}/；需要保存給使用者的驗證證據或報告時，請寫入此資料夾（不存在請建立）。`,
    `2. 使用者會在 VibeFlow 的 Artifacts 分頁檢視根目錄內容；只放你會主動請使用者過目的檔案。`,
    `3. 你自己的工作暫存（一次性 script、log、中間輸出、debug 檔）放在 ${artifactsDir}/${SCRATCH_DIR_NAME}/。`,
    `4. 若工具先輸出到 /tmp、/private/tmp、$TMPDIR 或 ~/Downloads，請把最終要呈現的檔案複製到 ${artifactsDir}/ 並確認存在。`,
    '5. Artifact 資料夾位於 worktree 之外；不要把其中內容加入 git commit，也不要把最終交付物只留在這裡。',
  ].join('\n')
}

/** The permission mode passed to the Claude CLI ("auto mode"). */
export const DEFAULT_PERMISSION_MODE = 'auto'

/** Quote an arbitrary string for safe use as a single shell argument (POSIX). */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/** Normalize path separators to forward slashes for use inside shell commands. */
function toShellPath(p: string): string {
  return p.replace(/\\/g, '/')
}

/**
 * Card identity exported into the launch shell: which card is running, and how
 * to reach the board it belongs to. A skill splitting work into sub-cards needs
 * this to create them and to rewrite the card it was given; an unset
 * VIBEFLOW_CLI means the board is read-only for the agent (the packaged app
 * ships no CLI), so absent values are omitted rather than exported empty. No
 * board info at all exports nothing: a launch that cannot reach the board must
 * not look to a skill as if it could.
 *
 * `export …;` rather than a `VAR=v cmd` prefix: a resuming Claude launch is a
 * shell `if` statement, which that prefix form cannot carry.
 */
function boardEnvPrefix(
  task: Pick<Task, 'id' | 'projectPath' | 'branch' | 'baseBranch'>,
  opts?: LaunchOptions
): string {
  const board = opts?.boardCli
  if (!board) return ''
  const entries: Array<[string, string | undefined]> = [
    ['VIBEFLOW_TASK_ID', task.id],
    ['VIBEFLOW_PROJECT_PATH', task.projectPath],
    ['VIBEFLOW_BRANCH', task.branch],
    ['VIBEFLOW_BASE_BRANCH', task.baseBranch],
    ['VIBEFLOW_STORE_DIR', board?.storeDir],
    ['VIBEFLOW_CLI', board?.cliPath],
    ['VIBEFLOW_CLI_LOADER', board?.loaderPath],
    ['VIBEFLOW_AUTO_MODE', opts?.autoMode ? '1' : '0'],
  ]
  const exports = entries
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([key, value]) => `${key}=${shellQuote(toShellPath(value))}`)
  return exports.length ? `export ${exports.join(' ')}; ` : ''
}

/**
 * Codex authorization flag driven by Auto Mode. ON → bypass approvals + sandbox
 * (unattended); OFF → '' (Codex stays interactive and waits for approval). The
 * trailing space keeps the caller's template tidy.
 */
function codexAutoFlag(autoMode?: boolean): string {
  return autoMode ? '--dangerously-bypass-approvals-and-sandbox ' : ''
}

/**
 * Build the `--mcp-config` flag that registers VibeFlow's built-in agent-memory
 * server for this Claude launch. Inline JSON (the CLI accepts files or strings);
 * paths are forward-slashed so they need no JSON backslash escaping. The server
 * key `agent-memory` overrides any same-named external server (see
 * LaunchOptions.memory). Returns '' when no memory info is provided.
 */
function buildMemoryMcpFlag(memory?: MemoryLaunchInfo): string {
  if (!memory) return ''
  const config = {
    mcpServers: {
      'agent-memory': {
        command: 'node',
        args: [toShellPath(memory.serverPath), '--db', toShellPath(memory.dbPath)],
      },
    },
  }
  return ` --mcp-config ${shellQuote(JSON.stringify(config))}`
}

/**
 * Build a Claude launch that resumes the pinned session when it exists, else
 * starts it fresh. `claude --resume <id>` hard-fails ("No conversation found")
 * when the session was never persisted — e.g. a prior launch that died before
 * writing history — leaving a task that records `launchedAt` permanently
 * unrunnable. The session lives at `~/.claude/projects/<cwd→dashes>/<id>.jsonl`
 * (every non-alphanumeric in the cwd becomes a dash); a shell `-f` test at
 * launch time picks `--resume` or `--session-id` accordingly. `tail` is every
 * argument after the session flag (flags + system prompt + optional prompt),
 * identical for both branches. Falls back to a plain resume when the cwd is
 * unknown.
 */
function claudeResumeOrFresh(
  sessionId: string,
  worktreePath: string | undefined,
  tail: string
): string {
  if (!worktreePath) return `claude --resume ${sessionId} ${tail}\r`
  const munged = worktreePath.replace(/[^a-zA-Z0-9]/g, '-')
  const sessionFile = `"$HOME/.claude/projects/${munged}/${sessionId}.jsonl"`
  return (
    `if [ -f ${sessionFile} ]; then ` +
    `claude --resume ${sessionId} ${tail}; else ` +
    `claude --session-id ${sessionId} ${tail}; fi\r`
  )
}

/**
 * Directory the Claude hooks append one JSON file per Task-tool event into,
 * relative to the session cwd. Must match SUBAGENTS_DIR in
 * main/helpers/subagents.ts (the watcher reading these files).
 */
const SUBAGENTS_DIR = '.vibeflow-subagents'

/**
 * Build the `--settings` inline-JSON value passed to every `claude` launch.
 * Always pins the light theme so the CLI matches the app's light UI. When a
 * worktree path is given, also wires Claude's Task-tool hooks to record each
 * spawned sub-agent: PreToolUse captures the prompt at spawn; PostToolUse
 * captures the result at completion. Each event is written to its OWN file
 * (`<epoch>-<pid>-<rand>.json`) so parallel sub-agents never interleave bytes
 * into one log. The hook always exits 0 and emits no decision JSON, so it is
 * purely passive — it never blocks or alters the main agent.
 *
 * The event dir is the worktree's absolute path so the location is stable
 * regardless of the agent's cwd at hook time (more robust than $CLAUDE_PROJECT_DIR
 * in a git worktree). `$(date +%s)`, `$$`, `$RANDOM` stay single-quoted here so
 * the outer shell passes them through verbatim — they are expanded later by the
 * shell that actually runs the hook.
 */
function buildClaudeSettings(worktreePath?: string): string {
  const settings: Record<string, unknown> = { theme: 'dark' }
  if (worktreePath) {
    const dir = `${toShellPath(worktreePath)}/${SUBAGENTS_DIR}`
    const command = `mkdir -p "${dir}" && cat > "${dir}/$(date +%s)-$$-$RANDOM.json"`
    const taskHook = {
      matcher: 'Task',
      hooks: [{ type: 'command', command }],
    }
    settings.hooks = { PreToolUse: [taskHook], PostToolUse: [taskHook] }
  }
  return JSON.stringify(settings)
}

/** Resolve the optional user-configured system prompt. */
export function resolveSystemPrompt(custom?: string | null): string {
  return custom && custom.trim() ? custom : ''
}

/** Build the initial prompt fed to the agent from a card's title + description. */
export function buildPrompt(
  task: Pick<Task, 'title' | 'description'>
): string {
  const lines = [`任務標題：${task.title}`]
  const description = task.description?.trim()
  if (description) {
    lines.push('', '任務描述：', description)
  }
  return lines.join('\n')
}

/**
 * Deterministic, stable session UUID for a task conversation,
 * derived from the task id so it survives restarts without persistence.
 * Forces the version (4) and variant (8) nibbles so `claude --session-id`
 * accepts it as a valid UUID.
 */
export function executorSessionId(taskId: string, runId?: string): string {
  const source = runId ? `${taskId}:${runId}` : taskId
  const raw = source.replace(/[^0-9a-f]/gi, '').toLowerCase()
  const hex = runId
    ? `${raw.slice(0, 24).padEnd(24, '0')}${namespaceHash(`executor:${source}`)}`
    : raw.padEnd(32, '0').slice(0, 32)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function namespaceHash(namespace: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < namespace.length; i += 1) {
    hash ^= namespace.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Options controlling how a launch command is built. */
export interface LaunchOptions {
  /**
   * Include the card title and description as the launch's initial message.
   * Defaults to true. Set false for an interactive agent shell that receives
   * only launch settings and Artifact context.
   */
  includeTaskPrompt?: boolean
  /**
   * Resume the prior agent session instead of starting a fresh conversation.
   * For Claude this uses `--resume <sessionId>` (when a sessionId is known)
   * so the exact executor session is restored regardless of what other sessions
   * have run in the same worktree.
   */
  resume?: boolean
  /**
   * When set, the launch injects VibeFlow's built-in agent-memory MCP server
   * (`--mcp-config`) so the session can read/write the shared unified store.
   * The config key `agent-memory` intentionally matches the name a user's own
   * MCP config would use, so it overrides any external same-named server (e.g.
   * the standalone Python install) without needing `--strict-mcp-config` — which
   * would otherwise disable the session's other MCP servers.
   */
  memory?: MemoryLaunchInfo
  /**
   * VibeFlow's own skill / prompt / script library for this launch. Claude
   * loads it as a session-only plugin; Codex gets a CODEX_HOME whose `skills/`
   * VibeFlow assembled, since Codex discovers skills only from there. Absent →
   * nothing is enabled and no library flag is added.
   */
  library?: LibraryLaunchInfo
  /**
   * Store dir + CLI paths the agent needs to create sub-cards and rewrite its
   * own card. Absent → no VIBEFLOW_CLI is exported and the board stays
   * read-only for the agent.
   */
  boardCli?: BoardCliLaunchInfo
  /**
   * Global Auto Mode. For Codex this decides authorization: ON adds
   * `--dangerously-bypass-approvals-and-sandbox` so the agent runs unattended;
   * OFF leaves Codex in its default interactive mode (waits for approval each
   * step). Claude already runs non-interactively via its own flags.
   */
  autoMode?: boolean
}

/**
 * Assemble the final shell command (CR-terminated) for a given agent CLI from
 * an already-resolved system prompt and prompt body. Centralizes the per-CLI
 * differences (flags, how the system prompt is passed, session resume).
 *
 * When `sessionId` is provided the Claude session is pinned:
 *   - First launch (resume=false): `--session-id <id>` creates and pins the id.
 *   - Subsequent launches (resume=true): `--resume <id>` restores that exact session.
 * When `sessionId` is absent, falls back to legacy behaviour (`--continue` for
 * resume, no flag for fresh start) so other call paths are not broken.
 */
function assembleCommand(
  agent: AgentCliId,
  systemPrompt: string,
  prompt: string,
  model: string,
  effort?: Task['effort'],
  opts?: LaunchOptions,
  worktreePath?: string,
  sessionId?: string,
  workspacePath?: string
): string {
  let cmd: string
  if (agent === 'claude') {
    // Inline --settings: dark theme always, sub-agent recording hooks only
    // when the worktree path is known (session-only, never touches the repo).
    const settings = ` --settings ${shellQuote(buildClaudeSettings(worktreePath))}`
    // Grant access to the workspace folder so the agent can write artifacts
    // outside the worktree.
    const addDir = workspacePath
      ? ` --add-dir ${shellQuote(toShellPath(workspacePath))}`
      : ''
    const modelFlag = model ? ` --model ${model}` : ''
    const effortFlag = effort ? ` --effort ${effort}` : ''
    const mcpFlag = buildMemoryMcpFlag(opts?.memory)
    // Library skills ride in as a session-only plugin; --add-dir is what makes
    // its scripts readable and runnable from inside the worktree.
    const library = opts?.library
    const libraryFlags = library
      ? ` --plugin-dir ${shellQuote(toShellPath(library.pluginDir))}` +
        ` --add-dir ${shellQuote(toShellPath(library.libraryDir))}`
      : ''
    const flags = `--chrome --permission-mode ${DEFAULT_PERMISSION_MODE}${modelFlag}${effortFlag}${settings}${addDir}${mcpFlag}${libraryFlags}`
    const sysFlag = systemPrompt
      ? ` --append-system-prompt ${shellQuote(systemPrompt)}`
      : ''
    const promptArg = prompt ? ` ${shellQuote(prompt)}` : ''
    const tail = `${flags}${sysFlag}${promptArg}`
    cmd = (sessionId && opts?.resume)
      ? claudeResumeOrFresh(sessionId, worktreePath, tail)
      : `claude ${sessionId ? `--session-id ${sessionId} ` : opts?.resume ? '--continue ' : ''}${tail}\r`
  } else {
    // Codex has no separate system-prompt flag — fold it into the body.
    const combined = [systemPrompt, prompt].filter(Boolean).join('\n\n')
    const codexEffortFlag = effort
      ? `-c ${shellQuote(`model_reasoning_effort="${effort}"`)} `
      : ''
    // Codex discovers skills only from $CODEX_HOME/skills, so the library is
    // delivered by pointing the launch at the home VibeFlow assembled.
    const codexHome = opts?.library
      ? `CODEX_HOME=${shellQuote(toShellPath(opts.library.codexHome))} `
      : ''
    // Auto Mode ON → bypass approvals so Codex runs unattended; OFF → default
    // interactive mode (waits for the user to approve each step).
    const promptArg = combined ? ` ${shellQuote(combined)}` : ''
    cmd = `${codexHome}codex ${codexAutoFlag(opts?.autoMode)}${codexEffortFlag}--model ${model}${promptArg}\r`
  }
  // ponytail: warn at 200KB — macOS ARG_MAX is 1MB but prompts can grow
  if (cmd.length > 200_000) console.warn(`[VibeFlow] launch command is ${cmd.length} bytes — approaching ARG_MAX`)
  return cmd
}

/** Display names for the supported agent CLIs (mirrors main/helpers/agents.ts). */
export const AGENT_NAMES: Record<AgentCliId, string> = {
  claude: 'Claude Code',
  codex: 'Codex CLI',
}

/**
 * Lightweight default model per agent, mirrored from main/helpers/agents.ts
 * (the renderer cannot runtime-import main-process values). Used as a fallback
 * for tasks created before the model field existed.
 */
const DEFAULT_MODELS: Record<AgentCliId, string> = {
  claude: 'sonnet',
  codex: 'gpt-5.5',
}

const LEGACY_MODEL_FALLBACKS: Partial<Record<AgentCliId, Record<string, string>>> = {
  codex: {
    'gpt-5-codex': 'gpt-5.5',
    'gpt-5': 'gpt-5.5',
  },
}

function normalizeModel(agent: AgentCliId, model: string): string {
  return LEGACY_MODEL_FALLBACKS[agent]?.[model] ?? model
}

/**
 * Resolve a task's agent. Absent means the task predates the field; an
 * unrecognised value means it was written by a build that still offered an
 * agent this one does not — either way claude is the only safe target, since
 * falling through would launch the wrong CLI.
 */
export function taskAgent(task: Pick<Task, 'agentCli'>): AgentCliId {
  const agent = task.agentCli
  return agent && agent in AGENT_NAMES ? agent : 'claude'
}

/** Resolve the model passed to the agent CLI (task.model, else agent default). */
export function taskModel(task: Pick<Task, 'agentCli' | 'model'>): string {
  const agent = taskAgent(task)
  return normalizeModel(agent, task.model || DEFAULT_MODELS[agent])
}

/**
 * Build the launch command for a task's single agent session.
 *
 * Codex has no separate system-prompt flag, so the effective
 * system prompt and task prompt are folded into one CLI argument.
 *
 * Claude receives Artifact instructions as a session system prompt. Codex has
 * no separate system-prompt flag, so they are folded into its initial message.
 */
export function buildAgentCommand(
  task: Pick<
    Task,
    | 'id'
    | 'title'
    | 'description'
    | 'agentCli'
    | 'model'
    | 'effort'
    | 'worktreePath'
    | 'runId'
    | 'projectPath'
    | 'branch'
    | 'baseBranch'
  >,
  systemPrompt?: string | null,
  opts?: LaunchOptions,
  workspacePath?: string
): string {
  const agent = taskAgent(task)
  const model = taskModel(task)
  const artifactsDir = agentArtifactsDir(task.worktreePath, workspacePath)
    ?? ARTIFACTS_FALLBACK_DIR
  const builtInPrompt = buildArtifactPrompt(artifactsDir)
  const libraryPrompt = opts?.library?.promptText?.trim()
  const customPrompt = resolveSystemPrompt(systemPrompt)
  const sys = [builtInPrompt, libraryPrompt, customPrompt].filter(Boolean).join('\n\n')
  const includeTaskPrompt = opts?.includeTaskPrompt !== false
  // Resuming restores the existing conversation verbatim. Do not submit a new
  // user turn automatically; the user can decide what to ask next.
  const prompt = includeTaskPrompt && !opts?.resume ? buildPrompt(task) : ''
  // An agent-only launch is intentionally independent from the task's pinned
  // conversation. Claude creates a fresh interactive session of its own.
  const sessionId = agent === 'claude' && includeTaskPrompt
    ? executorSessionId(task.id, task.runId)
    : undefined
  return (
    boardEnvPrefix(task, opts) +
    assembleCommand(
      agent,
      sys,
      prompt,
      model,
      task.effort,
      opts,
      task.worktreePath,
      sessionId,
      workspacePath
    )
  )
}
