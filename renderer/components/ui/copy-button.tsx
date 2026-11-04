import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Check, Copy } from 'lucide-react'

import { IconButton, type IconButtonProps } from '@/components/ui/icon-button'
import { COPIED_FEEDBACK_MS, createPresenceVariants } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * Copies text and answers in place: the icon turns into a check for a moment,
 * so the copy is confirmed where the user is looking, without a toast.
 */
export function CopyButton({
  text,
  iconClassName = 'size-3.5',
  onClick,
  ...props
}: Omit<IconButtonProps, 'children'> & {
  text: string | (() => string | Promise<string>)
  iconClassName?: string
}) {
  const reducedMotion = useReducedMotion() ?? false
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const variants = createPresenceVariants({
    timing: 'micro',
    transform: { scale: 0.6 },
    reducedMotion,
  })

  return (
    <IconButton
      {...props}
      onClick={async (event) => {
        onClick?.(event)
        try {
          const value = typeof text === 'function' ? await text() : text
          await navigator.clipboard.writeText(value)
        } catch {
          return
        }
        setCopied(true)
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS)
      }}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={copied ? 'copied' : 'copy'}
          variants={variants}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="flex"
        >
          {copied ? (
            <Check className={cn(iconClassName, 'text-primary')} />
          ) : (
            <Copy className={iconClassName} />
          )}
        </motion.span>
      </AnimatePresence>
      <span className="sr-only" aria-live="polite">{copied ? '已複製' : ''}</span>
    </IconButton>
  )
}
