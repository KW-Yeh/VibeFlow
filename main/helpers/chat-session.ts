import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import path from 'path'
import fs from 'fs'
import type { WebContents } from 'electron'
import type { AgentCliId } from './agents'
import { execEnv } from './env'
import { appendMessage, type ChatAttachment } from './chat-store'

export interface AttachmentInput {
  name: string
  mime: string
  dataBase64: string
}

export interface SendOptions {
  taskId: string
  worktreePath: string
  text: string
  attachments?: AttachmentInput[]
  sessionId: string
  /** true = --resume <sessionId>, false = --session-id <sessionId> (fresh session) */
  resume: boolean
  systemPrompt: string
  agentCli?: AgentCliId
  model: string
  workspacePath?: string
}

/** Chunk pushed to the renderer while the assistant streams. */
export interface ChatChunk {
  taskId: string
  /** Incremental text delta (may be empty for non-text events). */
  delta: string
  /** true when this is the final event and `delta` is the full response text. */
  done: boolean
  error?: string
}

export type PhaseType = 'thinking' | 'tool_use' | 'tool_result'

/** A discrete agent execution step pushed to the renderer during streaming. */
export interface ChatPhase {
  taskId: string
  id: string
  phaseType: PhaseType
  phaseSummary: string
  phaseDetail: string
  done: boolean
}

function basename(p: string): string {
  return p.split('/').pop() ?? p
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}

function summarizeToolUse(name: string, input: Record<string, unknown>): { summary: string; detail: string } {
  const detail = JSON.stringify(input, null, 2)
  let summary: string
  switch (name) {
    case 'Bash': {
      const cmd = typeof input.command === 'string'
        ? truncate(input.command.trim().replace(/\n/g, ' '), 60)
        : name
      summary = `Running \`${cmd}\``
      break
    }
    case 'Read':
      summary = `Reading \`${basename(String(input.file_path ?? ''))}\``
      break
    case 'Write':
      summary = `Writing \`${basename(String(input.file_path ?? ''))}\``
      break
    case 'Edit':
    case 'MultiEdit':
      summary = `Editing \`${basename(String(input.file_path ?? ''))}\``
      break
    case 'Glob':
    case 'Grep':
      summary = `Searching \`${truncate(String(input.pattern ?? input.query ?? ''), 40)}\``
      break
    case 'Task':
      summary = `Delegating: ${truncate(String(input.description ?? input.prompt ?? ''), 50)}`
      break
    default:
      summary = `Using \`${name}\``
  }
  return { summary, detail }
}

/** Resolve the claude binary from PATH. */
function claudeBin(): string {
  return 'claude'
}

function buildRawAgentCommand(
  agentCli: Exclude<AgentCliId, 'claude'>,
  model: string,
  fullText: string,
  systemPrompt: string,
  worktreePath: string,
  workspacePath?: string
): string {
  const combined = `${systemPrompt}\n\n${fullText}`
  if (agentCli === 'codex') {
    const addDir = workspacePath ? ` --add-dir ${shellQuote(workspacePath)}` : ''
    return `codex exec --model ${shellQuote(model)} --sandbox workspace-write --ask-for-approval never -C ${shellQuote(worktreePath)}${addDir} --color never ${shellQuote(combined)}`
  }
  if (agentCli === 'copilot') {
    const addDir = workspacePath ? ` --add-dir ${shellQuote(workspacePath)}` : ''
    return `copilot --allow-all-tools --model ${shellQuote(model)}${addDir} -p ${shellQuote(combined)}`
  }
  return `gemini --yolo -i --model ${shellQuote(model)} ${shellQuote(combined)}`
}

/** Write base64-encoded attachment bytes to a temp dir inside the worktree. */
function writeAttachment(worktreePath: string, input: AttachmentInput): ChatAttachment {
  const attachDir = path.join(worktreePath, '.vibeflow-attachments')
  fs.mkdirSync(attachDir, { recursive: true })
  const id = randomUUID().slice(0, 8)
  const filePath = path.join(attachDir, `${id}-${input.name}`)
  fs.writeFileSync(filePath, Buffer.from(input.dataBase64, 'base64'))
  return { id, name: input.name, mime: input.mime, path: filePath }
}

/** Quote a string for safe use as a single POSIX shell argument. */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/**
 * Spawn claude in --print --output-format stream-json mode, stream the
 * response back to the renderer via `chat:chunk` events, and persist the
 * user + assistant messages to the chat store.
 *
 * Returns a cleanup function that kills the process (used when the task is
 * deleted while a response is in flight).
 */
