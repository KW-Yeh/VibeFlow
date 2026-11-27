import { useState } from 'react'
import { X } from 'lucide-react'

import { IconButton } from '@/components/ui/icon-button'
import type { CardMessageThreadSummary } from '@/lib/types'
import { threadKey } from '@/lib/use-card-messages'
import { cn } from '@/lib/utils'

const MAX_SHOWN = 4

interface MessageBubblesProps {
  bubbles: CardMessageThreadSummary[]
  /** The card open on the workspace page: its conversations sit nearest, marked「這張卡」. */
  focusTaskId?: string | null
  compact?: boolean
  isMaster: (taskId: string) => boolean
  onOpen: (thread: CardMessageThreadSummary) => void
  onDismiss: (thread: CardMessageThreadSummary) => void
}

export function MessageBubbles({ bubbles, focusTaskId, compact, isMaster, onOpen, onDismiss }: MessageBubblesProps) {
  const [expanded, setExpanded] = useState(false)
  if (!bubbles.length) return null

  const touches = (t: CardMessageThreadSummary) => !!focusTaskId && (t.from === focusTaskId || t.to === focusTaskId)
  const mine = bubbles.filter(touches)
  const others = bubbles.filter((t) => !touches(t))
  const ordered = [...mine, ...others]
  const hidden = expanded ? 0 : Math.max(0, ordered.length - MAX_SHOWN)
  const shown = ordered.slice(0, ordered.length - hidden)
  const shownOthers = shown.filter((t) => !touches(t)).reverse()
  const shownMine = shown.filter(touches).reverse()

  const bubble = (t: CardMessageThreadSummary) => (
    <Bubble
      key={threadKey(t)}
      thread={t}
      focus={touches(t)}
      compact={compact}
      master={isMaster(t.from)}
      onOpen={() => onOpen(t)}
      onDismiss={() => onDismiss(t)}
    />
  )

  return (
    <div className={cn('pointer-events-auto flex flex-col gap-2.5', compact ? 'items-end' : 'w-[300px] items-end')}>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="h-8 rounded-full border border-input bg-popover px-3 text-xs text-muted-foreground outline-none transition-colors motion-reduce:transition-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          +{hidden} 則對話
        </button>
      )}
      {expanded && ordered.length > MAX_SHOWN && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="h-8 rounded-full border border-input bg-popover px-3 text-xs text-muted-foreground outline-none transition-colors motion-reduce:transition-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          收合
        </button>
      )}
      {shownOthers.map(bubble)}
      {shownOthers.length > 0 && shownMine.length > 0 && <span className={cn('h-px bg-border', compact ? 'w-8' : 'w-full')} />}
      {shownMine.map(bubble)}
    </div>
  )
}

function Bubble({
  thread,
  focus,
  compact,
  master,
  onOpen,
  onDismiss,
}: {
  thread: CardMessageThreadSummary
  focus: boolean
  compact?: boolean
  master: boolean
  onOpen: () => void
  onDismiss: () => void
}) {
  const unread = thread.unread > 0
  const label = `${thread.fromTitle} → ${thread.toTitle}`
  const dot = unread ? (master ? 'bg-master' : 'bg-primary') : 'bg-muted-foreground'

  if (compact) {
    return (
      <button
        type="button"
        onClick={onOpen}
        aria-label={unread ? `${label}，${thread.unread} 則未讀` : label}
        title={label}
        className={cn(
          'relative flex size-11 items-center justify-center rounded-full border bg-popover shadow-lg outline-none transition-colors motion-reduce:transition-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50',
          unread ? 'border-primary' : 'border-input'
        )}
      >
        <span className={cn('size-2.5 rounded-full', dot)} />
        {unread && <UnreadBadge count={thread.unread} className="absolute -right-1 -top-1" />}
      </button>
    )
  }

  const preview = thread.last.state === 'read' ? `已讀 · ${thread.last.text}` : thread.last.text
  return (
    <div
      className={cn(
        'flex w-full items-center gap-2.5 rounded-xl border py-1 pl-1 pr-2 shadow-lg transition-colors motion-reduce:transition-none',
        unread ? 'border-primary bg-accent' : 'border-input bg-popover'
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={unread ? `${label}，${thread.unread} 則未讀` : label}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-1.5 pl-2.5 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span className={cn('size-2 shrink-0 rounded-full', dot)} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5">
            {focus && (
              <span className="shrink-0 rounded-full bg-primary/15 px-1.5 text-[11px] font-semibold text-primary">這張卡</span>
            )}
            <span className={cn('truncate text-[13px]', unread ? 'font-semibold' : 'font-medium')}>{label}</span>
          </span>
          <span className={cn('truncate text-xs', unread ? 'text-foreground' : 'text-muted-foreground')}>{preview}</span>
        </span>
      </button>
      {unread ? (
        <UnreadBadge count={thread.unread} />
      ) : (
        <IconButton aria-label="收起這則對話" onClick={onDismiss} className="rounded-md">
          <X className="size-3.5" />
        </IconButton>
      )}
    </div>
  )
}

export function UnreadBadge({ count, className }: { count: number; className?: string }) {
  return (
    <span
      className={cn(
        'flex h-[22px] min-w-[22px] shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground',
        className
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}
