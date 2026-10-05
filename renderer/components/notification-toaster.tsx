import { useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Bell, X } from 'lucide-react'

import { IconButton } from '@/components/ui/icon-button'

export interface Toast {
  id: string
  taskId: string
  title: string
  body: string
}

/** How long a toast stays before it dismisses itself. */
const TOAST_MS = 6000

function ToastItem({
  toast,
  onOpen,
  onDismiss,
}: {
  toast: Toast
  onOpen: (taskId: string) => void
  onDismiss: (id: string) => void
}) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), TOAST_MS)
    return () => clearTimeout(timer)
  }, [toast.id, onDismiss])

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.15 }}
      className="pointer-events-auto flex w-80 items-start gap-2 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg"
    >
      <Bell className="mt-0.5 size-4 shrink-0 text-primary" />
      <button
        type="button"
        onClick={() => {
          onOpen(toast.taskId)
          onDismiss(toast.id)
        }}
        className="min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span className="block truncate text-sm font-medium">{toast.title}</span>
        <span className="block text-sm text-muted-foreground">{toast.body}</span>
      </button>
      <IconButton aria-label="關閉通知" onClick={() => onDismiss(toast.id)} className="size-5 p-0.5">
        <X className="size-3.5" />
      </IconButton>
    </motion.li>
  )
}

/** Bottom-right stack of stage notifications; clicking one opens its card. */
export function NotificationToaster({
  toasts,
  onOpen,
  onDismiss,
}: {
  toasts: Toast[]
  onOpen: (taskId: string) => void
  onDismiss: (id: string) => void
}) {
  return (
    <ol
      aria-live="polite"
      aria-label="通知"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onOpen={onOpen} onDismiss={onDismiss} />
        ))}
      </AnimatePresence>
    </ol>
  )
}
