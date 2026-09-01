import type { AgentCliId, MemoryLaunchInfo, Task } from '@/lib/types'

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
): { progress: string; plan: string; artifacts: string } | null {
  if (!worktreePath || !workspacePath) return null
  const dir = toShellPath(workspacePath)
  const ws = pathBasename(worktreePath)
  return {
    progress: `${dir}/${ws}${PROGRESS_FILE}`,
    plan: `${dir}/${ws}.${PLAN_FILE}`,
    artifacts: `${dir}/${ws}${ARTIFACTS_DIR_SUFFIX}`,
  }
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
  return agentFilePaths(worktreePath, workspacePath)?.artifacts ?? null
}

/**
 * Fixed protocol appended to the task prompt body. It makes the agent persist
 * its plan (to `planFile`) + step states (to `progressFile`), which main watches
 * and mirrors into the task record — enabling card progress display, the Plan
 * view, and resume-on-rerun. Kept separate from the user's system prompt so editing
 * the workflow prompt cannot break progress tracking.
 *
 * `memoryTaskId` both gates and parameterizes the agent-memory section. Null
 * omits it: the store is reached through the built-in MCP server, which only
 * the Claude launch path can inject (see buildMemoryMcpFlag), so a Codex or
 * Gemini task must not be told it has tools it cannot call. The section sits
 * last and is appended rather than spliced in, so omitting it leaves no gap in
 * the numbering.
 *
 * When present it is the task's branch name, which is the id main reads the
 * store back by (see the task:getCheckpoints handler). VibeFlow already knows
 * it, so it is stated outright rather than having the agent derive it — one
 * fewer tool call, and no way for the two to disagree.
 */
function buildProgressProtocolLines(
  progressFile: string,
  planFile: string,
  artifactsDir: string,
  memoryTaskId: string | null
): string {
  const lines = [
    '進度追蹤協議（務必遵守）：',
    `1. 規劃階段：先把執行計劃寫入 ${planFile}（Markdown 格式，包含任務目標、執行步驟、預期成果）。`,
    `2. 若需求足夠明確，可形成可執行計劃，${planFile} 建立完成後立即把步驟列表寫入 ${progressFile}，JSON 格式：{"summary": "一句話描述目前狀態", "planDone": true, "needsUserInput": false, "steps": [{"text": "步驟描述", "done": false}]}。planDone 設為 true 代表計劃完成，進入執行階段。`,
    `3. 若 planning 發現必須先詢問使用者才能完善計劃，請先向使用者提出具體問題，並把 ${progressFile} 寫成 {"summary": "需要使用者補充的問題摘要", "planDone": false, "needsUserInput": true, "steps": []}；不要開始執行。`,
    '4. 每完成一個步驟，立即把該步驟的 done 改為 true、把 needsUserInput 設為 false，並更新 summary。',
    `5. 若 ${progressFile} 已存在且 planDone 為 true，代表此任務先前執行過：先讀取內容，跳過 done 為 true 的步驟，從未完成的步驟接續執行。`,
    `6. 進度檔（${progressFile}）與計劃檔（${planFile}）由 VibeFlow 統一管理，位於 worktree 之外，切勿將其加入 git commit。`,
    `7. 暫存產物（非最終交付物）一律寫入 ${artifactsDir}/（目錄不存在請先建立），並依用途分流成兩區，不要混用：`,
    `7a. 要給使用者看的驗證證據（UI 驗證截圖、互動錄影、視覺比對報告）→ 放 ${artifactsDir}/ 根目錄。做 UI 相關驗證時務必把證據存在這裡，使用者會在 VibeFlow 的「Artifacts」分頁直接檢視（截圖與 .mp4／.m4v／.webm／.mov 影片都能在分頁內直接播放），不必自行開 dev server。這一區請保持精簡：只放你會主動請使用者過目的檔案。`,
    `7b. 截圖只能證明長相，證明不了互動。判斷測試：這次改動的預期行為，能不能用一張靜態圖看出通過或失敗？看不出來 → 除了截圖，再錄一段影片。常見需要錄的情況（不窮盡）：hover／focus 狀態、展開收合、拖拉排序、多步驟流程、轉場動畫、表單驗證回饋、loading→完成的狀態切換。純樣式、文案、靜態版面改動不需要錄。`,
    `7c. 錄影一律用 macOS 內建的 \`screencapture\` 輸出 .mov 影片，嚴禁用 \`gif_creator\` 或任何產 GIF 的工具：GIF 是動作邊界的截圖串接，transition、loading、hover 這些正要判的東西剛好落在取樣點之間，錄了也看不出來。步驟：先把要錄的視窗帶到前景 → 背景執行 \`screencapture -v -k -C -x -D1 ${artifactsDir}/<描述性檔名>.mov\`（-k 標記點擊、-C 錄游標、-x 靜音；只想錄單一視窗就加 \`-R<x,y,w,h>\` 指定範圍，避免把終端機一起錄進去）→ 執行互動 → \`pkill -INT -x screencapture\` 停止。必須送 SIGINT，直接 kill 會寫不完檔尾、影片會壞掉；該指令會停掉所有錄影行程，若使用者自己也在錄，改成記下 PID 再 \`kill -INT <pid>\`。`,
    `7d. 一段只涵蓋一條互動路徑，長度控制在 15 秒內；多條路徑分成多個檔，不要串成一長段，也不要把整段開發過程錄進去（螢幕錄影約每分鐘 15–80 MB）。影片會以 base64 過 IPC 進 Artifacts 分頁，單檔超過 20MB 就不會內嵌播放，只能請使用者用「開啟資料夾」在系統播放器看，所以請把單檔壓在 20MB 以內。`,
    `7e. 截圖或錄影工具若只能先把檔案存到系統暫存路徑（例如 /tmp、/private/tmp、$TMPDIR）或瀏覽器下載目錄（例如 ~/Downloads），產出後必須立即把檔案複製到 ${artifactsDir}/ 根目錄，並確認目標檔案存在；只回報或保留原路徑不算完成。若工具可指定輸出路徑，從一開始就指定 ${artifactsDir}/。`,
    `7f. 你自己的工作暫存（一次性 script、log、中間輸出、debug 檔、大型原始資料）→ 放 ${artifactsDir}/${SCRATCH_DIR_NAME}/。這一區在 UI 預設收折起來，使用者不會逐一點開；不要把該給使用者看的東西放進來。`,
    `7g. 兩區都在 worktree 之外、會隨任務清理一起刪除：切勿放最終交付物，也切勿加入 git commit。`,
  ]
  if (memoryTaskId) {
    lines.push(
      `8. Agent Memory（VibeFlow 內建、跨所有專案共用的統一記憶庫）：本任務已自動接上 \`agent-memory\` MCP server，無需另外安裝。所有 memory 操作的 task id 一律用 \`${memoryTaskId}\`（本任務的 git 分支名），不要自行改用其他 id：app 只以這個 id 回查此任務的 checkpoint 與關聯。`,
      `9. 規劃階段開始時：先呼叫 \`memory_find_related_tasks\`（query 用本次需求關鍵字）看有無可重用的過往任務；有相關的再用 \`memory_get_task_detail\` 載入細節。任務完成或交接時：用 \`memory_save_checkpoint\`（task id = \`${memoryTaskId}\`）封存本次成果（rolling summary、outcome、關鍵決策+理由、待辦；大型輸出放 artifacts），捨棄試誤過程。任務間有穩定關係（derived_from / supersedes / depends_on…）時用 \`memory_link_tasks\` 記錄。`,
    )
  }
  return lines.join('\n')
}

