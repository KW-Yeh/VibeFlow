import { useRef, useState } from 'react'
import ReactCrop, {
  centerCrop,
  convertToPixelCrop,
  makeAspectCrop,
  type Crop,
  type PixelCrop,
} from 'react-image-crop'

import { Button } from '@/components/ui/button'
import { DialogShell } from '@/components/ui/dialog-shell'

/** Output avatar size — kept small so the stored data URL stays compact. */
const OUTPUT_SIZE = 128

interface AvatarCropDialogProps {
  src: string
  onCancel: () => void
  onApply: (dataUrl: string) => void
}

function centerSquareCrop(width: number, height: number): PixelCrop {
  const size = Math.min(width, height)
  return { unit: 'px', width: size, height: size, x: (width - size) / 2, y: (height - size) / 2 }
}

/**
 * Circular crop editor built on react-image-crop. "套用" always produces an
 * output — a completed crop is used when available, otherwise it falls back
 * to a center square of the whole image, so the button is never blocked on
 * crop interaction succeeding.
 */
export function AvatarCropDialog({ src, onCancel, onApply }: AvatarCropDialogProps) {
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [crop, setCrop] = useState<Crop>()
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>()

  const onImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const { width, height } = e.currentTarget
    const nextCrop = centerCrop(makeAspectCrop({ unit: '%', width: 90 }, 1, width, height), width, height)
    setCrop(nextCrop)
    setCompletedCrop(convertToPixelCrop(nextCrop, width, height))
  }

  const handleApply = () => {
    const img = imgRef.current
    const canvas = document.createElement('canvas')
    canvas.width = OUTPUT_SIZE
    canvas.height = OUTPUT_SIZE
    const ctx = canvas.getContext('2d')
    if (!img || !ctx || !img.naturalWidth) {
      onApply(src)
      return
    }
    const crop =
      completedCrop && completedCrop.width > 0 && completedCrop.height > 0
        ? completedCrop
        : centerSquareCrop(img.width, img.height)
    const scaleX = img.naturalWidth / img.width
    const scaleY = img.naturalHeight / img.height
    ctx.drawImage(
      img,
      crop.x * scaleX,
      crop.y * scaleY,
      crop.width * scaleX,
      crop.height * scaleY,
      0,
      0,
      OUTPUT_SIZE,
      OUTPUT_SIZE
    )
    onApply(canvas.toDataURL('image/jpeg', 0.85))
  }

  return (
    <DialogShell
      title="裁切頭像"
      description="拖曳調整裁切範圍，套用會輸出圓形範圍內的圖片。"
      showHeader
      onClose={onCancel}
      contentClassName="max-w-sm"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            取消
          </Button>
          <Button size="sm" onClick={handleApply}>
            套用
          </Button>
        </>
      }
    >
      <div className="flex justify-center">
        <ReactCrop
          crop={crop}
          onChange={(_, percentCrop) => setCrop(percentCrop)}
          onComplete={(pixelCrop) => setCompletedCrop(pixelCrop)}
          aspect={1}
          circularCrop
          keepSelection
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- local blob/data URL, not an optimizable remote asset */}
          <img
            ref={imgRef}
            src={src}
            alt="裁切預覽"
            onLoad={onImageLoad}
            style={{ maxHeight: 320, maxWidth: '100%' }}
          />
        </ReactCrop>
      </div>
    </DialogShell>
  )
}
