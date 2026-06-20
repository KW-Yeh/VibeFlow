import { useEffect, useState } from 'react'
import { Smartphone, X, Copy, Check, Wifi } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Update this URL once you deploy VibeFlow-remote to Vercel.
const REMOTE_APP_BASE_URL = 'https://vibe-flow-remote.vercel.app'

interface Props {
  roomCode: string
  peerCount: number
  onStop: () => void
}

export function RemoteShareDialog({ roomCode, peerCount, onStop }: Props) {
  const url = `${REMOTE_APP_BASE_URL}/?room=${roomCode}`
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let active = true
    import('qrcode').then(({ default: QRCode }) => {
      QRCode.toDataURL(url, { width: 240, margin: 2 }).then(dataUrl => {
        if (active) setQrDataUrl(dataUrl)
      })
    })
    return () => { active = false }
  }, [url])

  function handleCopy() {
    void navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onStop} />
      <div className="relative z-10 w-full max-w-xs rounded-lg border bg-card p-5 text-card-foreground shadow-lg">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Smartphone className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">遠端控制</h2>
          </div>
          <button
            onClick={onStop}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* QR Code */}
        <div className="mb-4 flex justify-center">
          {qrDataUrl ? (
            <img src={qrDataUrl} alt="QR Code" width={200} height={200} className="rounded-md" />
          ) : (
            <div className="flex h-[200px] w-[200px] items-center justify-center rounded-md bg-muted">
              <span className="text-xs text-muted-foreground">生成中...</span>
            </div>
          )}
        </div>

        {/* Room code */}
        <div className="mb-3 text-center">
          <p className="mb-1 text-xs text-muted-foreground">Room Code</p>
          <p className="font-mono text-3xl font-bold tracking-widest">{roomCode}</p>
        </div>

        {/* Connection status */}
        <div className="mb-4 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <Wifi className="size-3" />
          <span>{peerCount > 0 ? `${peerCount} 台裝置已連線` : '等待裝置連線...'}</span>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={handleCopy}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? '已複製' : '複製連結'}
          </button>
          <Button size="sm" variant="destructive" onClick={onStop}>
            停止分享
          </Button>
        </div>
      </div>
    </div>
  )
}
