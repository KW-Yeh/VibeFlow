import { useEffect, useState } from 'react'
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued'
import { CheckCircle2, ExternalLink, GitPullRequest, Loader2, Sparkles, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { DiffFile, PrStatus } from '@/lib/types'

interface ReviewDialogProps {
  open: boolean
  taskTitle: string
  files: DiffFile[]
  loading: boolean
  finalizing: boolean
  generatingMessage: boolean
  result: { committed: boolean; pushed: boolean } | null
  /** undefined = not yet checked; null = checked, no PR; PrStatus = PR exists */
  prStatus: PrStatus | null | undefined
  error: string | null
  onApprove: (message: string) => void
  onGenerateMessage: () => Promise<string | null>
  /** Open existing PR URL in browser. */
  onOpenPr: () => void
  /** Invoke /pr skill to create a new PR via ChatPanel (when prStatus is null). */
  onCreatePr: () => void
  /** Invoke /pr skill to update existing PR description (when prStatus is set). */
  onUpdatePr?: () => void
  onClose: () => void
}

const STATUS_LABEL: Record<string, string> = {
  A: '新增',
  M: '修改',
  D: '刪除',
  R: '更名',
  '?': '未追蹤',
}

export function ReviewDialog({
  open,
  taskTitle,
  files,
  loading,
  finalizing,
  generatingMessage,
  result,
  prStatus,
  error,
  onApprove,
  onGenerateMessage,
  onOpenPr,
  onCreatePr,
  onUpdatePr,
  onClose,
}: ReviewDialogProps) {
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (open) setMessage(`VibeFlow: ${taskTitle}`)
  }, [open, taskTitle])

  const handleGenerate = async () => {
    const generated = await onGenerateMessage()
    if (generated) setMessage(generated)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60"
        onClick={finalizing ? undefined : onClose}
      />
      <div className="relative z-10 flex max-h-[88vh] w-full max-w-4xl flex-col rounded-lg border bg-card text-card-foreground shadow-lg">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">審查變更</h2>
            <p className="truncate text-xs text-muted-foreground">{taskTitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={finalizing}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              讀取 diff 中…
            </div>
          ) : files.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              與基準分支相比沒有已提交的變更。
            </p>
          ) : (
            <div className="space-y-5">
              {files.map((file) => (
                <div
                  key={file.path}
                  className="overflow-hidden rounded-md border"
                >
                  <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5">
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground">
                      {STATUS_LABEL[file.status] ?? file.status}
                    </span>
                    <span className="font-mono text-xs">{file.path}</span>
                    {file.truncated && (
                      <span className="text-[10px] text-muted-foreground">
                        (已截斷)
                      </span>
                    )}
                  </div>
                  <div className="text-xs">
                    <ReactDiffViewer
                      oldValue={file.oldValue}
                      newValue={file.newValue}
                      splitView
                      useDarkTheme
                      compareMethod={DiffMethod.LINES}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t px-5 py-3">
          {result ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2 text-sm text-primary">
                  <CheckCircle2 className="size-4" />
                  {result.committed ? '已提交' : '無變更可提交'}
                  {result.pushed ? '並已推送至遠端' : '（未推送）'}
                </span>
                <div className="flex items-center gap-2">
                  {result.pushed && prStatus === undefined && (
                    <Button size="sm" variant="outline" disabled>
                      <Loader2 className="size-3.5 animate-spin" />
                    </Button>
                  )}
                  {result.pushed && prStatus !== undefined && prStatus ? (
                    <>
                      <Button size="sm" variant="outline" onClick={onOpenPr}>
                        <ExternalLink className="size-3.5" />
                        查看 PR
                      </Button>
                      {onUpdatePr && (
                        <Button size="sm" variant="outline" onClick={onUpdatePr}>
                          <GitPullRequest className="size-3.5" />
                          更新 PR
                        </Button>
                      )}
                    </>
                  ) : result.pushed && prStatus === null ? (
                    <Button size="sm" variant="outline" onClick={onCreatePr}>
                      <GitPullRequest className="size-3.5" />
                      建立 PR
                    </Button>
                  ) : null}
                  <Button size="sm" onClick={onClose}>
                    完成
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Commit message"
                  disabled={finalizing || generatingMessage}
                  className="flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleGenerate}
                  disabled={finalizing || generatingMessage || loading}
                  title="使用 AI 產生 commit message"
                >
                  {generatingMessage ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="size-3.5" />
                  )}
                </Button>
                <Button
                  size="sm"
                  onClick={() => onApprove(message.trim() || `VibeFlow: ${taskTitle}`)}
                  disabled={finalizing || loading}
                >
                  {finalizing && <Loader2 className="animate-spin" />}
                  {finalizing ? '提交中…' : '提交並推送至遠端'}
                </Button>
              </div>
              {!finalizing && (
                <p className="text-right text-[11px] text-muted-foreground">
                  將執行 git commit 並 push 至遠端分支
                </p>
              )}
            </div>
          )}
          {error && (
            <p className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
