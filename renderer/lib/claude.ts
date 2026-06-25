import type { AgentCliId, Role, Task } from '@/lib/types'

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
  '將計畫提交給相關角色進行檢視（Design 評估視覺可行性、RD 評估技術可行性與時程、Code Reviewer 預審架構）。根據反饋調整計畫，直到達成共識。',
  '',
  '### 階段三：執行計劃',
  '正式指派任務給負責執行的主要角色（Design / RD / QA）開始施工。執行完畢後視情況交棒 Code Reviewer 進行代碼審查。',
  '',
  '### 階段四：驗收與修復（非必經，視需求而定）',
  '指派 QA 進行功能測試，或指派 Design 進行畫面驗收。若有 Bug/瑕疵，回報給原執行角色修復並再次驗收；若通過則結束此階段。',
  '',
  '## 結案總結',
  '所有環節執行完畢且確認無後續驗收或修復工作時，進行結案總結，列出最終成果與交付狀態。',
].join('\n')

/**
 * Built-in role templates the user can pick from when creating a new role.
 * These are read-only presets — they populate the creation form and are only
 * persisted to the store when the user explicitly saves.
 */
export const PRESET_ROLES: Omit<Role, 'id'>[] = [
  {
    name: '資深RD',
    avatar: '👨‍💻',
    positioning:
      '負責產品的技術實現與架構設計。將業務需求與設計稿轉化為穩定、高效且具擴展性的程式碼，是產品落地的心臟。',
    responsibilities:
      '技術實作： 負責前端、後端、資料庫或演算法的程式碼撰寫與系統架構設計。\n技術可行性評估： 在專案初期評估需求技術難度、所需時間與潛在技術風險。\n程式碼品質維護： 執行 Code Review、撰寫單元測試（Unit Test），並進行系統重構以優化效能。\n問題診斷： 負責線上環境（Production）的 Bug 追蹤、效能瓶頸排查與修復。',
    boundaries:
      '不負責 決定產品的「商業邏輯」與「功能優先順序」（此為 PM 職責）。\n不負責 憑空通靈使用者體驗，所有介面與互動必須基於 UIUX 的設計規範。\n不負責 產品的最終品質驗收（Acceptance Testing），必須交由 QA 進行獨立測試。',
  },
  {
    name: '專案經理（PM）',
    avatar: '📋',
    positioning:
      '流程導向、注重細節的專案經理。核心任務是擔任需求的「守門員」與團隊的「協調者」，負責串聯 RD、QA、Design 以及 Code Reviewer。確保任務在每個階段都有完整的 context，並在角色間進行精準的「交棒（Hand-off）」。',
    responsibilities:
      '帶領團隊依序經歷規劃、檢視修正、執行、驗收四個階段。確認需求完整性，必要時進行多輪澄清。根據各角色反饋調整計畫直到達成共識。指派任務給負責角色並監控進度。管理 Bug 修復循環直到驗收通過。',
    boundaries:
      '不直接撰寫程式碼或設計稿（分別為 RD / Design 職責）。不跳過任何階段的確認機制。不在需求不完整的情況下進入執行階段。確保角色職責不互相越界。',
  },
  {
    name: '一般開發者',
    avatar: '🛠️',
    positioning:
      '你是一位全端開發者，負責將任務需求轉化為可運作、可維護的程式碼實作。你重視程式碼的可讀性與模組化，並以最小、聚焦的改動達成任務目標。',
    responsibilities:
      '解析任務需求並釐清模糊的邊界；規劃實作步驟；撰寫與修改程式碼；遵循專案既有的架構慣例與程式風格；執行專案既有的型別檢查、測試與建置；診斷並修正過程中出現的錯誤。',
    boundaries:
      '應做：保持改動聚焦於任務範圍、確實處理錯誤與邊界條件。禁做：嚴禁進行範疇外的無關重構；嚴禁為趕時程而略過標準的錯誤處理；不修改與任務無關的檔案。',
  },
  {
    name: '測試者',
    avatar: '🧪',
    positioning:
      '你是一位 QA／測試工程師，站在品質把關的立場審查程式碼改動，確保實作正確、符合需求且不引入回歸。',
    responsibilities:
      '審查 git diff 與實作邏輯；驗證需求達成度與邊界條件；檢查錯誤處理、潛在回歸與安全性問題；確認改動符合專案既有慣例；提出具體且可操作的修正建議。',
    boundaries:
      '應做：審查意見須具體指出問題的位置與原因，並區分必須修正與建議性意見。禁做：不主動改寫實作，僅提出修正建議；不給籠統含糊的評語；若無必須修正的問題即明確核可（approve）。',
  },
]

/**
 * Progress file the agent maintains at the session cwd. Must match
 * PROGRESS_FILE in main/helpers/progress.ts (string literal duplicated because
 * the renderer cannot runtime-import main-process modules).
 */
const PROGRESS_FILE = '.vibeflow-progress.json'

