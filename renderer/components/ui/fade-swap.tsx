import type { ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

import { createPresenceVariants } from '@/lib/motion'

/**
 * Cross-fades when `phase` changes (loading → content → error), so content
 * arrives instead of popping in. Key it by phase, never by data: a refresh
 * that keeps the same phase must not fade, or every background poll flashes.
 */
export function FadeSwap({
  phase,
  className,
  children,
}: {
  phase: string
  className?: string
  children: ReactNode
}) {
  const reducedMotion = useReducedMotion() ?? false
  const variants = createPresenceVariants({ timing: 'standard', reducedMotion })
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={phase} variants={variants} initial="hidden" animate="visible" exit="exit" className={className}>
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