/**
 * Fixed progress-tracking protocol. Keep every line free of single quotes: the
 * whole prompt goes through shellQuote, which rewrites `'` as `'\''` and so
 * breaks any verbatim comparison against PROGRESS_PROTOCOL_PROMPT.
 *
 * `progressFile` / `planFile` / `artifactsDir`
 * are the paths the agent writes to — absolute workspace-folder paths when known
 * (see agentFilePaths), else the legacy cwd-relative names. Exported const uses
 * the relative fallbacks for backward-compatible callers/tests.
 *
 * `memoryTaskId` defaults to null: claiming the agent-memory tools exist when
 * they were not injected is the costlier mistake, so callers that know the
 * server is wired pass the task id explicitly.
 */
export function buildProgressProtocol(
  progressFile: string = PROGRESS_FILE,
  planFile: string = PLAN_FILE,
  artifactsDir: string = ARTIFACTS_FALLBACK_DIR,
  memoryTaskId: string | null = null
): string {
  return buildProgressProtocolLines(progressFile, planFile, artifactsDir, memoryTaskId)
}

export const PROGRESS_PROTOCOL_PROMPT = buildProgressProtocolLines(
  PROGRESS_FILE,
  PLAN_FILE,
  ARTIFACTS_FALLBACK_DIR,
  null
)