/** Workspace context file name (mirrors main/helpers/workspace.ts CONTEXT_MD). */
const WORKSPACE_CONTEXT_FILE = 'context.md'

/**
 * Build the workspace section appended to executor prompts when a workspace is
 * attached. The "read" note tells the agent where to find background knowledge;
 * the "update" instruction tells it to refresh the file after completion.
 *
 * Placed in the prompt body (not the system prompt) so it travels with every
 * session turn and survives --resume / --continue.
 */
function buildWorkspacePromptSection(workspacePath: string, includeUpdate: boolean): string {
  const contextPath = `${workspacePath}/${WORKSPACE_CONTEXT_FILE}`
  const lines = [
    '',
    `背景知識：在開始執行前，請先閱讀 ${contextPath} 作為此任務的額外 context。`,
  ]
  if (includeUpdate) {
    lines.push(
      '',
      '完成任務後（所有步驟 done、且非審查退回狀態），請更新 workspace 知識目錄：',
      `- 讀取並更新 ${contextPath}（Markdown），把本次任務新增或變更的重要知識、決策、檔案結構摘要寫入。`,
      '- 這是跨任務共用的長期 context，請以「未來其他任務能快速理解專案」為目標來維護它。',
      '- 同目錄的 context.html 是系統自動產生的渲染檢視，請勿手動編輯。'
    )
  }
  return lines.join('\n')
}

/**
 * Fixed protocol appended after the (editable) system prompt. It makes the
 * agent persist its plan + step states to PROGRESS_FILE, which main watches
 * and mirrors into the task record — enabling card progress display and
 * resume-on-rerun. Kept separate from DEFAULT_SYSTEM_PROMPT so editing the
 * workflow prompt cannot break progress tracking.
 */
