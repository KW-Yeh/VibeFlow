import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2 } from 'lucide-react'
import { DialogShell } from '@/components/ui/dialog-shell'
import { Button } from '@/components/ui/button'
import { ZoomableImage } from '@/components/zoomable-image'
import { MarkdownContent } from '@/components/markdown-content'
import { openTerminalFile, readTerminalFile } from '@/lib/api'
import type { TerminalFileResult } from '@/lib/types'

export function TerminalFilePreview({ sessionKey, path, onClose }: {
  sessionKey: string
  path: string
  onClose: () => void
}) {
  const [content, setContent] = useState<TerminalFileResult | null>(null)
  const [openError, setOpenError] = useState('')
  const [opening, setOpening] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)
  useEffect(() => {
    let active = true
    void readTerminalFile(sessionKey, path).then((result) => {
      if (active) setContent(result ?? { ok: false, error: 'unreadable', message: '未連線到 VibeFlow。' })
    }).catch((error: unknown) => {
      if (active) setContent({ ok: false, error: 'unreadable', message: error instanceof Error ? error.message : '無法讀取檔案。' })
    })
    return () => { active = false }
  }, [sessionKey, path])

  const openWithSystem = async () => {
    setOpening(true)
    setOpenError('')
    try {
      const result = await openTerminalFile(sessionKey, path)
      if (!result?.ok) setOpenError(result?.message ?? '未連線到 VibeFlow。')
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : '無法開啟檔案。')
    } finally {
      setOpening(false)
    }
  }

  return createPortal(
    <DialogShell
      className="dark"
      title="檔案預覽"
      description={<span className="block break-all font-mono text-xs">{content?.ok ? content.path : path}</span>}
      onClose={onClose}
      showHeader
      contentClassName="max-w-5xl"
      bodyClassName="min-w-0 p-4"
      footer={content?.ok ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {openError && <p role="alert" className="break-all text-sm text-destructive">{openError}</p>}
          <Button variant="outline" onClick={() => void openWithSystem()} disabled={opening}>
            {opening ? '開啟中…' : '用系統程式開啟'}
          </Button>
        </div>
      ) : undefined}
    >
      {!content ? (
        <p role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />讀取中…</p>
      ) : !content.ok ? (
        <p role="alert" className="py-10 text-center text-sm text-muted-foreground">{content.message}</p>
      ) : content.kind === 'image' ? (
        <div onError={() => setImageFailed(true)}>
          {imageFailed ? <p role="alert">無法顯示這張圖片，請用系統程式開啟。</p> : <ZoomableImage src={content.dataUrl} alt={content.path} />}
        </div>
      ) : content.kind === 'binary' ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{content.reason} 請用系統程式開啟。</p>
      ) : (
        <>
          {/\.md(?:own|x)?$/i.test(content.path) ? <MarkdownContent source={content.text} /> : (
            <pre className="whitespace-pre-wrap break-words rounded-md bg-muted/30 p-3 font-mono text-xs">{content.text}</pre>
          )}
          {content.truncated && <p className="mt-2 text-xs text-muted-foreground">內容過長，僅顯示開頭 256 KB。</p>}
        </>
      )}
    </DialogShell>, document.body
  )
}
