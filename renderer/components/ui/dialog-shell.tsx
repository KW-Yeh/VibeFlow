import { X } from 'lucide-react'
import { motion, useIsPresent, useReducedMotion } from 'motion/react'
import { useEffect, useId, useRef } from 'react'

import { IconButton } from '@/components/ui/icon-button'
import { createPresenceVariants } from '@/lib/motion'
import { cn } from '@/lib/utils'

interface DialogShellProps {
  title: string
  children: React.ReactNode
  description?: React.ReactNode
  footer?: React.ReactNode
  showHeader?: boolean
  className?: string
  contentClassName?: string
  bodyClassName?: string
  saving?: boolean
  motionVariant?: 'dialog' | 'drawer'
  onClose: () => void
}

export function DialogShell({
  title,
  children,
  description,
  footer,
  showHeader = false,
  className,
  contentClassName,
  bodyClassName,
  saving = false,
  motionVariant = 'dialog',
  onClose,
}: DialogShellProps) {
  const titleId = useId()
  const descriptionId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const previouslyFocusedRef = useRef<HTMLElement | null>(
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  )
  const onCloseRef = useRef(onClose)
  const savingRef = useRef(saving)
  const isPresent = useIsPresent()
  const reducedMotion = useReducedMotion() ?? false
  const structured = showHeader || description !== undefined || footer !== undefined || bodyClassName !== undefined
  const isDrawer = motionVariant === 'drawer'
  const backdropVariants = createPresenceVariants({
    timing: 'micro',
    enterDuration: 0.14,
    reducedMotion,
  })
  const panelVariants = createPresenceVariants({
    timing: isDrawer ? 'spatial' : 'standard',
    exitTiming: 'micro',
    exitDuration: isDrawer ? 0.14 : undefined,
    transform: isDrawer ? { x: 16 } : { scale: 0.98 },
    reducedMotion,
  })

  useEffect(() => {
    onCloseRef.current = onClose
    savingRef.current = saving
  }, [onClose, saving])

  useEffect(() => {
    if (!isPresent) return
    panelRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || savingRef.current) return
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]')
      if (dialogs[dialogs.length - 1] !== panelRef.current) return
      onCloseRef.current()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previouslyFocusedRef.current?.focus()
    }
  }, [isPresent])

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      exit="exit"
      inert={!isPresent}
      aria-hidden={!isPresent || undefined}
      data-dialog-state={isPresent ? 'present' : 'exiting'}
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center p-4',
        !isPresent && 'pointer-events-none',
        className
      )}
    >
      <motion.div
        variants={backdropVariants}
        className="absolute inset-0 bg-background/80"
        onClick={saving || !isPresent ? undefined : onClose}
      />
      <motion.div
        variants={panelVariants}
        ref={panelRef}
        role={isPresent ? 'dialog' : undefined}
        aria-modal={isPresent ? 'true' : undefined}
        aria-labelledby={isPresent ? titleId : undefined}
        aria-describedby={isPresent && description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          'relative z-10 w-full rounded-lg border bg-card text-card-foreground shadow-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
          structured && 'flex max-h-[min(90vh,760px)] flex-col overflow-hidden',
          contentClassName
        )}
      >
        {structured ? (
          <>
            {showHeader && (
              <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border/70 px-5 py-4">
                <div className="min-w-0 space-y-1">
                  <h2 id={titleId} className="truncate text-lg font-semibold tracking-tight">
                    {title}
                  </h2>
                  {description && (
                    <div id={descriptionId} className="text-sm leading-5 text-muted-foreground">
                      {description}
                    </div>
                  )}
                </div>
                <IconButton
                  aria-label={`關閉${title}`}
                  onClick={onClose}
                  disabled={saving}
                  className="mt-0.5 shrink-0 p-1"
                >
                  <X className="size-4" />
                </IconButton>
              </div>
            )}
            {!showHeader && (
              <h2 id={titleId} className="sr-only">
                {title}
              </h2>
            )}
            <div className={cn('min-h-0 flex-1 overflow-y-auto px-5 py-4', bodyClassName)}>
              {children}
            </div>
            {footer && (
              <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border/70 bg-muted/20 px-5 py-3">
                {footer}
              </div>
            )}
          </>
        ) : (
          <>
            <h2 id={titleId} className="sr-only">
              {title}
            </h2>
            {children}
          </>
        )}
      </motion.div>
    </motion.div>
  )
}
