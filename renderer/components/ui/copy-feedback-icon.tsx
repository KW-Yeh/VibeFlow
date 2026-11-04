import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Check, Copy, type LucideIcon } from 'lucide-react'

import { createPresenceVariants } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * A copy control's icon: it turns into a check once the copy lands, so the
 * copy is confirmed where the user is looking, without a toast.
 */
export function CopyFeedbackIcon({
  copied,
  icon: Icon = Copy,
  className = 'size-3.5',
}: {
  copied: boolean
  icon?: LucideIcon
  className?: string
}) {
  const reducedMotion = useReducedMotion() ?? false
  const variants = createPresenceVariants({ timing: 'micro', transform: { scale: 0.5 }, reducedMotion })
  return (
    <span className={cn('relative flex shrink-0', className)}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={copied ? 'copied' : 'copy'}
          variants={variants}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="flex size-full"
        >
          {copied ? <Check className="size-full text-primary" /> : <Icon className="size-full" />}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}
