import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import path from 'path'
import fs from 'fs'
import type { WebContents } from 'electron'
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

/** Resolve the claude binary from PATH. */
function claudeBin(): string {
  return 'claude'
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

  const sessionFlag = resume ? `--resume ${sessionId}` : `--session-id ${sessionId}`
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

  const cmd = [
    claudeBin(),
    '--print',
    '--output-format stream-json',
    `--permission-mode auto`,
    `--model ${shellQuote(model)}`,
    sessionFlag,
    addDirFlag,
    `--append-system-prompt ${shellQuote(systemPrompt)}`,
    shellQuote(fullText),
  ].filter(Boolean).join(' ')

  const proc = spawn('sh', ['-lc', cmd], {
    cwd: worktreePath,
    env: execEnv(),
  })

  let accumulated = ''
  let buffer = ''

  const push = (chunk: ChatChunk) => {
    if (!sender.isDestroyed()) sender.send('chat:chunk', chunk)
  }

  proc.stdout.on('data', (raw: Buffer) => {
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
          message?: { role?: string; content?: Array<{ type: string; text?: string }> }
        }
        if (event.type === 'assistant' && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === 'text' && block.text) {
              const delta = block.text.slice(accumulated.length)
              if (delta) {
                accumulated = block.text
                push({ taskId, delta, done: false })
              }
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
