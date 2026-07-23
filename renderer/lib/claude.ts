import type { AgentCliId, MemoryLaunchInfo, Role, Task } from '@/lib/types'
import presetRolesData from '@/lib/preset-roles.json'

/**
 * Default system prompt appended when auto-launching Claude for a card. It
 * drives a PM-style plan-then-execute, stage-gated workflow inside the task's
 * isolated git worktree. Users can override it via the settings dialog.
 */
export const DEFAULT_SYSTEM_PROMPT = [
  '你是在一個隔離的 git worktree 中，負責帶領任務從規劃到交付的專案協調者（PM）。全程使用繁體中文回報，並嚴格依循以下生命週期執行：',
  '',
  '## 專案生命週期（工作流）',
  '你必須帶領任務依序經歷以下四個階段。只有當前階段的條件滿足後，才能進入下一階段：',
  '',
  '### 階段一：規劃任務（Context 建立）',
  '評估需求完整性（規格、邊界條件、目標是否明確）。如需求不完善，進行多輪詢問直到補齊所有必要 context。確認完整後，提出初步的分工與執行計劃。',
  '',
  '### 階段二：檢視並修正計劃',
  '將計畫提交給相關角色進行檢視（Design 評估視覺可行性、RD 評估技術可行性與時程）。根據反饋調整計畫，直到達成共識。',
  '',
  '### 階段三：執行計劃',
  '正式指派任務給負責執行的主要角色（Design / RD / QA）開始施工。',
  '',
  '### 階段四：驗收與修復（非必經，視需求而定）',
  '依照計劃中定義的驗收標準進行驗收：指派 QA 進行功能測試，或指派 Design 進行畫面驗收。若有 Bug/瑕疵，回報給原執行角色修復並再次驗收；若通過則結束此階段。',
  '',
  '## 結案總結',
  '所有環節執行完畢且確認無後續驗收或修復工作時，進行結案總結，列出最終成果與交付狀態。',
].join('\n')

/**
 * Built-in role templates the user can pick from when creating a new role, and
 * the seeded default roles. Single source shared with main's DEFAULT_ROLES
 * (both import the same JSON — see main/helpers/store.ts).
 */
export const PRESET_ROLES = presetRolesData as Role[]

/** Look up a preset by its stable id (ids are guaranteed present in the JSON). */
function presetById(id: string): Role {
  const role = PRESET_ROLES.find((r) => r.id === id)
  if (!role) throw new Error(`preset role ${id} missing from preset-roles.json`)
  return role
}

/** 路卡利歐 - 專案經理: persona injected during the planning phase. */
export const PLANNING_ROLE = presetById('49abf867')

/**
 * Progress file suffix. The agent writes to `<userData>/<workspace>.vibeflow-progress.json`
 * (see agentFilePaths) — an absolute path outside the worktree so git never sees
 * it — falling back to this bare, cwd-relative name only when the base dir is
 * unknown. Must match PROGRESS_FILE in main/helpers/progress.ts (string literal
 * duplicated because the renderer cannot runtime-import main-process modules).
 */
const PROGRESS_FILE = '.vibeflow-progress.json'

/**
 * Planning artifact base name. The agent writes it to
 * `<workspacePath>/<worktree-dir>.PLAN.md` (see agentFilePaths) — outside the
 * worktree so git never sees it — falling back to this bare, cwd-relative name
 * only when paths are unknown. Must match PLAN_FILE in main/helpers/progress.ts.
 */
const PLAN_FILE = 'PLAN.md'

/** Last path segment, tolerant of both separators and a trailing slash. */
function pathBasename(p: string): string {
  const norm = p.replace(/\\/g, '/').replace(/\/+$/, '')
  const i = norm.lastIndexOf('/')
  return i >= 0 ? norm.slice(i + 1) : norm
}

/**
 * Absolute paths the agent writes its progress / plan files to. They live
 * directly in the task's workspace folder (the worktree's parent), named by the
 * worktree folder, so git never sees them and concurrent tasks never collide.
 * Mirrors main/helpers/progress.ts agentProgressPath/agentPlanPath — keep both
 * in sync. Returns null when the workspace path or worktree is unknown, so
 * callers fall back to the legacy cwd-relative names.
 */
function agentFilePaths(
  worktreePath: string | undefined,
  workspacePath: string | undefined
): { progress: string; plan: string } | null {
  if (!worktreePath || !workspacePath) return null
  const dir = toShellPath(workspacePath)
  const ws = pathBasename(worktreePath)
  return {
    progress: `${dir}/${ws}${PROGRESS_FILE}`,
    plan: `${dir}/${ws}.${PLAN_FILE}`,
  }
}

