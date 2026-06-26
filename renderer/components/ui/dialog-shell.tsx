import { X } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'

import { IconButton } from '@/components/ui/icon-button'
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
  onClose,
}: DialogShellProps) {
  const titleId = useId()
  const descriptionId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  const savingRef = useRef(saving)
  const structured = showHeader || description !== undefined || footer !== undefined || bodyClassName !== undefined

  useEffect(() => {
    onCloseRef.current = onClose
    savingRef.current = saving
  }, [onClose, saving])

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    panelRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !savingRef.current) onCloseRef.current()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus()
    }
  }, [])

  return (
    <div className={cn('fixed inset-0 z-50 flex items-center justify-center p-4', className)}>
      <div
        className="absolute inset-0 bg-black/60"
        onClick={saving ? undefined : onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
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
                  <h2 id={titleId} className="truncate text-base font-semibold">
                    {title}
                  </h2>
                  {description && (
                    <div id={descriptionId} className="text-xs leading-5 text-muted-foreground">
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
      </div>
    </div>
  )
}
