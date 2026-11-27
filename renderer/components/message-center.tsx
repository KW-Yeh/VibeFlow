import { useEffect, useRef, useState } from 'react'
import { MessageSquare } from 'lucide-react'

import { UnreadBadge } from '@/components/message-bubbles'
import type { CardMessageThreadSummary } from '@/lib/types'
import { threadKey, type ThreadKey } from '@/lib/use-card-messages'
import { cn } from '@/lib/utils'

interface MessageCenterProps {
  threads: CardMessageThreadSummary[]
  totalUnread: number
  onOpen: (key: ThreadKey) => void
}

export function MessageCenter({ threads, totalUnread, onOpen }: MessageCenterProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={totalUnread ? `訊息，${totalUnread} 則未讀` : '訊息'}
        aria-expanded={open}
        title="訊息"
        onClick={() => setOpen((v) => !v)}
        className="relative flex size-8 items-center justify-center rounded-md border border-input bg-card text-foreground outline-none transition-colors motion-reduce:transition-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <MessageSquare className="size-4" />
        {totalUnread > 0 && <UnreadBadge count={totalUnread} className="absolute -right-2 -top-2 h-[18px] min-w-[18px] px-1 text-[11px]" />}
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-50 flex max-h-[420px] w-[320px] flex-col overflow-y-auto rounded-lg border border-input bg-popover p-1.5 shadow-2xl">
          {threads.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">還沒有卡片之間的訊息。</div>
          ) : (
            threads.map((t) => (
              <button
                key={threadKey(t)}
                type="button"
                onClick={() => {
                  setOpen(false)
                  onOpen({ from: t.from, to: t.to })
                }}
                className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left outline-none transition-colors motion-reduce:transition-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className={cn('truncate text-[13px]', t.unread ? 'font-semibold' : 'font-medium')}>
                    {t.fromTitle} → {t.toTitle}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{t.last.text}</span>
                </span>
                {t.unread > 0 && <UnreadBadge count={t.unread} />}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