/**
 * Fixed protocol appended to the task prompt body. It makes the agent persist
 * its plan (to `planFile`) + step states (to `progressFile`), which main watches
 * and mirrors into the task record — enabling card progress display, the Plan
 * view, and resume-on-rerun. Kept separate from DEFAULT_SYSTEM_PROMPT so editing
 * the workflow prompt cannot break progress tracking.
 */
function buildProgressProtocolLines(progressFile: string, planFile: string): string {
  return [
    '進度追蹤協議（務必遵守）：',
    `1. 規劃階段：先把執行計劃寫入 ${planFile}（Markdown 格式，包含任務目標、執行步驟、預期成果）。`,
    `2. 若需求足夠明確，可形成可執行計劃，${planFile} 建立完成後立即把步驟列表寫入 ${progressFile}，JSON 格式：{"summary": "一句話描述目前狀態", "planDone": true, "needsUserInput": false, "steps": [{"text": "步驟描述", "done": false}]}。planDone 設為 true 代表計劃完成，進入執行階段。`,
    `3. 若 planning 發現必須先詢問使用者才能完善計劃，請先向使用者提出具體問題，並把 ${progressFile} 寫成 {"summary": "需要使用者補充的問題摘要", "planDone": false, "needsUserInput": true, "steps": []}；不要開始執行。`,
    '4. 每完成一個步驟，立即把該步驟的 done 改為 true、把 needsUserInput 設為 false，並更新 summary。',
    `5. 若 ${progressFile} 已存在且 planDone 為 true，代表此任務先前執行過：先讀取內容，跳過 done 為 true 的步驟，從未完成的步驟接續執行。`,
    `6. 進度檔（${progressFile}）與計劃檔（${planFile}）由 VibeFlow 統一管理，位於 worktree 之外，切勿將其加入 git commit。`,
    '7. Agent Memory（VibeFlow 內建、跨所有專案共用的統一記憶庫）：本任務已自動接上 `agent-memory` MCP server，無需另外安裝。所有 memory 操作的 task id 一律用本任務的 git 分支名（在 worktree 執行 `git rev-parse --abbrev-ref HEAD` 取得），app 會以分支名回查此任務的 checkpoint 與關聯。',
    '8. 規劃階段開始時：先呼叫 `memory_find_related_tasks`（query 用本次需求關鍵字）看有無可重用的過往任務；有相關的再用 `memory_get_task_detail` 載入細節。任務完成或交接時：用 `memory_save_checkpoint`（task id = 分支名）封存本次成果（rolling summary、outcome、關鍵決策+理由、待辦；大型輸出放 artifacts），捨棄試誤過程。任務間有穩定關係（derived_from / supersedes / depends_on…）時用 `memory_link_tasks` 記錄。',
  ].join('\n')
}

/**
 * Fixed progress-tracking protocol. `progressFile` / `planFile` are the paths
 * the agent writes to — absolute workspace-folder paths when known (see
 * agentFilePaths), else the legacy cwd-relative filenames. Exported const uses
 * the relative fallbacks for backward-compatible callers/tests.
 */
export function buildProgressProtocol(
  progressFile: string = PROGRESS_FILE,
  planFile: string = PLAN_FILE
): string {
  return buildProgressProtocolLines(progressFile, planFile)
}

export const PROGRESS_PROTOCOL_PROMPT = buildProgressProtocolLines(PROGRESS_FILE, PLAN_FILE)

function appendProgressProtocol(
  prompt: string,
  progressFile?: string,
  planFile?: string
): string {
  return `${prompt}\n\n${buildProgressProtocol(progressFile, planFile)}`
}

/** The permission mode passed to the Claude CLI ("auto mode"). */
export const DEFAULT_PERMISSION_MODE = 'auto'

/**
 * Build the role preamble prepended to the system prompt when a task is
 * assigned a role. It instructs the agent to take on the role's persona, so it
 * understands and executes the task from that role's perspective. Returns ''
 * for no role (default behavior) or an empty/unnamed role.
 */
export function buildRolePrompt(
  role?: Pick<
    Role,
    'name' | 'positioning' | 'responsibilities' | 'boundaries'
  > | null
): string {
  if (!role || !role.name?.trim()) return ''
  const lines = [
    `你現在是一位資深的${role.name.trim()}。請根據以下角色定位與邊界限制，來審視並執行接下來的任務：`,
  ]
  const positioning = role.positioning?.trim()
  const responsibilities = role.responsibilities?.trim()
  const boundaries = role.boundaries?.trim()
  if (positioning) lines.push('', '【角色定位】', positioning)
  if (responsibilities) lines.push('', '【職責內容】', responsibilities)
  if (boundaries) lines.push('', '【執行邊界】', boundaries)
  return lines.join('\n')
}

