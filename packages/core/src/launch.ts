/*
 * Agent launch-command assembly. Core runs it when a session starts; the
 * renderer imports this module for its pure display helpers. That is why it
 * imports types only and duplicates a few constants from fs-using modules
 * (artifacts.ts, agents.ts, subagents.ts): a value import would
 * pull `fs` into the browser bundle.
 */
import type { AgentCliId } from './agents'
import type { BoardCliLaunchInfo } from './board-cli'
import type { LibraryLaunchInfo } from './library'
import type { Task } from './store'

/**
 * Temporary-artifact directory suffix. User-facing files are copied to
 * `<workspacePath>/<worktree-dir>.artifacts/` —
 * outside the worktree so git never sees it — falling back to this bare,
 * cwd-relative name only when paths are unknown. Must match
 * ARTIFACTS_DIR_SUFFIX in artifacts.ts (duplicated: see the note at the top).
 */
const ARTIFACTS_DIR_SUFFIX = '.artifacts'

/**
 * Subdirectory the agent keeps its own working files in, so the Artifacts view
 * can separate them from the screenshots and reports meant for the user. Must
 * match SCRATCH_DIR_NAME in artifacts.ts (duplicated: see the note at the top).
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
 * The task's temporary-artifact directory, for display in the UI. Null
 * when the workspace or worktree path is unknown.
 */
export function taskArtifactsDir(
  worktreePath: string | undefined,
  workspacePath: string | undefined
): string | null {
  return agentArtifactsDir(worktreePath, workspacePath)
}

/** The Claude permission mode that lets the agent act without asking. */
export const AUTO_PERMISSION_MODE = 'auto'

/**
 * Claude's authorization flag, driven by the card's Auto Mode. ON → the agent
 * acts without stopping for approval; OFF → no flag, so the CLI's own default
 * asks before each action. The leading space keeps the caller's template tidy.
 */
function claudePermissionFlag(autoMode?: boolean): string {
  return autoMode ? ` --permission-mode ${AUTO_PERMISSION_MODE}` : ''
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
  task: Pick<Task, 'id' | 'projectPath' | 'branch' | 'baseBranch' | 'worktreePath' | 'masterId'>,
  opts?: LaunchOptions,
  workspacePath?: string
): string {
  const board = opts?.boardCli
  const artifactsDir = agentArtifactsDir(task.worktreePath, workspacePath)
    ?? (task.worktreePath ? `${toShellPath(task.worktreePath)}/${ARTIFACTS_FALLBACK_DIR}` : undefined)
  if (!board) return ''
  const entries: Array<[string, string | undefined]> = [
    ['VIBEFLOW_TASK_ID', task.id],
    ['VIBEFLOW_MASTER_ID', task.masterId],
    ['VIBEFLOW_PROJECT_PATH', task.projectPath],
    ['VIBEFLOW_BRANCH', task.branch],
    ['VIBEFLOW_BASE_BRANCH', task.baseBranch],
    ['VIBEFLOW_STORE_DIR', board?.storeDir],
    ['VIBEFLOW_CLI', board?.cliPath],
    ['VIBEFLOW_CLI_LOADER', board?.loaderPath],
    ['VIBEFLOW_AUTO_MODE', opts?.autoMode ? '1' : '0'],
    ['VIBEFLOW_ARTIFACTS_DIR', artifactsDir],
    ['VIBEFLOW_SCRATCH_DIR', artifactsDir ? `${artifactsDir}/${SCRATCH_DIR_NAME}` : undefined],
  ]
  const exports = entries
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([key, value]) => `${key}=${shellQuote(toShellPath(value))}`)
  return exports.length ? `export ${exports.join(' ')}; ` : ''
}

/**
 * Codex authorization flag driven by the card's Auto Mode. ON → bypass
 * approvals + sandbox (unattended); OFF → '' (Codex stays interactive and waits
 * for approval). The trailing space keeps the caller's template tidy.
 */
