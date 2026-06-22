import { useEffect, useId, useRef } from 'react'

import { cn } from '@/lib/utils'

interface DialogShellProps {
  title: string
  children: React.ReactNode
  className?: string
  contentClassName?: string
  saving?: boolean
  onClose: () => void
}

export function DialogShell({
  title,
  children,
  className,
  contentClassName,
  saving = false,
  onClose,
}: DialogShellProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    panelRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus()
    }
  }, [onClose, saving])

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
        tabIndex={-1}
        className={cn(
          'relative z-10 w-full rounded-lg border bg-card text-card-foreground shadow-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
          contentClassName
        )}
      >
        <h2 id={titleId} className="sr-only">
          {title}
        </h2>
        {children}
      </div>
    </div>
  )
}
