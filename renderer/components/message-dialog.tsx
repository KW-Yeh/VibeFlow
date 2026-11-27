import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Check, Minus, SendHorizontal, X } from 'lucide-react'

import { IconButton } from '@/components/ui/icon-button'
import { getMessageThread, sendMessageNow, sendPersonMessage } from '@/lib/api'
import type { CardMessage, CardMessageThreadSummary, TaskProgress } from '@/lib/types'
import { cn } from '@/lib/utils'

const MAX_INPUT_LINES = 6
const LINE_PX = 20
const INPUT_PAD_PX = 22

type AgentStatus = { label: string; tone: 'working' | 'blocked' | 'idle' | 'off' }

function agentStatus(running: boolean, progress: TaskProgress | null | undefined): AgentStatus {
  if (!running) return { label: '收件卡 agent 沒在執行', tone: 'off' }
  const activity = progress?.activity
  if (activity?.state === 'working') return { label: '收件卡 agent 工作中', tone: 'working' }
  if (activity?.state === 'waiting' && activity.waitingFor === 'permission') return { label: '收件卡停在權限對話框', tone: 'blocked' }
  return { label: '收件卡 agent 閒置', tone: 'idle' }
}

const REFUSALS: Record<string, string> = {
  DRAFT_PENDING: '收件卡的輸入框裡有你還沒送出的文字。送出或清掉後再試。',
  TARGET_BLOCKED: 'agent 停在權限對話框，打字可能會回答它。先到 terminal 處理，訊息仍保持未讀。',
  NOT_RUNNING: 'agent 沒有在執行。訊息留在 inbox，下次啟動時會讀到。',
  ALREADY_READ: '這則訊息已經讀過了。',
}

function refusalText(err: unknown): string {
  const code = (err as { code?: string } | null)?.code
  return (code && REFUSALS[code]) || (err instanceof Error ? err.message : String(err))
}

const clock = (at: number) => new Date(at).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })

function dayLabel(at: number, now: number): string {
  const day = new Date(at).toDateString()
  if (day === new Date(now).toDateString()) return '今天'
  if (day === new Date(now - 86_400_000).toDateString()) return '昨天'
  return new Date(at).toLocaleDateString('zh-TW', { month: 'long', day: 'numeric' })
}

function waited(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000)
  return minutes < 1 ? '不到 1 分鐘' : `${minutes} 分鐘`
}

interface MessageDialogProps {
  thread: CardMessageThreadSummary
  revision: number
  running: boolean
  progress: TaskProgress | null | undefined
  titleOf: (taskId: string) => string | undefined
  isMaster: (taskId: string) => boolean
  onMinimize: () => void
  onClose: () => void
}

