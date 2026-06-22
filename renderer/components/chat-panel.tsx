import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Paperclip, Send, Square, Sparkles, Scissors, Terminal, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { chatCancel, chatCompact, chatLoad, chatSend, onChatChunk, onChatPhase } from '@/lib/api'
import {
  executorSessionId,
  resolveSystemPrompt,
} from '@/lib/claude'
import { cn } from '@/lib/utils'
import type { AgentCliId, ChatMessage, PhaseType, Conversation, Role, Task } from '@/lib/types'

// Renderer-only phase message — transient, not persisted to chat store.
type PhaseMessage = {
  id: string
  role: 'phase'
  phaseType: PhaseType
  phaseSummary: string
  phaseDetail: string
  ts: number
}

type LocalMessage = ChatMessage | PhaseMessage

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
  agentCli?: AgentCliId
  model?: string
  readOnly?: boolean
  /** Shown when no messages exist yet and the panel is not read-only. */
  launchLabel?: string
  onLaunchRequest?: () => void
  isVisible?: boolean
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

function MessageBubble({ msg }: { msg: LocalMessage }) {
  if (msg.role === 'phase') {
    return <PhaseBubble msg={msg} />
  }

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

function PhaseBubble({ msg }: { msg: PhaseMessage }) {
  const icon =
    msg.phaseType === 'thinking'
      ? <Sparkles className="size-3 shrink-0 text-violet-400" />
      : msg.phaseType === 'tool_result'
        ? <Check className="size-3 shrink-0 text-emerald-400" />
        : <Terminal className="size-3 shrink-0 text-sky-400" />
  return (
    <div className="flex items-start py-0.5">
      <div className="max-w-[90%] space-y-1 rounded border border-white/[0.06] bg-white/[0.03] px-2 py-1.5 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          {icon}
          <span className="font-medium">{msg.phaseSummary}</span>
        </div>
      </div>
    </div>
  )
}

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1 px-1 py-0.5">
      <span className="size-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:0ms]" />
      <span className="size-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:150ms]" />
      <span className="size-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:300ms]" />
    </div>
  )
}

