import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Paperclip, Send, Sparkles, Scissors } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { chatCompact, chatLoad, chatSend, onChatChunk } from '@/lib/api'
import { executorSessionId, resolveSystemPrompt, taskModel } from '@/lib/claude'
import { cn } from '@/lib/utils'
import type { ChatMessage, Conversation, Role, Task } from '@/lib/types'

interface ChatPanelProps {
  task: Task
  systemPrompt: string
  executorRole?: Role | null
  workspacePath?: string
  /**
   * Prompt to auto-send (e.g. initial launch or revise). Bump `pendingNonce`
   * to (re-)trigger sending the same text.
   */
  pendingMessage?: string | null
  pendingNonce?: number
  readOnly?: boolean
  /** Shown when no messages exist yet and the panel is not read-only. */
  launchLabel?: string
  onLaunchRequest?: () => void
}

interface PendingAttachment {
  name: string
  mime: string
  dataBase64: string
  preview?: string // data URL for images
}

function AttachmentBadge({
  att,
  onRemove,
}: {
  att: PendingAttachment
  onRemove: () => void
}) {
  return (
    <div className="flex items-center gap-1 rounded bg-white/10 px-2 py-0.5 text-xs">
      {att.preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={att.preview} alt={att.name} className="h-4 w-4 rounded object-cover" />
      ) : (
        <Paperclip className="size-3 shrink-0" />
      )}
      <span className="max-w-[80px] truncate">{att.name}</span>
      <button
        type="button"
        onClick={onRemove}
        className="ml-0.5 text-muted-foreground hover:text-foreground"
      >
        ×
      </button>
    </div>
  )
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  if (msg.isCompactMarker) {
    return (
      <div className="flex items-center gap-2 py-2">
        <div className="h-px flex-1 bg-border" />
        <span className="text-[10px] text-muted-foreground">已壓縮 context</span>
        <div className="h-px flex-1 bg-border" />
      </div>
    )
  }

  const isUser = msg.role === 'user'
  const isSystem = msg.role === 'system'

  if (isSystem) {
    return (
      <div className="py-1 text-center text-[10px] text-muted-foreground">
        {msg.text}
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col gap-0.5', isUser ? 'items-end' : 'items-start')}>
      {msg.attachments?.map((att) => (
        <div
          key={att.id}
          className="flex items-center gap-1 rounded bg-white/5 px-2 py-0.5 text-[10px] text-muted-foreground"
        >
          <Paperclip className="size-3" />
          <span className="max-w-[120px] truncate">{att.name}</span>
        </div>
      ))}
      <div
        className={cn(
          'max-w-[85%] rounded-lg px-3 py-2 text-sm',
          isUser
            ? 'bg-primary/20 text-foreground'
            : 'bg-white/[0.06] text-foreground'
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap break-words">{msg.text}</p>
        ) : (
          <div className="prose prose-invert prose-sm max-w-none break-words">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  )
}

function StreamingBubble({ text }: { text: string }) {
  return (
    <div className="flex items-start">
      <div className="max-w-[85%] rounded-lg bg-white/[0.06] px-3 py-2 text-sm">
        <div className="prose prose-invert prose-sm max-w-none break-words">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text || '…'}</ReactMarkdown>
        </div>
      </div>
    </div>
  )
}

export function ChatPanel({
  task,
  systemPrompt,
  executorRole,
  workspacePath,
  pendingMessage,
  pendingNonce = 0,
  readOnly = false,
  launchLabel,
  onLaunchRequest,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState<string | null>(null) // null = not streaming
  const [input, setInput] = useState('')
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([])
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Track the last nonce we acted on so we don't resend on re-render.
  const sentNonceRef = useRef(-1)
  const pendingMessageRef = useRef(pendingMessage)
  pendingMessageRef.current = pendingMessage

  // Load persisted conversation on mount.
  useEffect(() => {
    chatLoad(task.id).then((conv: Conversation | null) => {
      if (conv?.messages?.length) setMessages(conv.messages)
    })
  }, [task.id])

  // Subscribe to streaming chunks.
  useEffect(() => {
    return onChatChunk((chunk) => {
      if (chunk.taskId !== task.id) return
      if (chunk.done) {
        setStreaming(null)
        setSending(false)
        // Add the final assistant message to the list.
        setMessages((prev) => [
          ...prev,
          {
            id: `stream-${Date.now()}`,
            role: 'assistant',
            text: chunk.delta,
            ts: Date.now(),
          },
        ])
      } else {
        setStreaming((prev) => (prev ?? '') + chunk.delta)
      }
    })
  }, [task.id])

  // Scroll to bottom when messages change.
  useLayoutEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streaming])

  const sessionId = executorSessionId(task.id)
  const hasMessages = messages.length > 0

  const doSend = useCallback(
    async (text: string, attachments: PendingAttachment[]) => {
      if (!text.trim() && attachments.length === 0) return
      if (!task.worktreePath) return
      setSending(true)
      setStreaming('')
      setMessages((prev) => [
        ...prev,
        {
          id: `user-${Date.now()}`,
          role: 'user',
          text: text.trim(),
          ts: Date.now(),
          attachments: attachments.map((a, i) => ({
            id: `att-${i}`,
            name: a.name,
            mime: a.mime,
            path: '',
          })),
        },
      ])
      const role = executorRole
        ? {
            name: executorRole.name ?? '',
            positioning: executorRole.positioning,
            responsibilities: executorRole.responsibilities,
            boundaries: executorRole.boundaries,
          }
        : undefined
      const effectiveSystemPrompt = resolveSystemPrompt(systemPrompt, role)
      await chatSend({
        taskId: task.id,
        worktreePath: task.worktreePath,
        text: text.trim(),
        attachments: attachments.map((a) => ({
          name: a.name,
          mime: a.mime,
          dataBase64: a.dataBase64,
        })),
        sessionId,
        resume: hasMessages,
        systemPrompt: effectiveSystemPrompt,
        model: taskModel(task),
        workspacePath,
      })
    },
    [task, sessionId, hasMessages, executorRole, systemPrompt, workspacePath]
  )

  // Auto-send pending message when nonce changes.
  useEffect(() => {
    if (readOnly) return
    const msg = pendingMessageRef.current
    if (!msg || sentNonceRef.current === pendingNonce) return
    sentNonceRef.current = pendingNonce
    doSend(msg, [])
  }, [pendingNonce, readOnly, doSend])

  const handleSend = async () => {
    const text = input.trim()
    if (!text && pendingAttachments.length === 0) return
    setInput('')
    setPendingAttachments([])
    await doSend(text, pendingAttachments)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    const newAtts = await Promise.all(files.map(readFileAsAttachment))
    setPendingAttachments((prev) => [...prev, ...newAtts])
  }

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files)
    if (!files.length) return
    const newAtts = await Promise.all(files.map(readFileAsAttachment))
    setPendingAttachments((prev) => [...prev, ...newAtts])
  }

  const handleCompact = async () => {
    await chatCompact(task.id)
    setMessages((prev) => [
      ...prev,
      {
        id: `compact-${Date.now()}`,
        role: 'system',
        text: '',
        ts: Date.now(),
        isCompactMarker: true,
      },
    ])
  }

  // Resize textarea to fit content.
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }

  return (
    <div className="mt-2 flex min-h-36 w-full flex-1 flex-col overflow-hidden rounded-md bg-black/80">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between bg-white/[0.06] px-2 py-1">
        <span className="min-w-0 truncate font-mono text-[10px] text-muted-foreground">
          {task.worktreePath ?? '(no worktree)'}
        </span>
        <div className="flex items-center gap-1">
          {!readOnly && hasMessages && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 shrink-0 px-2 text-[10px]"
              onClick={handleCompact}
              title="壓縮 context（Compact）"
            >
              <Scissors className="size-3" />
              Compact
            </Button>
          )}
          {readOnly ? (
            <span className="shrink-0 px-2 text-[10px] uppercase tracking-wide text-muted-foreground">
              唯讀
            </span>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 shrink-0 px-2 text-[10px]"
              onClick={onLaunchRequest}
              disabled={!onLaunchRequest}
            >
              <Sparkles className="size-3" />
              {launchLabel ?? '啟動 Agent'}
            </Button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}
        {streaming !== null && <StreamingBubble text={streaming} />}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      {!readOnly && (
        <div className="shrink-0 border-t border-white/10 p-2">
          {pendingAttachments.length > 0 && (
            <div className="mb-1 flex flex-wrap gap-1">
              {pendingAttachments.map((att, i) => (
                <AttachmentBadge
                  key={i}
                  att={att}
                  onRemove={() =>
                    setPendingAttachments((prev) => prev.filter((_, j) => j !== i))
                  }
                />
              ))}
            </div>
          )}
          <div className="flex items-end gap-1.5">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="mb-1 shrink-0 rounded p-1 text-muted-foreground hover:bg-white/10 hover:text-foreground"
              title="附加檔案"
            >
              <Paperclip className="size-3.5" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="輸入訊息… (Enter 送出, Shift+Enter 換行)"
              rows={1}
              disabled={sending}
              className="min-h-[32px] flex-1 resize-none rounded bg-white/5 px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-white/20 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || (!input.trim() && pendingAttachments.length === 0)}
              className="mb-1 shrink-0 rounded p-1 text-muted-foreground hover:bg-white/10 hover:text-foreground disabled:opacity-40"
              title="送出"
            >
              <Send className="size-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

async function readFileAsAttachment(file: File): Promise<PendingAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const base64 = dataUrl.split(',')[1]
      resolve({
        name: file.name,
        mime: file.type || 'application/octet-stream',
        dataBase64: base64,
        preview: file.type.startsWith('image/') ? dataUrl : undefined,
      })
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
