import { useEffect } from 'react'
import { motion, useReducedMotion, useSpring, useTransform } from 'motion/react'

import { MOTION_SPRING } from '@/lib/motion'

/**
 * A number that rolls to its new value instead of jumping, so a live counter
 * reads as growth rather than flicker. It starts at its value (no count-up on
 * mount) and only moves when the value changes afterwards.
 */
export function AnimatedNumber({
  value,
  format = (n) => n.toLocaleString(),
  className,
  title,
}: {
  value: number
  format?: (n: number) => string
  className?: string
  title?: string
}) {
  const reducedMotion = useReducedMotion() ?? false
  const spring = useSpring(value, MOTION_SPRING.value)
  const text = useTransform(spring, (v) => format(Math.round(v)))

  useEffect(() => {
    if (reducedMotion) spring.jump(value)
    else spring.set(value)
  }, [reducedMotion, spring, value])

  return (
    <motion.span className={className} title={title}>
      {text}
    </motion.span>
  )
}