function appendProgressProtocol(
  prompt: string,
  progressFile?: string,
  planFile?: string,
  artifactsDir?: string,
  memoryTaskId: string | null = null
): string {
  return `${prompt}\n\n${buildProgressProtocol(progressFile, planFile, artifactsDir, memoryTaskId)}`
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

/**
 * Resolve the effective system prompt. Blank means the agent is launched with
 * no system prompt at all — the plan-then-execute lifecycle it used to describe
 * is specified concretely by the per-phase prompt bodies instead. Runtime
 * file-writing instructions likewise stay in the prompt body because their
 * paths are per-launch values derived from the unified files dir.
 */
export function resolveSystemPrompt(custom?: string | null): string {
  return custom && custom.trim() ? custom : ''
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

/**
 * `planFile` must be the same absolute path the progress protocol names (see
 * agentFilePaths): the plan lives outside the worktree under a worktree-derived
 * name, so a bare `PLAN.md` would send the agent looking in its cwd, where no
 * such file exists. Defaults to the cwd-relative fallback for callers that have
 * no workspace path.
 */
export function buildPlanningPrompt(
  task: Pick<Task, 'title' | 'description'>,
  planFile: string = PLAN_FILE
): string {
  const lines = [buildPrompt(task)]
  lines.push(
    '',
    `若需求足夠明確，建立 ${planFile}，依進度追蹤協議寫入 planDone=true、needsUserInput=false 與 steps，然後直接進入執行階段，依序完成所有步驟。`,
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

/** `planFile`: same absolute-path requirement as buildPlanningPrompt. */
export function buildExecutionPrompt(
  task: Pick<Task, 'progress'>,
  planFile: string = PLAN_FILE
): string {
  const lines = [
    'Planning 已完成，請直接進入執行階段。',
    `依照 ${planFile} 與下列進度，從第一個未完成的步驟開始實作；已完成的步驟請勿重做。`,
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

/** Stable Claude session UUID for the planning conversation. */
export function planningSessionId(taskId: string, runId?: string): string {
  const source = runId ? `${taskId}:${runId}` : taskId
  const taskHex = source.replace(/[^0-9a-f]/gi, '').toLowerCase().padEnd(24, '0').slice(0, 24)
  const hex = `${taskHex}${namespaceHash(runId ? `planning:${runId}` : 'planning')}`
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
    // Grant the agent write access to the workspace folder (the worktree's
    // parent) so it can write the progress/review/PLAN files there even though
    // it runs with cwd inside the worktree.
    const addDir = workspacePath
      ? ` --add-dir ${shellQuote(toShellPath(workspacePath))}`
      : ''
    const modelFlag = model ? ` --model ${model}` : ''
    const effortFlag = effort ? ` --effort ${effort}` : ''
    const mcpFlag = buildMemoryMcpFlag(opts?.memory)
    const flags = `--chrome --permission-mode ${DEFAULT_PERMISSION_MODE}${modelFlag}${effortFlag}${settings}${addDir}${mcpFlag}`
    const sysFlag = systemPrompt
      ? ` --append-system-prompt ${shellQuote(systemPrompt)}`
      : ''
    const tail = `${flags}${sysFlag} ${shellQuote(prompt)}`
    cmd = (sessionId && opts?.resume)
      ? claudeResumeOrFresh(sessionId, worktreePath, tail)
      : `claude ${sessionId ? `--session-id ${sessionId} ` : opts?.resume ? '--continue ' : ''}${tail}\r`
  } else {
    // Codex / Gemini have no separate system-prompt flag — fold it into the body.
    const combined = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt
    const codexEffortFlag = effort
      ? `-c ${shellQuote(`model_reasoning_effort="${effort}"`)} `
      : ''
    cmd = agent === 'codex'
      // Auto Mode ON → bypass approvals so Codex runs unattended; OFF → default
      // interactive mode (waits for the user to approve each step).
      ? `codex ${codexAutoFlag(opts?.autoMode)}${codexEffortFlag}--model ${model} ${shellQuote(combined)}\r`
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
 * Planning (`planDone !== true`) uses the planning agent/model. Execution
 * (`planDone === true`) switches to the execution agent/model.
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
    | 'effort'
    | 'worktreePath'
    | 'runId'
    | 'branch'
  >,
  systemPrompt?: string | null,
  opts?: LaunchOptions,
  workspacePath?: string
): string {
  const isExecution = task.progress?.planDone === true
  const agent = isExecution ? taskExecutionAgent(task) : taskAgent(task)
  const model = isExecution ? taskExecutionModel(task) : taskModel(task)
  const files = agentFilePaths(task.worktreePath, workspacePath)
  const sys = resolveSystemPrompt(systemPrompt)
  const basePrompt = isExecution
    ? opts?.resume && agent === 'claude'
      ? buildResumePrompt(task)
      : buildExecutionPrompt(task, files?.plan)
    : buildPlanningPrompt(task, files?.plan)
  const prompt = appendProgressProtocol(
    basePrompt,
    files?.progress,
    files?.plan,
    files?.artifacts,
    agent === 'claude' && opts?.memory ? task.branch : null
  )
  const sessionId = agent === 'claude'
    ? isExecution
      ? executorSessionId(task.id, task.runId)
      : planningSessionId(task.id, task.runId)
    : undefined
  return assembleCommand(
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
}
