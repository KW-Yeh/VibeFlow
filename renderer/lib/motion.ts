import type { Transition, Variants } from 'motion/react'

export const MOTION_DURATION = {
  micro: 0.12,
  standard: 0.16,
  spatial: 0.18,
} as const

export const MOTION_EASING = {
  enter: [0.2, 0, 0, 1],
  exit: [0.4, 0, 1, 1],
} as const

export type MotionTiming = keyof typeof MOTION_DURATION

interface MotionTransform {
  x?: number
  y?: number
  scale?: number
}

interface EnterVariantsOptions {
  timing: MotionTiming
  enterDuration?: number
  initialOpacity?: number
  transform?: MotionTransform
  reducedMotion: boolean
}

interface PresenceVariantsOptions extends EnterVariantsOptions {
  exitTiming?: MotionTiming
  exitDuration?: number
  exitTransform?: MotionTransform
}

const REDUCED_MOTION_DURATION = 0.01

function transition(
  timing: MotionTiming,
  reducedMotion: boolean,
  phase: keyof typeof MOTION_EASING,
  duration: number = MOTION_DURATION[timing]
): Transition {
  return {
    duration: reducedMotion ? REDUCED_MOTION_DURATION : duration,
    ease: MOTION_EASING[phase],
  }
}

function transformTarget(
  transform: MotionTransform | undefined,
  reducedMotion: boolean
): MotionTransform {
  return reducedMotion ? {} : (transform ?? {})
}

function settledTransform(transform: MotionTransform | undefined): MotionTransform {
  return {
    ...(transform?.x === undefined ? {} : { x: 0 }),
    ...(transform?.y === undefined ? {} : { y: 0 }),
    ...(transform?.scale === undefined ? {} : { scale: 1 }),
  }
}

export function createEnterVariants({
  timing,
  enterDuration,
  initialOpacity = 0,
  transform,
  reducedMotion,
}: EnterVariantsOptions): Variants {
  return {
    hidden: {
      opacity: initialOpacity,
      ...transformTarget(transform, reducedMotion),
    },
    visible: {
      opacity: 1,
      ...(reducedMotion ? {} : settledTransform(transform)),
      transition: transition(timing, reducedMotion, 'enter', enterDuration),
    },
  }
}

export function createPresenceVariants({
  timing,
  enterDuration,
  initialOpacity,
  exitTiming = 'micro',
  exitDuration,
  transform,
  exitTransform = transform,
  reducedMotion,
}: PresenceVariantsOptions): Variants {
  return {
    ...createEnterVariants({
      timing,
      enterDuration,
      initialOpacity,
      transform,
      reducedMotion,
    }),
    exit: {
      opacity: 0,
      ...transformTarget(exitTransform, reducedMotion),
      transition: transition(exitTiming, reducedMotion, 'exit', exitDuration),
    },
  }
}

/**
 * Springs for things that travel (a card between columns, a tab indicator) and
 * for values that settle (numbers, progress). Kept here so every spring in the
 * app shares one feel.
 */
export const MOTION_SPRING = {
  layout: { type: 'spring', stiffness: 520, damping: 42, mass: 0.9 },
  indicator: { type: 'spring', stiffness: 650, damping: 46 },
  value: { stiffness: 140, damping: 24 },
} as const satisfies Record<string, Transition | { stiffness: number; damping: number }>

/** How long a destructive control must be held before it fires. */
export const HOLD_TO_CONFIRM_MS = 1200

/** How long a copy button shows its check mark. */
export const COPIED_FEEDBACK_MS = 1500

/** Transition for one timing token, collapsing to an instant change under reduced motion. */
export function timed(
  timing: MotionTiming,
  reducedMotion: boolean,
  phase: keyof typeof MOTION_EASING = 'enter'
): Transition {
  return transition(timing, reducedMotion, phase)
}