export function MessageDialog({ thread, revision, running, progress, titleOf, isMaster, onMinimize, onClose }: MessageDialogProps) {
  const [messages, setMessages] = useState<CardMessage[]>([])
  const [sending, setSending] = useState<Set<string>>(new Set())
  const [refusals, setRefusals] = useState<Record<string, string>>({})
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    let alive = true
    void getMessageThread(thread.from, thread.to).then((next) => {
      if (alive) setMessages(next)
    }).catch(() => {})
    return () => {
      alive = false
    }
  }, [thread.from, thread.to, revision])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [messages.length])

  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.style.height = 'auto'
    const max = MAX_INPUT_LINES * LINE_PX + INPUT_PAD_PX
    input.style.height = `${Math.min(input.scrollHeight, max)}px`
  }, [draft])

  const status = agentStatus(running, progress)
  const unread = messages.filter((m) => m.state === 'unread')
  const fromTitle = titleOf(thread.from) ?? thread.fromTitle
  const toTitle = titleOf(thread.to) ?? thread.toTitle

  async function sendNow(message?: CardMessage) {
    const ids = message ? [message.id] : unread.map((m) => m.id)
    setSending((s) => new Set([...s, ...ids]))
    setRefusals((r) => {
      const next = { ...r }
      for (const id of ids) delete next[id]
      return next
    })
    try {
      await sendMessageNow(thread.to, message?.id)
    } catch (err) {
      const text = refusalText(err)
      setRefusals((r) => ({ ...r, [message?.id ?? unread[unread.length - 1]?.id ?? '']: text }))
    } finally {
      setSending((s) => {
        const next = new Set(s)
        for (const id of ids) next.delete(id)
        return next
      })
    }
  }

  async function post() {
    const text = draft.trim()
    if (!text || posting) return
    setPosting(true)
    setPostError(null)
    try {
      await sendPersonMessage(thread.to, thread.from, text)
      setDraft('')
    } catch (err) {
      setPostError(refusalText(err))
    } finally {
      setPosting(false)
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
    e.preventDefault()
    void post()
  }

  let lastDay = ''
  return (
    <section
      role="dialog"
      aria-label={`${fromTitle} → ${toTitle} 的對話`}
      className="pointer-events-auto flex max-h-full w-[440px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-input bg-popover text-popover-foreground shadow-2xl"
    >
      <header className="flex flex-col gap-2 border-b border-border py-3 pl-4 pr-3">
        <div className="flex items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex min-w-0 items-center gap-1.5 text-[13px]">
              <span className={cn('size-2 shrink-0 rounded-full', isMaster(thread.from) ? 'bg-master' : 'bg-primary')} />
              <span className="truncate font-semibold">{fromTitle}</span>
              <span className="text-muted-foreground">→</span>
              <span className="truncate font-semibold">{toTitle}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {isMaster(thread.from) ? 'master' : '卡片'} {thread.from} → {isMaster(thread.to) ? 'master' : '卡片'} {thread.to}
            </div>
          </div>
          <IconButton aria-label="縮小" onClick={onMinimize} className="rounded-md p-2">
            <Minus className="size-4" />
          </IconButton>
          <IconButton aria-label="關閉" onClick={onClose} className="rounded-md p-2">
            <X className="size-4" />
          </IconButton>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span
            className={cn(
              'flex items-center gap-1.5 rounded-full px-2 py-0.5',
              status.tone === 'working' && 'bg-warning/15 text-warning',
              status.tone === 'blocked' && 'bg-destructive/15 text-destructive',
              status.tone === 'idle' && 'bg-success/15 text-success',
              status.tone === 'off' && 'bg-muted text-muted-foreground'
            )}
          >
            <span className="size-1.5 rounded-full bg-current" />
            {status.label}
          </span>
          {unread.length > 0 && <span className="text-muted-foreground">{unread.length} 則未讀</span>}
          {unread.length > 1 && running && (
            <button
              type="button"
              disabled={unread.some((m) => sending.has(m.id))}
              onClick={() => void sendNow()}
              className="ml-auto h-7 rounded-md border border-primary/50 px-2.5 text-xs font-medium text-primary outline-none transition-colors motion-reduce:transition-none hover:bg-primary/10 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
            >
              全部立即送出
            </button>
          )}
        </div>
      </header>

      <div ref={listRef} className="flex min-h-[200px] flex-1 flex-col gap-3.5 overflow-y-auto px-4 py-3.5">
        {messages.map((m) => {
          const day = dayLabel(m.sentAt, now)
          const divider = day !== lastDay
          lastDay = day
          const mine = m.sender.kind === 'person'
          const senderName = m.sender.kind === 'person' ? '你' : titleOf(m.sender.id) ?? m.sender.title
          return (
            <div key={m.id} className="contents">
              {divider && <div className="self-center text-[11px] text-muted-foreground">{day}</div>}
              <div className={cn('flex max-w-[340px] flex-col gap-1', mine && 'items-end self-end')}>
                <div className="text-xs text-muted-foreground">
                  <span
                    className={cn(
                      'font-medium',
                      mine ? 'text-primary' : m.sender.kind === 'task' && isMaster(m.sender.id) ? 'text-master' : 'text-foreground'
                    )}
                  >
                    {senderName}
                  </span>{' '}
                  · {clock(m.sentAt)}
                </div>
                <div
                  className={cn(
                    'whitespace-pre-wrap break-words rounded-lg px-3 py-2.5 text-[13px] leading-normal',
                    mine ? 'bg-primary/15' : 'bg-accent',
                    m.state === 'unread' && 'border border-primary/60'
                  )}
                >
                  {m.text}
                </div>
                <MessageStatus
                  message={m}
                  now={now}
                  running={running}
                  sending={sending.has(m.id)}
                  onSendNow={() => void sendNow(m)}
                />
                {refusals[m.id] && (
                  <div className="rounded-md bg-warning/10 px-2.5 py-2 text-xs leading-normal text-warning">{refusals[m.id]}</div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <footer className="flex flex-col gap-2 border-t border-border px-3.5 pb-3.5 pt-3">
        <label htmlFor="message-reply" className="text-xs text-muted-foreground">
          {running ? `以「你」的身分傳給 ${toTitle}` : `${toTitle} 的 agent 沒有在執行，暫時不能傳訊息`}
        </label>
        <div className="flex items-end gap-2">
          <textarea
            id="message-reply"
            ref={inputRef}
            rows={1}
            value={draft}
            disabled={!running || posting}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="輸入訊息，Enter 送出，Shift+Enter 換行"
            className="h-11 min-w-0 flex-1 resize-none rounded-md border border-input bg-background px-3 py-[11px] text-[13px] leading-5 text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
          />
          <button
            type="button"
            aria-label="送出"
            disabled={!running || posting || !draft.trim()}
            onClick={() => void post()}
            className="flex size-11 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground outline-none transition-colors motion-reduce:transition-none hover:bg-primary/90 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
          >
            <SendHorizontal className="size-4" />
          </button>
        </div>
        {postError && <div className="text-xs text-destructive">{postError}</div>}
      </footer>
    </section>
  )
}

function MessageStatus({
  message,
  now,
  running,
  sending,
  onSendNow,
}: {
  message: CardMessage
  now: number
  running: boolean
  sending: boolean
  onSendNow: () => void
}) {
  if (message.state === 'read') {
    return (
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Check className="size-3" strokeWidth={2.5} />
        已讀 · {message.via === 'hook' ? 'hook 帶入' : '打進 terminal'} {message.readAt ? clock(message.readAt) : ''}
      </div>
    )
  }
  if (message.state === 'failed') {
    return <div className="text-[11px] text-destructive">未送達 · {message.error ?? '原因不明'}</div>
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px]">
      <span className="flex items-center gap-1 font-medium text-primary">
        <span className="size-1.5 rounded-full bg-primary" />
        {sending ? '送出中…' : message.inboxName ? `未讀 · 在 inbox 等 ${waited(message.sentAt, now)}` : '未讀 · 等輸入框清空'}
      </span>
      {running && (
        <button
          type="button"
          disabled={sending}
          onClick={onSendNow}
          className="h-[26px] rounded-md bg-primary px-2.5 text-xs font-semibold text-primary-foreground outline-none transition-colors motion-reduce:transition-none hover:bg-primary/90 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:bg-accent disabled:text-muted-foreground"
        >
          立即送進 session
        </button>
      )}
    </div>
  )
}
