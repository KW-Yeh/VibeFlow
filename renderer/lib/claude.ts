import type { AgentCliId, Role, Task } from '@/lib/types'

/**
 * Default system prompt appended when auto-launching Claude for a card. It
 * drives a plan-then-execute, hands-off workflow inside the task's isolated
 * git worktree. Kept concise so it fits comfortably on the command line.
 * Users can override it via the settings dialog (AppSettings.systemPrompt).
 */
export const DEFAULT_SYSTEM_PROMPT = [
  '你是在一個隔離的 git worktree 中自動執行任務的工程師助理。請依以下流程進行，全程使用繁體中文回報：',
  '1. 先閱讀並理解任務需求，產出一份簡短的執行計劃（條列即可）。',
  '2. 直接依計劃逐步實作，不要停下來等待額外確認。',
  '3. 完成後執行專案既有的檢查（typecheck / lint / test / build，若存在），並修正所有錯誤。',
  '4. 最後用條列式回報：做了什麼、驗證了哪些指令、有什麼風險或待辦。',
].join('\n')

/**
 * Progress file the agent maintains at the session cwd. Must match
 * PROGRESS_FILE in main/helpers/progress.ts (string literal duplicated because
 * the renderer cannot runtime-import main-process modules).
 */
const PROGRESS_FILE = '.vibeflow-progress.json'

/**
 * Fixed protocol appended after the (editable) system prompt. It makes the
 * agent persist its plan + step states to PROGRESS_FILE, which main watches
 * and mirrors into the task record — enabling card progress display and
 * resume-on-rerun. Kept separate from DEFAULT_SYSTEM_PROMPT so editing the
 * workflow prompt cannot break progress tracking.
 */
export const PROGRESS_PROTOCOL_PROMPT = [
  '進度追蹤協議（務必遵守）：',
  `1. 開始實作前，先把執行計劃寫入目前工作目錄的 ${PROGRESS_FILE}，JSON 格式：{"summary": "一句話描述目前狀態", "steps": [{"text": "步驟描述", "done": false}]}。`,
  '2. 每完成一個步驟，立即把該步驟的 done 改為 true 並更新 summary。',
  `3. 若 ${PROGRESS_FILE} 已存在，代表此任務先前執行過：先讀取內容，跳過 done 為 true 的步驟，從未完成的步驟接續執行。`,
  `4. 不要將 ${PROGRESS_FILE} 加入 git commit。`,
].join('\n')

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
    `你被指派的角色是「${role.name.trim()}」。請完全以此角色的視角來認知、判斷並執行任務。`,
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

/**
 * Directory the Claude hooks append one JSON file per Task-tool event into,
 * relative to the session cwd. Must match SUBAGENTS_DIR in
 * main/helpers/subagents.ts (the watcher reading these files).
 */
const SUBAGENTS_DIR = '.vibeflow-subagents'

/**
 * Build the `--settings` inline-JSON value that wires Claude's Task-tool hooks
 * to record each spawned sub-agent. PreToolUse captures the prompt at spawn;
 * PostToolUse captures the result at completion. Each event is written to its
 * OWN file (`<epoch>-<pid>-<rand>.json`) so parallel sub-agents never interleave
 * bytes into one log. The hook always exits 0 and emits no decision JSON, so it
 * is purely passive — it never blocks or alters the main agent.
 *
 * The event dir is the worktree's absolute path so the location is stable
 * regardless of the agent's cwd at hook time (more robust than $CLAUDE_PROJECT_DIR
 * in a git worktree). `$(date +%s)`, `$$`, `$RANDOM` stay single-quoted here so
 * the outer shell passes them through verbatim — they are expanded later by the
 * shell that actually runs the hook.
 */
function buildSubAgentSettings(worktreePath: string): string {
  const dir = `${worktreePath}/${SUBAGENTS_DIR}`
  const command = `mkdir -p "${dir}" && cat > "${dir}/$(date +%s)-$$-$RANDOM.json"`
  const taskHook = {
    matcher: 'Task',
    hooks: [{ type: 'command', command }],
  }
  return JSON.stringify({
    hooks: { PreToolUse: [taskHook], PostToolUse: [taskHook] },
  })
}

/**
 * Resolve the effective system prompt: the assigned role's persona (when set)
 * in front, then the user's custom prompt when set (non-blank) otherwise the
 * built-in default — always followed by the fixed progress-tracking protocol.
 */
