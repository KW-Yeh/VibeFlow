import { ZoomIn, ZoomOut } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

const MIN_SCALE = 1
const MAX_SCALE = 6
/** Wheel delta → scale factor; one notch (~100px) is roughly a 16% step. */
const WHEEL_SENSITIVITY = 0.0015

interface View {
  scale: number
  x: number
  y: number
}

const IDENTITY: View = { scale: MIN_SCALE, x: 0, y: 0 }

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Image viewer with a zoom slider, cursor-anchored wheel zoom, and drag-to-pan.
 *
 * The transform is `translate(x, y) scale(s)` about the element centre, so pan
 * offsets are measured from the centre and the reachable range at a given scale
 * is ±(scaledSize − viewportSize)/2 — clamped so a zoomed image can never be
 * dragged past its own edges.
 */
export function ZoomableImage({
  src,
  alt,
  className,
}: {
  src: string
  alt: string
  className?: string
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)
  const [view, setView] = useState<View>(IDENTITY)
  const [dragging, setDragging] = useState(false)

  /** Layout size of the contained image is transform-independent, so it is the pan basis. */
  const clampOffset = useCallback((x: number, y: number, scale: number) => {
    const viewport = viewportRef.current
    const img = imgRef.current
    if (!viewport || !img) return { x, y }
    const maxX = Math.max(0, (img.offsetWidth * scale - viewport.clientWidth) / 2)
    const maxY = Math.max(0, (img.offsetHeight * scale - viewport.clientHeight) / 2)
    return { x: clamp(x, -maxX, maxX), y: clamp(y, -maxY, maxY) }
  }, [])

  /** Zoom keeping `anchor` (centre-relative viewport coords) pinned under the cursor. */
  const zoom = useCallback(
    (next: (current: number) => number, anchorX = 0, anchorY = 0) => {
      setView((v) => {
        const scale = clamp(next(v.scale), MIN_SCALE, MAX_SCALE)
        if (scale === v.scale) return v
        return {
          scale,
          ...clampOffset(
            anchorX - ((anchorX - v.x) * scale) / v.scale,
            anchorY - ((anchorY - v.y) * scale) / v.scale,
            scale
          ),
        }
      })
    },
    [clampOffset]
  )

  useEffect(() => {
    setView(IDENTITY)
  }, [src])

  // React attaches wheel at the root as passive, so preventDefault (stopping the
  // dialog body from scrolling while zooming) needs a listener of our own.
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = viewport.getBoundingClientRect()
      zoom(
        (current) => current * Math.exp(-event.deltaY * WHEEL_SENSITIVITY),
        event.clientX - rect.left - rect.width / 2,
        event.clientY - rect.top - rect.height / 2
      )
    }
    viewport.addEventListener('wheel', onWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', onWheel)
  }, [zoom])

  // A resize shrinks the reachable range, which would otherwise strand the
  // image off-centre until the next drag.
  useEffect(() => {
    const onResize = () => setView((v) => ({ ...v, ...clampOffset(v.x, v.y, v.scale) }))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [clampOffset])

  const pannable = view.scale > MIN_SCALE

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pannable || event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: view.x,
      originY: view.y,
    }
    setDragging(true)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const x = drag.originX + (event.clientX - drag.startX)
    const y = drag.originY + (event.clientY - drag.startY)
    setView((v) => ({ ...v, ...clampOffset(x, y, v.scale) }))
  }

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    setDragging(false)
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={cn(
          'flex h-[min(60vh,520px)] touch-none select-none items-center justify-center overflow-hidden rounded-md bg-muted/20',
          pannable && (dragging ? 'cursor-grabbing' : 'cursor-grab')
        )}
      >
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          draggable={false}
          className="max-h-full max-w-full object-contain"
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          }}
        />
      </div>
      <div className="flex items-center gap-3 px-1">
        <ZoomOut className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          type="range"
          min={MIN_SCALE}
          max={MAX_SCALE}
          step={0.05}
          value={view.scale}
          onChange={(event) => {
            const target = Number(event.target.value)
            zoom(() => target)
          }}
          aria-label="縮放圖片"
          className="h-4 min-w-0 flex-1 cursor-pointer accent-primary outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        <ZoomIn className="size-3.5 shrink-0 text-muted-foreground" />
      </div>
      <p className="px-1 text-xs text-muted-foreground">
        滑桿或滾輪縮放，放大後可拖曳圖片平移。
      </p>
    </div>
  )
}