export function sendChatMessage(
  opts: SendOptions,
  sender: WebContents,
): () => void {
  const {
    taskId,
    worktreePath,
    text,
    attachments: attachmentInputs = [],
    sessionId,
    resume,
    systemPrompt,
    agentCli = 'claude',
    model,
    workspacePath,
  } = opts

  // Write attachment files and build the augmented message text.
  const savedAttachments: ChatAttachment[] = []
  const attachmentLines: string[] = []
  for (const input of attachmentInputs) {
    const saved = writeAttachment(worktreePath, input)
    savedAttachments.push(saved)
    attachmentLines.push(`[附件: ${saved.path}]`)
  }
  const fullText = attachmentLines.length
    ? `${text}\n\n${attachmentLines.join('\n')}`
    : text

  // Persist the user message immediately (before the response arrives).
  const userMsgId = randomUUID().slice(0, 8)
  appendMessage(taskId, {
    id: userMsgId,
    role: 'user',
    text,
    ts: Date.now(),
    attachments: savedAttachments.length ? savedAttachments : undefined,
  })

  const addDirFlag = workspacePath ? `--add-dir ${shellQuote(workspacePath)}` : ''
  const ensureGitignore = () => {
    const gi = path.join(worktreePath, '.gitignore')
    const entry = '.vibeflow-attachments/'
    try {
      const content = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : ''
      if (!content.includes(entry)) {
        fs.appendFileSync(gi, `\n${entry}\n`)
      }
    } catch { /* best effort */ }
  }
  if (savedAttachments.length) ensureGitignore()

  const sessionFlag = resume ? `--resume ${sessionId}` : `--session-id ${sessionId}`
  const cmd = agentCli === 'claude'
    ? [
        claudeBin(),
        '--print',
        '--output-format stream-json',
        '--verbose', // required by claude CLI when --print + stream-json
        `--permission-mode auto`,
        `--model ${shellQuote(model)}`,
        sessionFlag,
        addDirFlag,
        `--append-system-prompt ${shellQuote(systemPrompt)}`,
        shellQuote(fullText),
      ].filter(Boolean).join(' ')
    : buildRawAgentCommand(agentCli, model, fullText, systemPrompt, worktreePath, workspacePath)

  const proc = spawn('sh', ['-lc', cmd], {
    cwd: worktreePath,
    env: execEnv(),
  })

  let accumulated = ''
  let buffer = ''
  let seq = 0
  const toolNames = new Map<string, string>()

  const push = (chunk: ChatChunk) => {
    if (!sender.isDestroyed()) sender.send('chat:chunk', chunk)
  }

  const pushPhase = (p: ChatPhase) => {
    if (!sender.isDestroyed()) sender.send('chat:phase', p)
  }

  proc.stdout.on('data', (raw: Buffer) => {
    if (agentCli !== 'claude') {
      const delta = raw.toString()
      accumulated += delta
      push({ taskId, delta, done: false })
      return
    }
    buffer += raw.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const event = JSON.parse(trimmed) as {
          type: string
          subtype?: string
          result?: string
          message?: {
            role?: string
            content?: Array<{
              type: string
              text?: string
              thinking?: string
              id?: string
              name?: string
              input?: Record<string, unknown>
              tool_use_id?: string
              content?: string | Array<{ type: string; text?: string }>
              is_error?: boolean
            }>
          }
        }
        if (event.type === 'assistant' && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === 'text' && block.text) {
              const delta = block.text.slice(accumulated.length)
              if (delta) {
                accumulated = block.text
                push({ taskId, delta, done: false })
              }
            } else if (block.type === 'thinking' && block.thinking) {
              pushPhase({
                taskId,
                id: `${taskId}-${seq++}`,
                phaseType: 'thinking',
                phaseSummary: 'Thinking…',
                phaseDetail: block.thinking,
                done: true,
              })
            } else if (block.type === 'tool_use' && block.name) {
              const toolId = block.id ?? ''
              toolNames.set(toolId, block.name)
              const { summary, detail } = summarizeToolUse(block.name, block.input ?? {})
              pushPhase({
                taskId,
                id: `${taskId}-${seq++}`,
                phaseType: 'tool_use',
                phaseSummary: summary,
                phaseDetail: detail,
                done: true,
              })
            }
          }
        }
        if (event.type === 'user' && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === 'tool_result') {
              const toolName = toolNames.get(block.tool_use_id ?? '') ?? 'Tool'
              const raw = block.content
              const detail = typeof raw === 'string'
                ? raw
                : Array.isArray(raw)
                  ? raw.map((c) => c.text ?? '').join('\n')
                  : ''
              pushPhase({
                taskId,
                id: `${taskId}-${seq++}`,
                phaseType: 'tool_result',
                phaseSummary: `Got result from \`${toolName}\``,
                phaseDetail: detail,
                done: true,
              })
            }
          }
        }
        if (event.type === 'result' && event.result) {
          // Emit any remaining text not yet pushed.
          const remaining = event.result.slice(accumulated.length)
          if (remaining) push({ taskId, delta: remaining, done: false })
          accumulated = event.result
        }
      } catch {
        // Non-JSON line (e.g. warnings) — ignore.
      }
    }
  })

  proc.stderr.on('data', (raw: Buffer) => {
    // stderr from claude is warnings/errors — surface as a system message.
    const msg = raw.toString().trim()
    if (msg) push({ taskId, delta: '', done: false, error: msg })
  })

  proc.on('close', (code) => {
    const assistantText = accumulated || '（無回應）'
    // Persist the assistant message.
    appendMessage(taskId, {
      id: randomUUID().slice(0, 8),
      role: 'assistant',
      text: assistantText,
      ts: Date.now(),
    })
    const error = code !== 0 ? `Process exited with code ${code}` : undefined
    push({ taskId, delta: assistantText, done: true, error })
  })

  return () => {
    try { proc.kill('SIGTERM') } catch { /* already dead */ }
  }
}

/** Active send processes keyed by taskId (at most one per task at a time). */
const activeProcs = new Map<string, () => void>()

/**
 * Cancel any in-flight send for a task (called on task delete / cleanup).
 */
export function cancelChatSend(taskId: string): void {
  activeProcs.get(taskId)?.()
  activeProcs.delete(taskId)
}

export function cancelAllChatSends(): void {
  activeProcs.forEach((kill) => kill())
  activeProcs.clear()
}

/** Start a send; cancel any previous in-flight one for the same task. */
export function startChatSend(opts: SendOptions, sender: WebContents): void {
  cancelChatSend(opts.taskId)
  const kill = sendChatMessage(opts, sender)
  activeProcs.set(opts.taskId, kill)
}
