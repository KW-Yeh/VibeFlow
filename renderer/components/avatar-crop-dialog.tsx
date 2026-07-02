import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { DialogShell } from '@/components/ui/dialog-shell'

/** Circular crop viewport diameter in CSS px. */
const VIEWPORT_SIZE = 240
/** Output avatar size — kept small so the stored data URL stays compact. */
const OUTPUT_SIZE = 128

interface AvatarCropDialogProps {
  src: string
  onCancel: () => void
  onApply: (dataUrl: string) => void
}

/**
 * Circular crop editor: drag to pan, slider to zoom, "套用" renders the
 * currently visible circle to a fixed-size JPEG data URL via canvas.
 */
export function AvatarCropDialog({ src, onCancel, onApply }: AvatarCropDialogProps) {
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{ startX: number; startY: number; origin: { x: number; y: number } } | null>(null)

  useEffect(() => {
    setZoom(1)
    setOffset({ x: 0, y: 0 })
    setNaturalSize(null)
  }, [src])

  // Base scale: smallest zoom that still covers the circular viewport.
  const baseScale = naturalSize
    ? VIEWPORT_SIZE / Math.min(naturalSize.w, naturalSize.h)
    : 1
  const scale = baseScale * zoom
  const displayW = naturalSize ? naturalSize.w * scale : VIEWPORT_SIZE
  const displayH = naturalSize ? naturalSize.h * scale : VIEWPORT_SIZE

  const clampOffset = (x: number, y: number) => {
    const maxX = Math.max(0, (displayW - VIEWPORT_SIZE) / 2)
    const maxY = Math.max(0, (displayH - VIEWPORT_SIZE) / 2)
    return {
      x: Math.min(maxX, Math.max(-maxX, x)),
      y: Math.min(maxY, Math.max(-maxY, y)),
    }
  }

  const handlePointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { startX: e.clientX, startY: e.clientY, origin: offset }
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    setOffset(
      clampOffset(
        drag.origin.x + (e.clientX - drag.startX),
        drag.origin.y + (e.clientY - drag.startY)
      )
    )
  }

  const handlePointerUp = () => {
    dragRef.current = null
  }

  const handleZoomChange = (nextZoom: number) => {
    setZoom(nextZoom)
    setOffset((o) => clampOffset(o.x, o.y))
  }

  const handleApply = () => {
    const img = imgRef.current
    if (!img || !naturalSize) return
    const canvas = document.createElement('canvas')
    canvas.width = OUTPUT_SIZE
    canvas.height = OUTPUT_SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // Map the visible viewport circle back to source-image pixel coordinates.
    const srcSize = VIEWPORT_SIZE / scale
    const srcX = naturalSize.w / 2 - offset.x / scale - srcSize / 2
    const srcY = naturalSize.h / 2 - offset.y / scale - srcSize / 2
    ctx.drawImage(img, srcX, srcY, srcSize, srcSize, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE)
    onApply(canvas.toDataURL('image/jpeg', 0.85))
  }

  return (
    <DialogShell
      title="裁切頭像"
      description="拖曳圖片調整位置，使用下方滑桿縮放。"
      showHeader
      onClose={onCancel}
      contentClassName="max-w-sm"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            取消
          </Button>
          <Button size="sm" onClick={handleApply} disabled={!naturalSize}>
            套用
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-4">
        <div
          className="relative overflow-hidden rounded-full border border-border/60 bg-muted/40 touch-none"
          style={{ width: VIEWPORT_SIZE, height: VIEWPORT_SIZE, cursor: naturalSize ? 'grab' : 'default' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          <img
            ref={imgRef}
            src={src}
            alt="裁切預覽"
            draggable={false}
            onLoad={(e) => {
              const el = e.currentTarget
              setNaturalSize({ w: el.naturalWidth, h: el.naturalHeight })
            }}
            className="absolute left-1/2 top-1/2 max-w-none select-none"
            style={{
              width: displayW,
              height: displayH,
              transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)`,
            }}
          />
        </div>
        <input
          type="range"
          min={1}
          max={3}
          step={0.01}
          value={zoom}
          onChange={(e) => handleZoomChange(Number(e.target.value))}
          disabled={!naturalSize}
          className="w-full"
          aria-label="縮放"
        />
      </div>
    </DialogShell>
  )
}
