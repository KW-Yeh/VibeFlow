import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Bell, X } from 'lucide-react'

import { IconButton } from '@/components/ui/icon-button'
import { MOTION_SPRING, timed } from '@/lib/motion'
import { cn } from '@/lib/utils'

export interface Toast {
  id: string
  taskId: string
  title: string
  body: string
}

/** How long a toast stays before it dismisses itself. */
const TOAST_MS = 6000

/** More toasts than this fold into a stack behind the newest until hovered. */
const STACK_AFTER = 2

/** Stacked toasts deeper than this are hidden behind the visible ones. */
const STACK_DEPTH = 2

function ToastItem({
  toast,
  depth,
  stacked,
  paused,
  onOpen,
  onDismiss,
}: {
  toast: Toast
  /** 0 for the newest; how many toasts are newer than this one. */
  depth: number
  stacked: boolean
  paused: boolean
  onOpen: (taskId: string) => void
  onDismiss: (id: string) => void
}) {
  const reducedMotion = useReducedMotion() ?? false
  // A toast the user is reading must not vanish under the pointer: the clock
  // stops while the stack is hovered or focused and resumes with what was left.
  const remaining = useRef(TOAST_MS)
  useEffect(() => {
    if (paused) return
    const started = Date.now()
    const timer = setTimeout(() => onDismiss(toast.id), remaining.current)
    return () => {
      clearTimeout(timer)
      remaining.current = Math.max(0, remaining.current - (Date.now() - started))
    }
  }, [paused, toast.id, onDismiss])

  const behind = stacked && depth > 0
  const offset = Math.min(depth, STACK_DEPTH)
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={
        behind
          ? {
              opacity: depth > STACK_DEPTH ? 0 : 1 - offset * 0.25,
              y: reducedMotion ? 0 : -offset * 8,
              scale: reducedMotion ? 1 : 1 - offset * 0.05,
            }
          : { opacity: 1, y: 0, scale: 1 }
      }
      exit={{ opacity: 0, y: 8 }}
      transition={{ ...timed('standard', reducedMotion), layout: MOTION_SPRING.layout }}
      style={{ zIndex: 10 - depth }}
      aria-hidden={behind || undefined}
      className={cn(
        'pointer-events-auto flex w-80 items-start gap-2 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg',
        behind && 'absolute bottom-0 right-0 origin-bottom'
      )}
    >
      <Bell className="mt-0.5 size-4 shrink-0 text-primary" />
      <button
        type="button"
        tabIndex={behind ? -1 : undefined}
        onClick={() => {
          onOpen(toast.taskId)
          onDismiss(toast.id)
        }}
        className="min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span className="block truncate text-sm font-medium">{toast.title}</span>
        <span className="block text-sm text-muted-foreground">{toast.body}</span>
      </button>
      <IconButton
        aria-label="關閉通知"
        tabIndex={behind ? -1 : undefined}
        onClick={() => onDismiss(toast.id)}
        className="size-5 p-0.5"
      >
        <X className="size-3.5" />
      </IconButton>
    </motion.li>
  )
}

/**
 * Bottom-right stack of stage notifications; clicking one opens its card.
 * Past a couple of toasts the older ones fold behind the newest, and hovering
 * or focusing the stack fans them back out.
 */
export function NotificationToaster({
  toasts,
  onOpen,
  onDismiss,
}: {
  toasts: Toast[]
  onOpen: (taskId: string) => void
  onDismiss: (id: string) => void
}) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const expanded = hovered || focused
  const stacked = toasts.length > STACK_AFTER && !expanded

  useEffect(() => {
    if (toasts.length === 0) {
      setHovered(false)
      setFocused(false)
    }
  }, [toasts.length])

  return (
    <ol
      aria-live="polite"
      aria-label="通知"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false)
      }}
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast, index) => (
          <ToastItem
            key={toast.id}
            toast={toast}
            depth={toasts.length - 1 - index}
            stacked={stacked}
            paused={expanded}
            onOpen={onOpen}
            onDismiss={onDismiss}
          />
        ))}
      </AnimatePresence>
    </ol>
  )
}
