import { useLayoutEffect, useRef } from 'react'
import { animate, motion, useMotionValue, useReducedMotion, type AnimationPlaybackControls } from 'motion/react'

import { MOTION_SPRING } from '@/lib/motion'
import { cn } from '@/lib/utils'

export type BoardView = 'board' | 'workspace' | 'github' | 'terminals'

const VIEWS: { id: BoardView; label: string }[] = [
  { id: 'board', label: '看板' },
  { id: 'workspace', label: '工作區' },
  { id: 'github', label: '工作項目' },
  { id: 'terminals', label: '終端機' },
]

/**
 * Where the underline last stood. Every page draws its own copy of these tabs
 * and a switch shows a different copy, so the copy coming into view starts its
 * underline from here — that is what makes it glide instead of jump.
 */
let lastIndicator: { left: number; width: number } | null = null

/** The「看板 ｜ 工作區 ｜ 工作項目 ｜ 終端機」switch heading every page. */
export function ViewTabs({
  value,
  onChange,
}: {
  value: BoardView
  onChange: (next: BoardView) => void
}) {
  const reducedMotion = useReducedMotion() ?? false
  const listRef = useRef<HTMLDivElement>(null)
  const x = useMotionValue(0)
  const width = useMotionValue(0)

  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    const measure = () => {
      const tab = list.querySelector<HTMLElement>('[aria-selected="true"]')
      return tab ? { left: tab.offsetLeft, width: tab.offsetWidth } : null
    }
    // A hidden page's copy has no layout; it is placed when its page shows.
    if (list.offsetParent === null) return
    const target = measure()
    if (!target) return
    const from = lastIndicator
    lastIndicator = target
    const moves: AnimationPlaybackControls[] = []
    if (!reducedMotion && from && (from.left !== target.left || from.width !== target.width)) {
      x.jump(from.left)
      width.jump(from.width)
      moves.push(animate(x, target.left, MOTION_SPRING.indicator), animate(width, target.width, MOTION_SPRING.indicator))
    } else {
      x.jump(target.left)
      width.jump(target.width)
    }

    // Tab widths can still change (late web font); keep the line under the tab.
    let listWidth = list.offsetWidth
    const observer = new ResizeObserver(() => {
      if (list.offsetParent === null || list.offsetWidth === listWidth) return
      listWidth = list.offsetWidth
      const next = measure()
      if (!next) return
      lastIndicator = next
      x.jump(next.left)
      width.jump(next.width)
    })
    observer.observe(list)
    return () => {
      moves.forEach((move) => move.stop())
      observer.disconnect()
    }
  }, [value, reducedMotion, x, width])

  return (
    <div ref={listRef} role="tablist" aria-label="檢視" className="relative flex h-full items-stretch gap-4">
      {VIEWS.map((view) => {
        const active = view.id === value
        return (
          <button
            key={view.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(view.id)}
            className={cn(
              'flex items-center px-1 text-sm font-medium outline-none transition-colors motion-reduce:transition-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {view.label}
          </button>
        )
      })}
      <motion.span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-px left-0 h-0.5 rounded-full bg-primary"
        style={{ x, width }}
      />
    </div>
  )
}