function StreamingBubble({ text, active }: { text: string; active: boolean }) {
  return (
    <div className="flex items-start">
      <div className="max-w-[85%] rounded-lg bg-white/[0.06] px-3 py-2 text-sm">
        {text ? (
          <div className="prose prose-invert prose-sm max-w-none break-words">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
          </div>
        ) : (
          active && <ThinkingDots />
        )}
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
  agentCli = 'claude',
  model = 'sonnet',
  readOnly = false,
  launchLabel,
  onLaunchRequest,
  isVisible,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<LocalMessage[]>([])
  const [streaming, setStreaming] = useState<string | null>(null) // null = not streaming
  const [input, setInput] = useState('')
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([])
  const [sending, setSending] = useState(false)
  const [confirmCompact, setConfirmCompact] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Mirrors messages state so doSend always sees the current count without a stale closure.
  const messagesRef = useRef<LocalMessage[]>([])
  messagesRef.current = messages
  const loadDoneRef = useRef(false)
  // When set (after a compact), overrides the default executorSessionId.
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const activeSessionIdRef = useRef<string | null>(null)
  activeSessionIdRef.current = activeSessionId
  // Stable ref to the latest doSend so the load-completion callback can call it.
  const doSendRef = useRef<((text: string, attachments: PendingAttachment[]) => Promise<void>) | null>(null)

  // Track the last nonce we acted on so we don't resend on re-render.
  const sentNonceRef = useRef(-1)
  const pendingMessageRef = useRef(pendingMessage)
  pendingMessageRef.current = pendingMessage
  const pendingNonceRef = useRef(pendingNonce)
  pendingNonceRef.current = pendingNonce
  const readOnlyRef = useRef(readOnly)
  readOnlyRef.current = readOnly

  // Load persisted conversation on mount.
  useEffect(() => {
    loadDoneRef.current = false
    chatLoad(task.id).then((conv: Conversation | null) => {
      if (conv?.messages?.length) setMessages(conv.messages)
      if (conv?.activeSessionId) setActiveSessionId(conv.activeSessionId)
      loadDoneRef.current = true
      // Fire any pending send that was blocked waiting for load to complete.
      const msg = pendingMessageRef.current
      if (!readOnlyRef.current && msg && sentNonceRef.current !== pendingNonceRef.current) {
        sentNonceRef.current = pendingNonceRef.current
        doSendRef.current?.(msg, [])
      }
    })
  }, [task.id])

  // Subscribe to streaming chunks.
  useEffect(() => {
    return onChatChunk((chunk) => {
      if (chunk.taskId !== task.id) return
      if (chunk.done) {
        setStreaming(null)
        setSending(false)
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

  // Each agent phase (thinking / tool call / result) becomes a direct message.
  useEffect(() => {
    return onChatPhase((phase) => {
      if (phase.taskId !== task.id) return
      setMessages((prev) => [
        ...prev,
        {
          id: phase.id,
          role: 'phase',
          phaseType: phase.phaseType,
          phaseSummary: phase.phaseSummary,
          phaseDetail: phase.phaseDetail,
          ts: Date.now(),
        } satisfies PhaseMessage,
      ])
    })
  }, [task.id])

  // Scroll to bottom when messages change or panel becomes visible.
  useLayoutEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant' })
  }, [messages, streaming, isVisible])

  // Scroll to bottom when DOM content grows (e.g. PhaseRow expand/collapse).
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return
    const mo = new MutationObserver(() => {
      const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100
      if (nearBottom) bottomRef.current?.scrollIntoView({ behavior: 'instant' })
    })
    mo.observe(container, { childList: true, subtree: true })
    return () => mo.disconnect()
  }, [])

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
      // Use activeSessionId (post-compact) if available, otherwise the default session.
      const effectiveSessionId = activeSessionIdRef.current ?? executorSessionId(task.id)
      await chatSend({
        taskId: task.id,
        worktreePath: task.worktreePath,
        text: text.trim(),
        attachments: attachments.map((a) => ({
          name: a.name,
          mime: a.mime,
          dataBase64: a.dataBase64,
        })),
        sessionId: effectiveSessionId,
        resume: messagesRef.current.length > 0,
        systemPrompt: effectiveSystemPrompt,
        agentCli,
        model,
        workspacePath,
      })
    },
    [task, executorRole, systemPrompt, workspacePath, agentCli, model]
  )
  doSendRef.current = doSend

  // Auto-send pending message when nonce changes — but only after chatLoad completes
  // so that `resume` is decided with the correct message count.
  useEffect(() => {
    if (readOnly) return
    if (!loadDoneRef.current) return
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

  const handleCancel = () => {
    chatCancel(task.id)
    setSending(false)
    setStreaming(null)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (!sending) handleSend()
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
    const result = await chatCompact(task.id)
    if (result) {
      setMessages([])
      setActiveSessionId(result.newSessionId)
    }
  }

  // Resize textarea to fit content.
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }

  const notStarted = !task.launchedAt && !readOnly

  return (
    <div className="mt-2 flex min-h-36 w-full flex-1 flex-col overflow-hidden rounded-md bg-black/80">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between bg-white/[0.06] px-2 py-1">
        <span className="min-w-0 truncate font-mono text-[10px] text-muted-foreground">
          {task.worktreePath ?? '(no worktree)'}
        </span>
        <div className="flex items-center gap-1">
          {!readOnly && messages.length > 0 && (
            confirmCompact ? (
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 shrink-0 px-2 text-[10px]"
                  onClick={() => setConfirmCompact(false)}
                >
                  取消
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 shrink-0 px-2 text-[10px] text-destructive hover:text-destructive"
                  onClick={() => { setConfirmCompact(false); handleCompact() }}
                >
                  確認清除
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 shrink-0 px-2 text-[10px]"
                onClick={() => setConfirmCompact(true)}
                title="清除對話（開啟新 session，此操作無法復原）"
              >
                <Scissors className="size-3" />
                清除對話
              </Button>
            )
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
      <div ref={messagesContainerRef} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {notStarted && messages.length === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <Button
              size="sm"
              className="gap-1.5 rounded-full px-4"
              onClick={onLaunchRequest}
              disabled={!onLaunchRequest}
            >
              <Sparkles className="size-3.5" />
              {launchLabel ?? '啟動 Agent'}
            </Button>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <MessageBubble key={msg.id} msg={msg} />
            ))}
            {streaming !== null && <StreamingBubble text={streaming} active={sending} />}
            <div ref={bottomRef} />
          </>
        )}
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
              disabled={notStarted}
              className="mb-1 shrink-0 rounded p-1 text-muted-foreground hover:bg-white/10 hover:text-foreground disabled:opacity-40"
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
              placeholder={notStarted ? '請先啟動任務' : '輸入訊息… (Enter 送出, Shift+Enter 換行)'}
              rows={1}
              disabled={notStarted}
              className="min-h-[32px] flex-1 resize-none rounded bg-white/5 px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-white/20 disabled:opacity-40"
            />
            {sending ? (
              <button
                type="button"
                onClick={handleCancel}
                className="mb-1 shrink-0 rounded p-1 text-destructive hover:bg-white/10"
                title="中斷"
              >
                <Square className="size-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSend}
                disabled={notStarted || (!input.trim() && pendingAttachments.length === 0)}
                className="mb-1 shrink-0 rounded p-1 text-muted-foreground hover:bg-white/10 hover:text-foreground disabled:opacity-40"
                title="送出"
              >
                <Send className="size-3.5" />
              </button>
            )}
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