export function resolveSystemPrompt(
  custom?: string | null,
  role?: Parameters<typeof buildRolePrompt>[0]
): string {
  const base = custom && custom.trim() ? custom : DEFAULT_SYSTEM_PROMPT
  const rolePrompt = buildRolePrompt(role)
  const head = rolePrompt ? `${rolePrompt}\n\n${base}` : base
  return `${head}\n\n${PROGRESS_PROTOCOL_PROMPT}`
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

/**
 * Prompt body for the reviewer stage of the pipeline. The reviewer is launched
 * as a fresh, independent CLI process (not a turn in the executor's session).
 * The reviewer role persona is passed via `--append-system-prompt` at the CLI
 * level; this body carries the task context and the verdict-writing instruction
 * that the orchestrator depends on.
 */
export function buildReviewPrompt(
  task: Pick<Task, 'title' | 'description'>
): string {
  const lines: string[] = []
  lines.push(`任務標題：${task.title}`)
  const description = task.description?.trim()
  if (description) lines.push('', '任務描述：', description)
  lines.push(
    '',
    '你現在是 Code Reviewer。請審查這個 git worktree 中相對於 base branch 的所有改動（用 git diff 檢視）。',
    '審查重點：需求達成度、正確性、邊界條件、錯誤處理、是否符合專案既有慣例與風格。',
    '',
    `完成審查後，請把結論寫入 ${PROGRESS_FILE}，在既有的 summary / steps 之外，再加上一個 review 欄位：`,
    '{"summary": "...", "steps": [...], "review": {"verdict": "approve" 或 "request_changes", "summary": "一句話總結", "comments": ["需修正的具體問題", ...]}}',
    '- 沒有需要修正的問題 → verdict 設為 "approve"，comments 用空陣列。',
    '- 有必須修正的問題 → verdict 設為 "request_changes"，comments 逐條列出每個必須修正的點。',
    '',
    '注意：你只負責審查，不要修改任何程式碼。',
  )
  return lines.join('\n')
}

/**
 * Prompt for the revise stage: fed as a new turn into the same open session to
 * address the reviewer's change requests. The executor role is folded back into
 * the body to re-frame the agent (the previous turn was the reviewer persona).
 * The recorded comments are injected so the executor knows exactly what to fix;
 * it must rewrite the progress file without a stale `review` field so the next
 * executor-complete signal fires cleanly.
 */
export function buildRevisePrompt(
  task: Pick<Task, 'title' | 'description'>,
  comments: string[],
  executorRole?: Parameters<typeof buildRolePrompt>[0]
): string {
  const lines: string[] = []
  const rolePrompt = buildRolePrompt(executorRole)
  if (rolePrompt) lines.push(rolePrompt, '')
  lines.push(`任務標題：${task.title}`)
  const description = task.description?.trim()
  if (description) lines.push('', '任務描述：', description)
  lines.push('', 'Code Reviewer 審查後要求以下修正，請逐項處理：')
  if (comments.length > 0) {
    for (const c of comments) lines.push(`- ${c}`)
  } else {
    lines.push('- （審查未列出具體項目，請依審查總結自行判斷並改善）')
  }
  lines.push(
    '',
    `修正完成後，請重新建立 ${PROGRESS_FILE}（只包含 summary 與 steps，不要保留 review 欄位），並把所有 steps 標記為完成。`,
  )
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

/** Options controlling how a launch command is built. */
export interface LaunchOptions {
  /**
   * Resume the prior agent session instead of starting a fresh conversation.
   * For Claude this uses `--resume <sessionId>` (when a sessionId is known)
   * so the exact executor session is restored regardless of what other sessions
   * have run in the same worktree.
   */
  resume?: boolean
}

/**
 * Build the system prompt used for the reviewer fresh-launch. The reviewer
 * role persona is the primary content; a minimal instruction to behave as
 * code reviewer is added when no role is provided. Returns an empty string
 * when the role body is empty (so the caller can skip `--append-system-prompt`).
 */
export function buildReviewerSystemPrompt(
  reviewerRole?: Parameters<typeof buildRolePrompt>[0]
): string {
  const rolePrompt = buildRolePrompt(reviewerRole)
  if (rolePrompt) return rolePrompt
  // No role configured: minimal reviewer framing so the agent doesn't drift.
  return '你是一位嚴謹的 Code Reviewer。請審查 git worktree 中的改動，依照任務描述中的指示輸出 verdict。'
}

/**
 * Build the full shell command (terminated with a carriage return) that
 * launches Claude in auto mode with the card's prompt and the effective
 * system prompt. Written verbatim into the card's PTY.
 *
 * The executor session is pinned to a deterministic UUID derived from the
 * task id (`executorSessionId`):
 *   - First launch: `--session-id <uuid>` creates and pins the session.
 *   - Resume: `--resume <uuid>` restores that exact session, unaffected by any
 *     other session (e.g. the reviewer) that ran in the same worktree cwd.
 */
export function buildClaudeCommand(
  task: Pick<Task, 'id' | 'title' | 'description' | 'progress' | 'worktreePath'>,
  systemPrompt?: string | null,
  role?: Parameters<typeof buildRolePrompt>[0],
  opts?: LaunchOptions
): string {
  const sys = resolveSystemPrompt(systemPrompt, role)
  const prompt = opts?.resume ? buildResumePrompt(task) : buildPrompt(task)
  return assembleCommand('claude', sys, prompt, opts, task.worktreePath, executorSessionId(task.id))
}

/**
 * Assemble the final shell command (CR-terminated) for a given agent CLI from
 * an already-resolved system prompt and prompt body. Centralizes the per-CLI
 * differences (flags, how the system prompt is passed, session resume) so the
 * normal launch and the pipeline review/revise launches stay in sync.
 *
 * When `sessionId` is provided the Claude session is pinned:
 *   - First launch (resume=false): `--session-id <id>` creates and pins the id.
 *   - Subsequent launches (resume=true): `--resume <id>` restores that exact session,
 *     unaffected by any other session (e.g. the reviewer) that ran in the same cwd.
 * When `sessionId` is absent, falls back to legacy behaviour (`--continue` for
 * resume, no flag for fresh start) so other call paths are not broken.
 */
function assembleCommand(
  agent: AgentCliId,
  systemPrompt: string,
  prompt: string,
  opts?: LaunchOptions,
  worktreePath?: string,
  sessionId?: string
): string {
  if (agent === 'claude') {
    // Install the sub-agent recording hooks via inline --settings (session-only,
    // never touches the user's repo). Only when the worktree path is known.
    const settings = worktreePath
      ? ` --settings ${shellQuote(buildSubAgentSettings(worktreePath))}`
      : ''
    let sessionFlag: string
    if (sessionId) {
      sessionFlag = opts?.resume ? ` --resume ${sessionId}` : ` --session-id ${sessionId}`
    } else {
      sessionFlag = opts?.resume ? ' --continue' : ''
    }
    const head = `claude${sessionFlag} --permission-mode ${DEFAULT_PERMISSION_MODE}${settings}`
    return `${head} --append-system-prompt ${shellQuote(systemPrompt)} ${shellQuote(prompt)}\r`
  }
  // Codex / Gemini have no separate system-prompt flag — fold it into the body.
  const combined = `${systemPrompt}\n\n${prompt}`
  if (agent === 'codex') {
    // --full-auto: workspace-write sandbox with automatic command approval.
    return `codex --full-auto ${shellQuote(combined)}\r`
  }
  // gemini: --yolo auto-approves tool calls; -i runs the prompt then stays
  // interactive (mirrors how the claude launch keeps the session open).
  return `gemini --yolo -i ${shellQuote(combined)}\r`
}

/**
 * Build the full shell command (CR-terminated) that launches the reviewer as an
 * independent Claude Code process in the task's worktree. This is a fresh CLI
 * launch — NOT a turn typed into the executor's running session — so:
 *   - The reviewer role persona is passed via `--append-system-prompt`.
 *   - Sub-agent hooks (--settings) are intentionally NOT installed to avoid
 *     collisions with the executor's .vibeflow-subagents directory.
 *   - `taskAgent(task)` is used so Codex/Gemini tasks fall through to their own
 *     assembleCommand branch (which folds the system prompt into the body).
 *
 * The verdict-writing instruction (in `buildReviewPrompt`) is always present in
 * the prompt body so the orchestrator can read the review field.
 */
export function buildReviewCommand(
  task: Pick<Task, 'title' | 'description' | 'agentCli' | 'worktreePath'>,
  reviewerRole?: Parameters<typeof buildRolePrompt>[0]
): string {
  const agent = taskAgent(task)
  const reviewSysPrompt = buildReviewerSystemPrompt(reviewerRole)
  const prompt = buildReviewPrompt(task)

  if (agent === 'claude') {
    // Fresh launch, reviewer persona via --append-system-prompt, no sub-agent hooks.
    const head = `claude --permission-mode ${DEFAULT_PERMISSION_MODE}`
    const sysArg = reviewSysPrompt
      ? ` --append-system-prompt ${shellQuote(reviewSysPrompt)}`
      : ''
    return `${head}${sysArg} ${shellQuote(prompt)}\r`
  }
  // Codex / Gemini: fold system prompt into the body (they have no separate flag).
  const combined = `${reviewSysPrompt}\n\n${prompt}`
  if (agent === 'codex') {
    return `codex --full-auto ${shellQuote(combined)}\r`
  }
  return `gemini --yolo -i ${shellQuote(combined)}\r`
}

/**
 * Build the full shell command (CR-terminated) that restarts the executor to
 * address the reviewer's comments. For Claude, `--resume <sessionId>` restores
 * the executor's pinned session by its exact UUID — the reviewer running in the
 * same worktree cwd does NOT affect which session is resumed. For Codex/Gemini a
 * fresh launch with the recorded progress folded in acts as a soft resume.
 *
 * The reviewer session must be killed before this runs (handled by the
 * orchestrator) so only the executor PTY is live during the revise stage.
 */
export function buildReviseCommand(
  task: Pick<Task, 'id' | 'title' | 'description' | 'progress' | 'agentCli' | 'worktreePath'>,
  executorRole?: Parameters<typeof buildRolePrompt>[0],
  comments: string[] = []
): string {
  const agent = taskAgent(task)
  const sys = resolveSystemPrompt(null, executorRole)
  const prompt = buildRevisePrompt(task, comments, executorRole)

  if (agent === 'claude') {
    // Resume the executor's pinned session by its exact UUID so the reviewer
    // session (which ran in the same cwd) does not pollute "most recent".
    const settings = task.worktreePath
      ? ` --settings ${shellQuote(buildSubAgentSettings(task.worktreePath))}`
      : ''
    const head = `claude --resume ${executorSessionId(task.id)} --permission-mode ${DEFAULT_PERMISSION_MODE}${settings}`
    return `${head} --append-system-prompt ${shellQuote(sys)} ${shellQuote(prompt)}\r`
  }
  // Codex / Gemini: fresh launch, recorded progress folded into the prompt.
  const combined = `${sys}\n\n${prompt}`
  if (agent === 'codex') {
    return `codex --full-auto ${shellQuote(combined)}\r`
  }
  return `gemini --yolo -i ${shellQuote(combined)}\r`
}

/** Display names for the supported agent CLIs (mirrors main/helpers/agents.ts). */
export const AGENT_NAMES: Record<AgentCliId, string> = {
  claude: 'Claude Code',
  codex: 'Codex CLI',
  gemini: 'Gemini CLI',
}

/** Resolve a task's agent (tasks created before the field existed = claude). */
export function taskAgent(task: Pick<Task, 'agentCli'>): AgentCliId {
  return task.agentCli ?? 'claude'
}

/**
 * Build the launch command for the task's chosen agent CLI. Codex and Gemini
 * have no separate system-prompt flag, so the effective system prompt (incl.
 * the progress protocol) is folded into the prompt text instead.
 *
 * For Claude the executor session is pinned to `executorSessionId(task.id)`:
 *   - First launch: `--session-id <uuid>` creates and pins the session.
 *   - Resume: `--resume <uuid>` restores that exact session regardless of what
 *     other sessions (e.g. the reviewer) ran in the same worktree cwd.
 * Codex/Gemini fall back to a fresh launch whose prompt already folds in the
 * recorded progress (via buildPrompt), giving a soft resume regardless of
 * `opts.resume`.
 */
export function buildAgentCommand(
  task: Pick<
    Task,
    'id' | 'title' | 'description' | 'progress' | 'agentCli' | 'worktreePath'
  >,
  systemPrompt?: string | null,
  role?: Parameters<typeof buildRolePrompt>[0],
  opts?: LaunchOptions
): string {
  const agent = taskAgent(task)
  const sys = resolveSystemPrompt(systemPrompt, role)
  // Claude can resume a prior session; Codex/Gemini fold the recorded progress
  // into the prompt (soft resume) regardless of opts.resume.
  const prompt =
    opts?.resume && agent === 'claude' ? buildResumePrompt(task) : buildPrompt(task)
  const sessionId = agent === 'claude' ? executorSessionId(task.id) : undefined
  return assembleCommand(agent, sys, prompt, opts, task.worktreePath, sessionId)
}