export const PROGRESS_PROTOCOL_PROMPT = [
  '進度追蹤協議（務必遵守）：',
  '1. 規劃階段：先把執行計劃寫入目前工作目錄的 PLAN.md（Markdown 格式，包含任務目標、執行步驟、預期成果）。',
  `2. 若需求足夠明確，可形成可執行計劃，PLAN.md 建立完成後立即把步驟列表寫入 ${PROGRESS_FILE}，JSON 格式：{"summary": "一句話描述目前狀態", "planDone": true, "needsUserInput": false, "steps": [{"text": "步驟描述", "done": false}]}。planDone 設為 true 代表計劃完成，進入執行階段。`,
  `3. 若 planning 發現必須先詢問使用者才能完善計劃，請先向使用者提出具體問題，並把 ${PROGRESS_FILE} 寫成 {"summary": "需要使用者補充的問題摘要", "planDone": false, "needsUserInput": true, "steps": []}；不要開始執行。`,
  '4. 每完成一個步驟，立即把該步驟的 done 改為 true、把 needsUserInput 設為 false，並更新 summary。',
  `5. 若 ${PROGRESS_FILE} 已存在且 planDone 為 true，代表此任務先前執行過：先讀取內容，跳過 done 為 true 的步驟，從未完成的步驟接續執行。`,
  `6. 不要將 ${PROGRESS_FILE} 加入 git commit。`,
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
    '審查重點：需求達成度（對照 PLAN.md 中定義的預期成果）、正確性、邊界條件、錯誤處理、是否符合專案既有慣例與風格。',
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
  const sys = resolveSystemPrompt(systemPrompt, isExecution ? role : undefined)
  const basePrompt = isExecution
    ? opts?.resume ? buildResumePrompt(task) : buildExecutionPrompt(task)
    : buildPlanningPrompt(task)
  const prompt = workspacePath
    ? basePrompt + buildWorkspacePromptSection(workspacePath, true)
    : basePrompt
  const model = task.model || DEFAULT_MODELS.claude
  const sessionId = isExecution ? executorSessionId(task.id) : planningSessionId(task.id)
  return assembleCommand('claude', sys, prompt, model, opts, task.worktreePath, sessionId, workspacePath)
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
  model: string,
  opts?: LaunchOptions,
  worktreePath?: string,
  sessionId?: string,
  workspacePath?: string
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
    // Grant the agent read/write access to the workspace folder so it can read
    // context.md and write back the updated knowledge directory.
    const addDir = workspacePath ? ` --add-dir ${shellQuote(workspacePath)}` : ''
    const head = `claude${sessionFlag} --permission-mode ${DEFAULT_PERMISSION_MODE} --model ${model}${settings}${addDir}`
    return `${head} --append-system-prompt ${shellQuote(systemPrompt)} ${shellQuote(prompt)}\r`
  }
  // Codex / Gemini have no separate system-prompt flag — fold it into the body.
  const combined = `${systemPrompt}\n\n${prompt}`
  if (agent === 'codex') {
    return `codex --model ${model} ${shellQuote(combined)}\r`
  }
  if (agent === 'copilot') {
    // --allow-all-tools: required for non-interactive runs (auto-approve);
    // -p executes the prompt directly. copilot has no separate system-prompt
    // flag, so the system prompt is folded into the body like codex/gemini.
    return `copilot --allow-all-tools --model ${model} -p ${shellQuote(combined)}\r`
  }
  // gemini: --yolo auto-approves tool calls; -i runs the prompt then stays
  // interactive (mirrors how the claude launch keeps the session open).
  return `gemini --yolo -i --model ${model} ${shellQuote(combined)}\r`
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
  task: Pick<Task, 'title' | 'description' | 'agentCli' | 'model' | 'worktreePath'>,
  reviewerRole?: Parameters<typeof buildRolePrompt>[0],
  workspacePath?: string
): string {
  const agent = taskAgent(task)
  const model = taskModel(task)
  const reviewSysPrompt = buildReviewerSystemPrompt(reviewerRole)
  const basePrompt = buildReviewPrompt(task)
  // Reviewer only reads the workspace context, never updates it.
  const prompt = workspacePath
    ? basePrompt + buildWorkspacePromptSection(workspacePath, false)
    : basePrompt

  if (agent === 'claude') {
    // Fresh launch, reviewer persona via --append-system-prompt, no sub-agent hooks.
    const addDir = workspacePath ? ` --add-dir ${shellQuote(workspacePath)}` : ''
    const head = `claude --permission-mode ${DEFAULT_PERMISSION_MODE} --model ${model}${addDir}`
    const sysArg = reviewSysPrompt
      ? ` --append-system-prompt ${shellQuote(reviewSysPrompt)}`
      : ''
    return `${head}${sysArg} ${shellQuote(prompt)}\r`
  }
  // Codex / Gemini / Copilot: fold system prompt into the body (no separate flag).
  const combined = `${reviewSysPrompt}\n\n${prompt}`
  if (agent === 'codex') {
    return `codex --model ${model} ${shellQuote(combined)}\r`
  }
  if (agent === 'copilot') {
    return `copilot --allow-all-tools --model ${model} -p ${shellQuote(combined)}\r`
  }
  return `gemini --yolo -i --model ${model} ${shellQuote(combined)}\r`
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
  executorRole?: Parameters<typeof buildRolePrompt>[0],
  comments: string[] = [],
  workspacePath?: string
): string {
  const agent = taskExecutionAgent(task)
  const model = taskExecutionModel(task)
  const sys = resolveSystemPrompt(null, executorRole)
  const basePrompt = buildRevisePrompt(task, comments, executorRole)
  const prompt = workspacePath
    ? basePrompt + buildWorkspacePromptSection(workspacePath, true)
    : basePrompt

  if (agent === 'claude') {
    // Resume the executor's pinned session by its exact UUID so the reviewer
    // session (which ran in the same cwd) does not pollute "most recent".
    const settings = task.worktreePath
      ? ` --settings ${shellQuote(buildSubAgentSettings(task.worktreePath))}`
      : ''
    const addDir = workspacePath ? ` --add-dir ${shellQuote(workspacePath)}` : ''
    const head = `claude --resume ${executorSessionId(task.id)} --permission-mode ${DEFAULT_PERMISSION_MODE} --model ${model}${settings}${addDir}`
    return `${head} --append-system-prompt ${shellQuote(sys)} ${shellQuote(prompt)}\r`
  }
  // Codex / Gemini / Copilot: fresh launch, recorded progress folded into the prompt.
  const combined = `${sys}\n\n${prompt}`
  if (agent === 'codex') {
    return `codex --model ${model} ${shellQuote(combined)}\r`
  }
  if (agent === 'copilot') {
    return `copilot --allow-all-tools --model ${model} -p ${shellQuote(combined)}\r`
  }
  return `gemini --yolo -i --model ${model} ${shellQuote(combined)}\r`
}

/** Display names for the supported agent CLIs (mirrors main/helpers/agents.ts). */
export const AGENT_NAMES: Record<AgentCliId, string> = {
  claude: 'Claude Code',
  codex: 'Codex CLI',
  gemini: 'Gemini CLI',
  copilot: 'GitHub Copilot CLI',
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
  copilot: 'gpt-5.1-codex-mini',
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
 * system prompt (incl. the progress protocol) is folded into the prompt text.
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
  workspacePath?: string
): string {
  const isExecution = task.progress?.planDone === true
  const agent = isExecution ? taskExecutionAgent(task) : taskAgent(task)
  const model = isExecution ? taskExecutionModel(task) : taskModel(task)
  const sys = resolveSystemPrompt(systemPrompt, isExecution ? role : undefined)
  const basePrompt = isExecution
    ? opts?.resume && agent === 'claude'
      ? buildResumePrompt(task)
      : buildExecutionPrompt(task)
    : buildPlanningPrompt(task)
  const prompt = workspacePath
    ? basePrompt + buildWorkspacePromptSection(workspacePath, true)
    : basePrompt
  const sessionId = agent === 'claude'
    ? isExecution ? executorSessionId(task.id) : planningSessionId(task.id)
    : undefined
  return assembleCommand(agent, sys, prompt, model, opts, task.worktreePath, sessionId, workspacePath)
}