/** Quote an arbitrary string for safe use as a single shell argument (POSIX). */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/** Normalize path separators to forward slashes for use inside shell commands. */
function toShellPath(p: string): string {
  return p.replace(/\\/g, '/')
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
 * argument after the session flag (flags + system prompt + prompt), identical
 * for both branches. Falls back to a plain resume when the cwd is unknown.
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
  const settings: Record<string, unknown> = { theme: 'light' }
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

/**
 * Resolve the effective system prompt: the assigned role's persona (when set)
 * in front, then the user's custom prompt when set (non-blank) otherwise the
 * built-in default. Runtime file-writing instructions stay in the prompt body
 * because their paths are per-launch values derived from the unified files dir.
 */
export function resolveSystemPrompt(
  custom?: string | null,
  role?: Parameters<typeof buildRolePrompt>[0]
): string {
  const base = custom && custom.trim() ? custom : DEFAULT_SYSTEM_PROMPT
  const rolePrompt = buildRolePrompt(role)
  return rolePrompt ? `${rolePrompt}\n\n${base}` : base
}

/**
 * True when the card's recorded progress shows every step done — i.e. the task
 * has finished. Used to decide whether a re-open should resume the agent (work
 * still pending) or simply keep the terminal open without auto-running.
 */
export function isTaskComplete(task: Pick<Task, 'progress'>): boolean {
  const steps = task.progress?.steps
  return !!steps && steps.length > 0 && steps.every((s) => s.done)
}

/**
 * Build the initial prompt fed to Claude from a card's title + description.
 * When the card carries previously recorded progress, it is included so a
 * re-run resumes from the recorded state instead of starting over.
 */
export function buildPrompt(
  task: Pick<Task, 'title' | 'description' | 'progress'>
): string {
  const lines = [`任務標題：${task.title}`]
  const description = task.description?.trim()
  if (description) {
    lines.push('', '任務描述：', description)
  }
  const progress = task.progress
  if (progress && progress.steps.length > 0) {
    lines.push('', '先前已記錄的進度（請接續執行，勿重做已完成的步驟）：')
    if (progress.summary) lines.push(`摘要：${progress.summary}`)
    for (const step of progress.steps) {
      lines.push(`- [${step.done ? 'x' : ' '}] ${step.text}`)
    }
  }
  return lines.join('\n')
}

export function buildPlanningPrompt(
  task: Pick<Task, 'title' | 'description'>
): string {
  const lines = [buildPrompt(task)]
  lines.push(
    '',
    '若需求足夠明確，建立 PLAN.md，依進度追蹤協議寫入 planDone=true、needsUserInput=false 與 steps，然後直接進入執行階段，依序完成所有步驟。',
    '若需求仍缺少必要資訊，請先提出具體問題，並依進度追蹤協議寫入 planDone=false、needsUserInput=true，然後停止等待使用者回覆。'
  )
  return lines.join('\n')
}

/**
 * Build the message sent as a new turn when resuming a prior agent session.
 * The conversation history is restored by the CLI's resume flag, so this only
 * needs to nudge the agent to pick up from the last recorded progress instead
 * of re-stating the whole task.
 */
export function buildResumePrompt(
  task: Pick<Task, 'progress'>
): string {
  const lines = [
    '請接續先前的工作：從尚未完成的步驟繼續執行，已完成的步驟請勿重做。',
  ]
  const progress = task.progress
  if (progress && progress.steps.length > 0) {
    lines.push('', '最後記錄的進度：')
    if (progress.summary) lines.push(`摘要：${progress.summary}`)
    for (const step of progress.steps) {
      lines.push(`- [${step.done ? 'x' : ' '}] ${step.text}`)
    }
  }
  return lines.join('\n')
}

export function buildExecutionPrompt(
  task: Pick<Task, 'progress'>
): string {
  const lines = [
    'Planning 已完成，請直接進入執行階段。',
    '依照 PLAN.md 與下列進度，從第一個未完成的步驟開始實作；已完成的步驟請勿重做。',
    '只有在執行前發現計劃仍缺少必要使用者資訊時，才停止並提出具體問題，同時把進度檔標記為 needsUserInput=true。',
  ]
  const progress = task.progress
  if (progress && progress.steps.length > 0) {
    lines.push('', '目前記錄的步驟：')
    if (progress.summary) lines.push(`摘要：${progress.summary}`)
    for (const step of progress.steps) {
      lines.push(`- [${step.done ? 'x' : ' '}] ${step.text}`)
    }
  }
  return lines.join('\n')
}

/**
 * Deterministic, stable session UUID for a task's executor conversation,
 * derived from the task id so it survives restarts without persistence.
 * Forces the version (4) and variant (8) nibbles so `claude --session-id`
 * accepts it as a valid UUID.
 */
export function executorSessionId(taskId: string): string {
  const hex = taskId.replace(/[^0-9a-f]/gi, '').toLowerCase().padEnd(32, '0').slice(0, 32)
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

/** Stable Claude session UUID for the planning conversation. */
export function planningSessionId(taskId: string): string {
  const taskHex = taskId.replace(/[^0-9a-f]/gi, '').toLowerCase().padEnd(24, '0').slice(0, 24)
  const hex = `${taskHex}${namespaceHash('planning')}`
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

/** Options controlling how a launch command is built. */
export interface LaunchOptions {
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
   * Global Auto Mode. For Codex this decides authorization: ON adds
   * `--dangerously-bypass-approvals-and-sandbox` so the agent runs unattended;
   * OFF leaves Codex in its default interactive mode (waits for approval each
   * step). Claude/Gemini already run non-interactively via their own flags.
   */
  autoMode?: boolean
}

/**
 * Build the full shell command (terminated with a carriage return) that
 * launches Claude in auto mode with the card's prompt and the effective
 * system prompt. Written verbatim into the card's PTY.
 *
 * Planning and execution use separate deterministic Claude sessions. This
 * prevents the execution phase from trying to create a fresh session with the
 * same id that the planning phase already used.
 */
export function buildClaudeCommand(
  task: Pick<Task, 'id' | 'title' | 'description' | 'progress' | 'model' | 'worktreePath'>,
  systemPrompt?: string | null,
  role?: Parameters<typeof buildRolePrompt>[0],
  opts?: LaunchOptions,
  workspacePath?: string
): string {
  const isExecution = task.progress?.planDone === true
  const files = agentFilePaths(task.worktreePath, workspacePath)
  const sys = resolveSystemPrompt(systemPrompt, isExecution ? role : PLANNING_ROLE)
  const basePrompt = isExecution
    ? opts?.resume ? buildResumePrompt(task) : buildExecutionPrompt(task)
    : buildPlanningPrompt(task)
  const prompt = appendProgressProtocol(basePrompt, files?.progress, files?.plan)
  const model = task.model || DEFAULT_MODELS.claude
  const sessionId = isExecution ? executorSessionId(task.id) : planningSessionId(task.id)
  return assembleCommand('claude', sys, prompt, model, opts, task.worktreePath, sessionId, workspacePath)
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
  opts?: LaunchOptions,
  worktreePath?: string,
  sessionId?: string,
  workspacePath?: string
): string {
  let cmd: string
  if (agent === 'claude') {
    // Inline --settings: light theme always, sub-agent recording hooks only
    // when the worktree path is known (session-only, never touches the repo).
    const settings = ` --settings ${shellQuote(buildClaudeSettings(worktreePath))}`
    // Grant the agent write access to the workspace folder (the worktree's
    // parent) so it can write the progress/review/PLAN files there even though
    // it runs with cwd inside the worktree.
    const addDir = workspacePath
      ? ` --add-dir ${shellQuote(toShellPath(workspacePath))}`
      : ''
    const modelFlag = model ? ` --model ${model}` : ''
    const mcpFlag = buildMemoryMcpFlag(opts?.memory)
    const flags = `--chrome --permission-mode ${DEFAULT_PERMISSION_MODE}${modelFlag}${settings}${addDir}${mcpFlag}`
    const tail = `${flags} --append-system-prompt ${shellQuote(systemPrompt)} ${shellQuote(prompt)}`
    cmd = (sessionId && opts?.resume)
      ? claudeResumeOrFresh(sessionId, worktreePath, tail)
      : `claude ${sessionId ? `--session-id ${sessionId} ` : opts?.resume ? '--continue ' : ''}${tail}\r`
  } else {
    // Codex / Gemini have no separate system-prompt flag — fold it into the body.
    const combined = `${systemPrompt}\n\n${prompt}`
    cmd = agent === 'codex'
      // Auto Mode ON → bypass approvals so Codex runs unattended; OFF → default
      // interactive mode (waits for the user to approve each step).
      ? `codex ${codexAutoFlag(opts?.autoMode)}--model ${model} ${shellQuote(combined)}\r`
      // gemini: --yolo auto-approves tool calls; -i stays interactive
      : `gemini --yolo -i --model ${model} ${shellQuote(combined)}\r`
  }
  // ponytail: warn at 200KB — macOS ARG_MAX is 1MB but prompts can grow
  if (cmd.length > 200_000) console.warn(`[VibeFlow] launch command is ${cmd.length} bytes — approaching ARG_MAX`)
  return cmd
}

/** Display names for the supported agent CLIs (mirrors main/helpers/agents.ts). */
export const AGENT_NAMES: Record<AgentCliId, string> = {
  claude: 'Claude Code',
  codex: 'Codex CLI',
  gemini: 'Gemini CLI',
}

/**
 * Lightweight default model per agent, mirrored from main/helpers/agents.ts
 * (the renderer cannot runtime-import main-process values). Used as a fallback
 * for tasks created before the model field existed.
 */
const DEFAULT_MODELS: Record<AgentCliId, string> = {
  claude: 'sonnet',
  codex: 'gpt-5.5',
  gemini: 'gemini-2.5-flash',
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

/** Resolve a task's agent (tasks created before the field existed = claude). */
export function taskAgent(task: Pick<Task, 'agentCli'>): AgentCliId {
  return task.agentCli ?? 'claude'
}

/** Resolve the model passed to the agent CLI (task.model, else agent default). */
export function taskModel(task: Pick<Task, 'agentCli' | 'model'>): string {
  const agent = taskAgent(task)
  return normalizeModel(agent, task.model || DEFAULT_MODELS[agent])
}

/** Resolve the execution agent (old tasks fall back to the planning agent). */
export function taskExecutionAgent(
  task: Pick<Task, 'agentCli' | 'executionAgentCli'>
): AgentCliId {
  return task.executionAgentCli ?? taskAgent(task)
}

/** Resolve the execution model (old tasks fall back to the planning model). */
export function taskExecutionModel(
  task: Pick<Task, 'agentCli' | 'model' | 'executionAgentCli' | 'executionModel'>
): string {
  const agent = taskExecutionAgent(task)
  const model = !task.executionAgentCli
    ? task.model || DEFAULT_MODELS[agent]
    : task.executionModel || DEFAULT_MODELS[agent]
  return normalizeModel(agent, model)
}

/**
 * Build the launch command for the task's current lifecycle phase.
 *
 * Planning (`planDone !== true`) uses the planning agent/model and only the PM
 * system prompt. Execution (`planDone === true`) switches to the execution
 * agent/model and injects the executor role.
 *
 * Codex and Gemini have no separate system-prompt flag, so the effective
 * system prompt and task prompt are folded into one CLI argument.
 *
 * For Claude, planning and execution use separate deterministic session ids:
 *   - Planning: `planningSessionId(task.id)` for plan-only context.
 *   - Execution: `executorSessionId(task.id)` for implementation context.
 * This lets execution start as a fresh session after planning without colliding
 * with the already-created planning session.
 * Codex/Gemini fall back to a fresh launch whose prompt already folds in the
 * recorded progress (via buildPrompt), giving a soft resume regardless of
 * `opts.resume`.
 */
export function buildAgentCommand(
  task: Pick<
    Task,
    | 'id'
    | 'title'
    | 'description'
    | 'progress'
    | 'agentCli'
    | 'model'
    | 'executionAgentCli'
    | 'executionModel'
    | 'worktreePath'
  >,
  systemPrompt?: string | null,
  role?: Parameters<typeof buildRolePrompt>[0],
  opts?: LaunchOptions,
  workspacePath?: string,
  // Planning persona; caller passes the store's (user-editable) PM role so
  // edits take effect. Falls back to the built-in PLANNING_ROLE when absent.
  planningRole?: Parameters<typeof buildRolePrompt>[0]
): string {
  const isExecution = task.progress?.planDone === true
  const agent = isExecution ? taskExecutionAgent(task) : taskAgent(task)
  const model = isExecution ? taskExecutionModel(task) : taskModel(task)
  const files = agentFilePaths(task.worktreePath, workspacePath)
  const sys = resolveSystemPrompt(systemPrompt, isExecution ? role : (planningRole ?? PLANNING_ROLE))
  const basePrompt = isExecution
    ? opts?.resume && agent === 'claude'
      ? buildResumePrompt(task)
      : buildExecutionPrompt(task)
    : buildPlanningPrompt(task)
  const prompt = appendProgressProtocol(basePrompt, files?.progress, files?.plan)
  const sessionId = agent === 'claude'
    ? isExecution ? executorSessionId(task.id) : planningSessionId(task.id)
    : undefined
  return assembleCommand(agent, sys, prompt, model, opts, task.worktreePath, sessionId, workspacePath)
}
