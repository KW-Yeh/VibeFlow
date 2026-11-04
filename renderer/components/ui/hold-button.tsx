import * as React from 'react'
import { animate, motion, useMotionValue, type AnimationPlaybackControls } from 'motion/react'

import { HOLD_TO_CONFIRM_MS, MOTION_DURATION } from '@/lib/motion'
import { cn } from '@/lib/utils'

export interface HoldButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'type'> {
  /** Fires once the control has been held for `holdMs`; a shorter press does nothing. */
  onConfirm: () => void
  holdMs?: number
  /** Classes for the fill that grows while the control is held. */
  fillClassName?: string
}

/**
 * The confirmation for an action that cannot be undone: it only fires after
 * being held, so a stray click never destroys work, and the growing fill shows
 * how far the user is from committing. Space and Enter can be held too.
 */
export const HoldButton = React.forwardRef<HTMLButtonElement, HoldButtonProps>(
  (
    {
      onConfirm,
      holdMs = HOLD_TO_CONFIRM_MS,
      fillClassName = 'bg-destructive/25',
      className,
      children,
      disabled,
      onPointerDown,
      onPointerUp,
      onPointerLeave,
      onPointerCancel,
      onKeyDown,
      onKeyUp,
      onBlur,
      ...props
    },
    ref
  ) => {
    const progress = useMotionValue(0)
    const controls = React.useRef<AnimationPlaybackControls | null>(null)
    const confirmRef = React.useRef(onConfirm)
    confirmRef.current = onConfirm

    const start = () => {
      if (disabled) return
      controls.current?.stop()
      controls.current = animate(progress, 1, {
        duration: (holdMs / 1000) * (1 - progress.get()),
        ease: 'linear',
        onComplete: () => {
          controls.current = null
          progress.jump(0)
          confirmRef.current()
        },
      })
    }

    const cancel = () => {
      if (!controls.current) return
      controls.current.stop()
      controls.current = null
      animate(progress, 0, { duration: MOTION_DURATION.standard })
    }

    React.useEffect(() => () => controls.current?.stop(), [])

    return (
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        className={cn(
          'relative isolate overflow-hidden outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
          className
        )}
        onPointerDown={(event) => {
          onPointerDown?.(event)
          if (event.button === 0) start()
        }}
        onPointerUp={(event) => {
          onPointerUp?.(event)
          cancel()
        }}
        onPointerLeave={(event) => {
          onPointerLeave?.(event)
          cancel()
        }}
        onPointerCancel={(event) => {
          onPointerCancel?.(event)
          cancel()
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event)
          if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
            event.preventDefault()
            start()
          }
        }}
        onKeyUp={(event) => {
          onKeyUp?.(event)
          if (event.key === ' ' || event.key === 'Enter') cancel()
        }}
        onBlur={(event) => {
          onBlur?.(event)
          cancel()
        }}
        onContextMenu={(event) => event.preventDefault()}
        {...props}
      >
        <motion.span
          aria-hidden="true"
          className={cn('pointer-events-none absolute inset-0 -z-10 origin-left', fillClassName)}
          style={{ scaleX: progress }}
        />
        {children}
      </button>
    )
  }
)

HoldButton.displayName = 'HoldButton'
