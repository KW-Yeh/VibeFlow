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
 * Prompt for the reviewer stage of the pipeline. The reviewer is fed as a new
 * turn into the executor's still-open agent session (which shares the worktree,
 * so the diff is right there). Because no fresh CLI is launched, the reviewer
 * persona cannot be set via a system-prompt flag — instead the reviewer role is
 * folded into the prompt body so this turn re-frames the agent as the reviewer.
 * It must write its verdict into the progress file's `review` field, which main
 * mirrors onto the task so the orchestrator can branch.
 */
export function buildReviewPrompt(
  task: Pick<Task, 'title' | 'description'>,
  reviewerRole?: Parameters<typeof buildRolePrompt>[0]
): string {
  const lines: string[] = []
  const rolePrompt = buildRolePrompt(reviewerRole)
  if (rolePrompt) lines.push(rolePrompt, '')
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

/** Options controlling how a launch command is built. */
export interface LaunchOptions {
  /**
   * Resume the prior agent session instead of starting a fresh conversation.
   * For Claude this uses `--continue` so the previous session in the task's
   * worktree is restored and continued from the last recorded progress.
   */
  resume?: boolean
}

/**
 * Build the full shell command (terminated with a carriage return) that
 * launches Claude in auto mode with the card's prompt and the effective
 * system prompt. Written verbatim into the card's PTY.
 *
 * When `opts.resume` is set, `--continue` restores the most recent conversation
 * in the worktree (claude keys history by cwd) and a short resume nudge is sent
 * as the new turn. The system prompt — including the progress-tracking protocol
 * — is re-appended each invocation, so the resumed session keeps maintaining
 * the progress file.
 */
export function buildClaudeCommand(
  task: Pick<Task, 'title' | 'description' | 'progress' | 'worktreePath'>,
  systemPrompt?: string | null,
  role?: Parameters<typeof buildRolePrompt>[0],
  opts?: LaunchOptions
): string {
  const sys = resolveSystemPrompt(systemPrompt, role)
  const prompt = opts?.resume ? buildResumePrompt(task) : buildPrompt(task)
  return assembleCommand('claude', sys, prompt, opts, task.worktreePath)
}

/**
 * Assemble the final shell command (CR-terminated) for a given agent CLI from
 * an already-resolved system prompt and prompt body. Centralizes the per-CLI
 * differences (flags, how the system prompt is passed, session resume) so the
 * normal launch and the pipeline review/revise launches stay in sync.
 */
function assembleCommand(
  agent: AgentCliId,
  systemPrompt: string,
  prompt: string,
  opts?: LaunchOptions,
  worktreePath?: string
): string {
  if (agent === 'claude') {
    // Install the sub-agent recording hooks via inline --settings (session-only,
    // never touches the user's repo). Only when the worktree path is known.
    const settings = worktreePath
      ? ` --settings ${shellQuote(buildSubAgentSettings(worktreePath))}`
      : ''
    const head = `claude${opts?.resume ? ' --continue' : ''} --permission-mode ${DEFAULT_PERMISSION_MODE}${settings}`
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
 * Encode a multi-line prompt as the keystrokes that submit it as ONE new turn
 * inside an already-running agent REPL (Claude/Codex/Gemini), then auto-run.
 *
 * The pipeline's reviewer/revise turns are not fresh CLI launches — the
 * executor's interactive session is still open in the PTY, so the prompt is
 * typed straight into it. In these TUIs a bare CR submits the current input
 * while ESC+CR inserts a newline (same convention task-terminal.tsx uses for
 * Shift+Enter). A raw LF is not a reliable submit/newline, so a prompt joined
 * with "\n" lands in the input box but never fires — the user had to press
 * Enter. Sending each internal newline as ESC+CR and terminating with a single
 * CR builds the whole multi-line message and submits it automatically.
 */
function replSubmission(prompt: string): string {
  return prompt.replace(/\n/g, '\x1b\r') + '\r'
}

/**
 * Build the keystrokes for the reviewer stage. The reviewer is NOT a fresh CLI
 * launch: it is fed as a new turn into the executor's still-open session in the
 * same worktree (the diff is right there). The reviewer persona therefore comes
 * from the role folded into the prompt body — not a system-prompt flag — and
 * the carrier system prompt (executor workflow) is intentionally omitted.
 */
export function buildReviewCommand(
  task: Pick<Task, 'title' | 'description'>,
  reviewerRole?: Parameters<typeof buildRolePrompt>[0]
): string {
  return replSubmission(buildReviewPrompt(task, reviewerRole))
}

/**
 * Build the keystrokes for a revise stage: a new turn fed into the same open
 * session to address the reviewer's comments. Like the reviewer turn it carries
 * no system prompt; the executor role is folded into the prompt body to re-frame
 * the agent, and the recorded comments tell it exactly what to fix.
 */
export function buildReviseCommand(
  task: Pick<Task, 'title' | 'description'>,
  executorRole?: Parameters<typeof buildRolePrompt>[0],
  comments: string[] = []
): string {
  return replSubmission(buildRevisePrompt(task, comments, executorRole))
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
 * Only Claude has a wired session-resume flag (`--continue`). Codex/Gemini fall
 * back to a fresh launch whose prompt already folds in the recorded progress
 * (via buildPrompt), giving a soft resume regardless of `opts.resume`.
 */
export function buildAgentCommand(
  task: Pick<
    Task,
    'title' | 'description' | 'progress' | 'agentCli' | 'worktreePath'
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
  return assembleCommand(agent, sys, prompt, opts, task.worktreePath)
}