function codexAutoFlag(autoMode?: boolean): string {
  return autoMode ? '--dangerously-bypass-approvals-and-sandbox ' : ''
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
 * subagents.ts (the watcher reading these files).
 */
const SUBAGENTS_DIR = '.vibeflow-subagents'

/**
 * Directory the progress hooks drop one JSON file per event into, relative to
 * the worktree. Must match PROGRESS_EVENTS_DIR in progress-tracker.ts.
 */
export const PROGRESS_EVENTS_DIR = '.vibeflow-events'

/**
 * Messages waiting for a card's agent, relative to the worktree: one file per
 * message. Must match the host side in inbox.ts.
 */
export const INBOX_DIR = '.vibeflow-inbox'

/** Present once the running session's hooks proved they read the inbox. */
export const INBOX_READY_FILE = '.ready'

/**
 * Reads every waiting message and answers the hook with it: Stop keeps the
 * agent going, the others add it to what the agent sees next. A rename is the
 * claim, so a message the host takes back to type is never read twice.
 */
const INBOX_READER = [
  'const fs=require("fs"),path=require("path");',
  'const [dir,event]=process.argv.slice(1);const out=[];',
  'for(const name of fs.readdirSync(dir).filter((n)=>!n.startsWith(".")).sort()){',
  'const claimed=path.join(dir,".hook-"+name);',
  'try{fs.renameSync(path.join(dir,name),claimed)}catch{continue}',
  'out.push(fs.readFileSync(claimed,"utf8"));fs.rmSync(claimed,{force:true})}',
  'if(out.length){const text=out.join("\\n\\n");',
  'process.stdout.write(JSON.stringify(event==="Stop"?{decision:"block",reason:text}',
  ':{hookSpecificOutput:{hookEventName:event,additionalContext:text}}))}',
].join('')

/** The hook command that hands waiting messages to the agent; spawns node only when one waits. */
export function inboxHookCommand(inboxDir: string, event: 'PostToolUse' | 'UserPromptSubmit' | 'Stop'): string {
  const dir = toShellPath(inboxDir)
  return `if ls "${dir}" 2>/dev/null | grep -q .; then node -e '${INBOX_READER}' "${dir}" ${event}; fi; exit 0`
}

/** Claude tools whose call changes the todo list the card's progress is read from. */
const TODO_TOOLS = 'TodoWrite|TaskCreate|TaskUpdate'

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
 *
 * Progress hooks (todo-tool calls, Stop, Notification, UserPromptSubmit) write
 * the same way into PROGRESS_EVENTS_DIR. They only wake the progress tracker
 * and report what the transcript cannot (a permission prompt); progress itself
 * is always read from the transcript. They end in `exit 0` so a failed write
 * can never block a Stop.
 *
 * Inbox hooks are the one exception to being passive: messages from other
 * cards reach the agent through them instead of being typed into the input
 * box the user may be writing in. SessionStart marks the inbox as read by
 * this session, so the host never leaves a message for a session that has no
 * such hook.
 */
function buildClaudeSettings(worktreePath?: string): string {
  // Card progress is read from the todo tools, which Claude Code withholds from
  // newer models unless this undocumented switch is on (checked in 2.1.305).
  const settings: Record<string, unknown> = {
    theme: 'dark',
    env: { CLAUDE_CODE_ENABLE_TODO_TOOLS: '1' },
  }
  if (worktreePath) {
    const dir = `${toShellPath(worktreePath)}/${SUBAGENTS_DIR}`
    const command = `mkdir -p "${dir}" && cat > "${dir}/$(date +%s)-$$-$RANDOM.json"`
    const taskHook = {
      matcher: 'Task',
      hooks: [{ type: 'command', command }],
    }
    const eventsDir = `${toShellPath(worktreePath)}/${PROGRESS_EVENTS_DIR}`
    const progress = {
      hooks: [{ type: 'command', command: `mkdir -p "${eventsDir}" && cat > "${eventsDir}/$(date +%s)-$$-$RANDOM.json"; exit 0` }],
    }
    const inboxDir = `${toShellPath(worktreePath)}/${INBOX_DIR}`
    const inbox = (event: 'PostToolUse' | 'UserPromptSubmit' | 'Stop') => ({
      hooks: [{ type: 'command', command: inboxHookCommand(inboxDir, event) }],
    })
    settings.hooks = {
      PreToolUse: [taskHook],
      PostToolUse: [taskHook, { matcher: TODO_TOOLS, ...progress }, inbox('PostToolUse')],
      Stop: [progress, inbox('Stop')],
      Notification: [progress],
      UserPromptSubmit: [progress, inbox('UserPromptSubmit')],
      SessionStart: [{
        hooks: [{ type: 'command', command: `mkdir -p "${inboxDir}" && : > "${inboxDir}/${INBOX_READY_FILE}"; exit 0` }],
      }],
    }
  }
  return JSON.stringify(settings)
}

/** Resolve the optional user-configured system prompt. */
export function resolveSystemPrompt(custom?: string | null): string {
  return custom && custom.trim() ? custom : ''
}

/**
 * What a master card's agent is told on top of the user's system prompt: it
 * orchestrates other cards through the board CLI instead of writing code. The
 * one launch that adds text of VibeFlow's own, because a master is useless
 * without knowing the CLI that makes it one.
 */
const BOARD_CLI_SETUP = [
  '先定義這個 shell 函式，之後所有指令都用它，並且一律帶上 --store-path "$VIBEFLOW_STORE_DIR"：',
  '  VF() { if [ -n "$VIBEFLOW_CLI_LOADER" ]; then node --experimental-strip-types --import "$VIBEFLOW_CLI_LOADER" "$VIBEFLOW_CLI" "$@"; else node "$VIBEFLOW_CLI" "$@"; fi; }',
]

/** The plan a master's card belongs to, as its launch tells it. */
export interface MasterContext {
  master: { id: string; title: string }
  /** The master's other cards, for knowing who does what — never this card itself. */
  siblings: Array<{ id: string; title: string; summary?: string }>
  /** Cards this one waited on. */
  after?: string[]
}

/**
 * What a card dispatched by a master is told. The person works with it
 * directly, so it is background — which plan it belongs to and who does the
 * rest — never a chain of command or a duty to report.
 */
export function slaveSystemPrompt(opts: { canWrite: boolean; context?: MasterContext }): string {
  const master = opts.context?.master
  const lines = [
    master
      ? `這張卡片是 VibeFlow Master 卡 ${master.id}「${master.title}」計畫中的一張（master 的 id 在 $VIBEFLOW_MASTER_ID）。`
      : '這張卡片是 VibeFlow Master 卡計畫中的一張（master 的 id 在 $VIBEFLOW_MASTER_ID）。',
    '使用者會直接在這張卡跟你協作，照使用者的指示做。',
  ]
  const siblings = opts.context?.siblings ?? []
  if (siblings.length) {
    lines.push('', '同一個計畫的其他卡片（讓你知道分工與介面，不是你的工作）：')
    for (const s of siblings) lines.push(`- ${s.id}「${s.title}」${s.summary ? `：${s.summary}` : ''}`)
  }
  if (opts.context?.after?.length) {
    lines.push('', `這張卡排在這些卡之後：${opts.context.after.join('、')}。`)
  }
  lines.push('', '你收到的 <vibeflow from="…"> 訊息來自 master 或 VibeFlow 本身。')
  if (opts.canWrite) {
    lines.push(
      '只有真的需要 master 決定才能繼續時才問它，做完工作不必回報：',
      ...BOARD_CLI_SETUP,
      '  VF task send --store-path "$VIBEFLOW_STORE_DIR" --task "$VIBEFLOW_MASTER_ID" --text "<問題>"'
    )
  }
  return lines.join('\n')
}

export function masterSystemPrompt(opts: { canWrite: boolean; autoMode: boolean; projects?: string[] }): string {
  const lines = [
    '你是 VibeFlow 的 Master agent，不屬於任何 repo，工作目錄只是你的筆記區。',
    '你的工作是理解使用者的任務、拆解成卡片、派工並排好先後，而不是自己改程式碼。',
    '派工之後使用者會直接跟每張卡協作：你不監工、不轉傳、不追蹤進度。',
  ]
  if (opts.projects?.length) {
    lines.push('', '相關專案（可以直接唯讀查看）：', ...opts.projects.map((dir) => `- ${dir}`))
  }
  lines.push('')
  if (!opts.canWrite) {
    lines.push(
      '這次啟動無法使用 board CLI（找不到 VIBEFLOW_CLI），你不能建立或啟動卡片。',
      '請把拆解結果整理成卡片清單（標題、專案路徑、prompt、先後順序）交給使用者手動建立。'
    )
    return lines.join('\n')
  }
  lines.push(
    ...BOARD_CLI_SETUP,
    '',
    '1. 規劃：先唯讀了解需求與相關 repo，不改任何程式碼。一張卡做得完就只建一張；涉及多個 repo 或可平行的獨立工作才拆成多張。每張只動一個 repo，各自能獨立驗收。',
    '   彼此有程式碼相依的工作盡量放在同一張；必須分開時用 --after 排先後，並提醒使用者前置卡要先 merge，後面的卡才會從含它的 base 開始。',
    '2. 計畫：把拆解寫進 "$VIBEFLOW_ARTIFACTS_DIR/plan.md"——每張卡的標題、專案、要做什麼、相依、卡與卡之間的介面約定——並在 terminal 摘要。',
    opts.autoMode
      ? '3. 確認：auto mode 開著，不必等使用者確認，寫完計畫就建卡。'
      : '3. 確認：寫完計畫就停下來，等使用者同意或修改；使用者同意之前不要建任何卡。',
    '4. 建卡：VF task create --store-path "$VIBEFLOW_STORE_DIR" --master "$VIBEFLOW_TASK_ID" --project <repo 絕對路徑> --title <標題> --prompt <內容> [--after <前置卡 id>]',
    '   prompt 必須自包含：背景、範圍、驗收條件、與其他卡的介面約定——卡片看不到你的對話。',
    '   標題要短、彼此一眼分得出來：以這張卡負責的部分開頭（例如「後端：…」「驗收：…」），不要讓多張卡共用同一段開頭。',
    '   預設不要加 --model / --effort：沒指定時 Jev 會依任務複雜度挑模型與 effort；只有任務明確需要特定模型或 effort 時才指定。需要時可加 --agent / --base-branch。',
    opts.autoMode
      ? '5. 啟動：沒有 --after 的卡直接 VF task start --store-path "$VIBEFLOW_STORE_DIR" --task <id>；有 --after 的卡不用管，前置卡全部 Done 後 VibeFlow 會自動啟動它。'
      : '5. 啟動：不要自己啟動卡片。列出你建了哪些卡與建議的啟動順序，等使用者在 VibeFlow 按開始。',
    '6. 結束：派工完就結束這一回合，列出每張卡與相依。不要輪詢 task list，也不要等卡片回報。',
    '   VibeFlow 只會在兩種情況再叫你：某張卡啟動失敗，或你的卡全部都已 Done。全部 Done 時，用 VF task list --store-path "$VIBEFLOW_STORE_DIR" --master "$VIBEFLOW_TASK_ID" 與 VF task show 整理每張卡的結果與 PR 連結交給使用者。',
    '   使用者要你轉達時才用 VF task send --store-path "$VIBEFLOW_STORE_DIR" --task <id> --text <內容> 對卡片下指示。你不會把卡片移到 Done、不會合併 PR。',
    '   跟使用者提到任何一張卡時，一律寫成 <id>「<標題>」——卡片上看得到 id，使用者靠它對上是哪一張。'
  )
  return lines.join('\n')
}

/** Build the initial prompt fed to the agent from a card's title + description. */
export function buildPrompt(
  task: Pick<Task, 'title' | 'description'>,
  preface?: LaunchPreface
): string {
  const lines = [`任務標題：${task.title}`]
  const description = task.description?.trim()
  if (description) {
    lines.push('', '任務描述：', description)
  }
  const context = preface?.context.trim()
  if (preface && context) {
    lines.push('', `前置分析（${preface.model}，僅供參考）：`, context)
  }
  return lines.join('\n')
}

/** A read-only scout's analysis of the repo, handed to the agent after the card text. */
export interface LaunchPreface {
  model: string
  context: string
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
   * only launch settings.
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
   * Store dir + CLI paths the agent needs to create sub-cards and rewrite its
   * own card. Absent → no VIBEFLOW_CLI is exported and the board stays
   * read-only for the agent.
   */
  boardCli?: BoardCliLaunchInfo
  /**
   * VibeFlow's own skill / prompt / script library for this launch. Claude
   * loads it as a session-only plugin; Codex gets a CODEX_HOME whose `skills/`
   * VibeFlow assembled, since Codex discovers skills only from there. Absent →
   * nothing is enabled and no library flag is added.
   */
  library?: LibraryLaunchInfo
  /** Jev's scout analysis for this run; added to the first prompt only. */
  preface?: LaunchPreface
  /** For a master's card: the plan it belongs to. */
  masterContext?: MasterContext
  /**
   * The first message of a session that carries on a card another session
   * worked on (continuation.ts). It stands in for the card text, which it
   * already contains. Never combined with `resume`.
   */
  continuation?: string
  /**
   * The card's Auto Mode: whether the agent may act without asking for
   * approval. ON gives Claude `--permission-mode auto` and Codex
   * `--dangerously-bypass-approvals-and-sandbox`; OFF leaves both in the
   * interactive mode where every action waits for the user.
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
  model: string | undefined,
  effort?: Task['effort'],
  opts?: LaunchOptions,
  worktreePath?: string,
  sessionId?: string,
  workspacePath?: string,
  readDirs: readonly string[] = []
): string {
  let cmd: string
  const readDirFlags = readDirs.map((dir) => `--add-dir ${shellQuote(toShellPath(dir))}`)
  if (agent === 'claude') {
    // Inline --settings: dark theme always, sub-agent recording hooks only
    // when the worktree path is known (session-only, never touches the repo).
    const settings = ` --settings ${shellQuote(buildClaudeSettings(worktreePath))}`
    // Grant access to the workspace folder so the agent can write artifacts
    // outside the worktree.
    const addDir = (workspacePath
      ? ` --add-dir ${shellQuote(toShellPath(workspacePath))}`
      : '') + readDirFlags.map((flag) => ` ${flag}`).join('')
    const modelFlag = model ? ` --model ${model}` : ''
    const effortFlag = effort && effort !== 'auto' ? ` --effort ${effort}` : ''
    // Library skills ride in as a session-only plugin; --add-dir is what makes
    // its scripts readable and runnable from inside the worktree.
    const library = opts?.library
    const libraryFlags = library
      ? ` --plugin-dir ${shellQuote(toShellPath(library.pluginDir))}` +
        ` --add-dir ${shellQuote(toShellPath(library.libraryDir))}`
      : ''
    const flags = `--chrome${claudePermissionFlag(opts?.autoMode)}${modelFlag}${effortFlag}${settings}${addDir}${libraryFlags}`
    const sysFlag = systemPrompt
      ? ` --append-system-prompt ${shellQuote(systemPrompt)}`
      : ''
    // `--add-dir` is variadic: without `--` the prompt is taken as another directory.
    const promptArg = prompt ? ` -- ${shellQuote(prompt)}` : ''
    const tail = `${flags}${sysFlag}${promptArg}`
    cmd = (sessionId && opts?.resume)
      ? claudeResumeOrFresh(sessionId, worktreePath, tail)
      : `claude ${sessionId ? `--session-id ${sessionId} ` : opts?.resume ? '--continue ' : ''}${tail}\r`
  } else {
    // Codex has no separate system-prompt flag — fold it into the body.
    const combined = [systemPrompt, prompt].filter(Boolean).join('\n\n')
    const codexEffortFlag = effort && effort !== 'auto'
      ? `-c ${shellQuote(`model_reasoning_effort="${effort}"`)} `
      : ''
    // Auto Mode ON → bypass approvals so Codex runs unattended; OFF → default
    // interactive mode (waits for the user to approve each step).
    const args = [
      codexAutoFlag(opts?.autoMode).trim(),
      codexEffortFlag.trim(),
      model ? `--model ${model}` : '',
      ...readDirFlags,
      combined ? shellQuote(combined) : '',
    ].filter(Boolean)
    // Codex discovers skills only from $CODEX_HOME/skills, so the library is
    // delivered by pointing the launch at the home VibeFlow assembled.
    const codexHome = opts?.library
      ? `CODEX_HOME=${shellQuote(toShellPath(opts.library.codexHome))} `
      : ''
    cmd = `${codexHome}${['codex', ...args].join(' ')}\r`
  }
  // ponytail: warn at 200KB — macOS ARG_MAX is 1MB but prompts can grow
  if (cmd.length > 200_000) console.warn(`[VibeFlow] launch command is ${cmd.length} bytes — approaching ARG_MAX`)
  return cmd
}

/** Display names for the supported agent CLIs (mirrors packages/core/src/agents.ts). */
export const AGENT_NAMES: Record<AgentCliId, string> = {
  claude: 'Claude Code',
  codex: 'Codex CLI',
}

/** Models older builds stored that the CLIs no longer serve; such cards run on the CLI's default. */
const RETIRED_MODELS: Partial<Record<AgentCliId, readonly string[]>> = {
  codex: ['gpt-5-codex', 'gpt-5'],
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

/**
 * The model passed to the agent CLI, or undefined to leave the choice to the
 * CLI — its own default honours the user's CLI config and account.
 */
export function taskModel(task: Pick<Task, 'agentCli' | 'model'>): string | undefined {
  const model = task.model?.trim()
  if (!model || RETIRED_MODELS[taskAgent(task)]?.includes(model)) return undefined
  return model
}

/**
 * Build the launch command for a task's single agent session.
 *
 * Codex has no separate system-prompt flag, so the custom system prompt and
 * task prompt are folded into one CLI argument.
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
    | 'role'
    | 'masterId'
    | 'projects'
  >,
  systemPrompt?: string | null,
  opts?: LaunchOptions,
  workspacePath?: string
): string {
  const agent = taskAgent(task)
  const model = taskModel(task)
  // Enabled Library prompt snippets come before the user's own system prompt.
  const custom = [opts?.library?.promptText?.trim(), resolveSystemPrompt(systemPrompt)]
    .filter(Boolean)
    .join('\n\n')
  const canWrite = Boolean(opts?.boardCli?.cliPath)
  const role = task.role === 'master'
    ? masterSystemPrompt({ canWrite, autoMode: opts?.autoMode === true, projects: task.projects })
    : task.masterId
      ? slaveSystemPrompt({ canWrite, context: opts?.masterContext })
      : null
  const sys = [custom, role].filter(Boolean).join('\n\n')
  const includeTaskPrompt = opts?.includeTaskPrompt !== false
  // Resuming restores the existing conversation verbatim. Do not submit a new
  // user turn automatically; the user can decide what to ask next.
  const prompt = includeTaskPrompt && !opts?.resume
    ? opts?.continuation ?? buildPrompt(task, opts?.preface)
    : ''
  // An agent-only launch is intentionally independent from the task's pinned
  // conversation. Claude creates a fresh interactive session of its own.
  const sessionId = agent === 'claude' && includeTaskPrompt
    ? executorSessionId(task.id, task.runId)
    : undefined
  return (
    boardEnvPrefix(task, opts, workspacePath) +
    assembleCommand(
      agent,
      sys,
      prompt,
      model,
      task.effort,
      opts,
      task.worktreePath,
      sessionId,
      workspacePath,
      task.role === 'master' ? task.projects ?? [] : []
    )
  )
}

/** What an inventory pass is told about the card and the pass. */
export interface InventoryPromptInput {
  title: string
  description?: string
  /** Text the user added in the inventory panel. */
  context?: string
  /** Files the user attached in the inventory panel. */
  attachments?: string[]
  /** spec.md / plan.md an earlier pass wrote, relative to the worktree. */
  existingDocs?: string[]
  /** Shell command prefixes the pass may run (Claude); empty = the agent's sandbox decides (Codex). */
  commands: string[]
  docsDir: string
  resultMark: string
}

/**
 * The prompt of a headless inventory pass. Nobody can answer it while it
 * runs, so everything it needs from a person goes into 執行準備 instead of a
 * question, and its last line tells VibeFlow whether the card is ready.
 */
export function inventoryPrompt(input: InventoryPromptInput): string {
  const lines = [
    '你在 VibeFlow 的「盤點」階段，以 headless 模式執行：沒有終端機，也沒有人能即時回答你。不要使用 AskUserQuestion 或任何需要互動的工具。',
    '',
    '## 這一次要做的事',
    `1. 依 feature-spec-plan 的做法，在 ${input.docsDir}/<功能 slug>/ 產出或更新 spec.md 與 plan.md。不要做功能實作，不要修改 ${input.docsDir}/ 以外的任何檔案，不要 commit 或 push。`,
    '2. plan.md 必須有「## 執行準備」段落，依序列出：',
    '   - 需要使用者決定的事項（每項附建議）',
    '   - 執行階段會用到的指令與權限',
    '   - 需要的資源（檔案、帳號、token、測試資料）與這次的驗證結果（通過或失敗）',
    '   - 允許的遠端操作（例如 commit、push 到卡片分支、開 draft PR）',
    '   - 停止條件：碰到就要停下來回報的情況',
    '3. 實際驗證資源。需要 secret 的資源（例如 JFrog auth token）只能用會用到認證、但不會印出值的檢查（例如 `npm whoami --registry <url>`）。不要讀取、輸出或記錄任何 secret 的值，也不要讀 .env、.npmrc 或憑證檔；文件裡只寫「通過」或「失敗」與缺什麼。',
    '4. 推到共用分支、force push、處理 secret、更動 lock 檔不能事先授權，只能列在停止條件。',
    '5. 所有項目都已就緒時，在 plan.md 的執行準備開頭寫明「可直接執行」。',
  ]
  if (input.commands.length) {
    lines.push('', '## 可以執行的指令', '只有以下開頭的指令會被允許，其他都會被拒絕：', ...input.commands.map((c) => `- \`${c}\``))
    lines.push('需要清單外的指令才能驗證時，不要繞過：把「需要允許指令 X（用途）」寫進執行準備的待決定事項。')
  }
  lines.push('', '## 卡片', `任務標題：${input.title}`)
  const description = input.description?.trim()
  if (description) lines.push('', '任務描述：', description)
  if (input.existingDocs?.length) {
    lines.push('', '## 上一次盤點的文件', '以這些檔案為基礎更新，不要另開新的功能目錄：', ...input.existingDocs.map((d) => `- ${d}`))
  }
  const context = input.context?.trim()
  if (context) lines.push('', '## 使用者補充的 context', context)
  if (input.attachments?.length) {
    lines.push('', '## 使用者附加的檔案', ...input.attachments.map((a) => `- ${a}`))
  }
  lines.push(
    '',
    '## 結束時',
    '用幾行摘要說明：文件在哪裡、還有哪些待回答的問題或缺少的資源（逐條列出）、驗證結果。',
    `最後一行只寫 \`${input.resultMark} ready\`（全部就緒）或 \`${input.resultMark} needs_answer\`（還有待決定的事或缺少的資源）。`
  )
  return lines.join('\n')
}
