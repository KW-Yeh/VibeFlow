import { motion } from 'motion/react'

import { MOTION_SPRING } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * The selected tab's marker. Rendered inside the active tab only; tabs that
 * share a `layoutId` (and a `LayoutGroup`) see it glide from the old tab to the
 * new one, so the eye follows the switch.
 */
export function TabIndicator({ layoutId, className }: { layoutId: string; className?: string }) {
  return (
    <motion.span
      aria-hidden="true"
      layoutId={layoutId}
      transition={MOTION_SPRING.indicator}
      className={cn('pointer-events-none absolute', className)}
    />
  )
}
