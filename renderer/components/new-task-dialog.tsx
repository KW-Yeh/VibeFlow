import { useEffect, useState } from 'react'
import { GitBranch, Loader2, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { GitInfo } from '@/lib/types'

interface NewTaskDialogProps {
  open: boolean
  gitInfo: GitInfo | null
  creating: boolean
  error: string | null
  onSubmit: (title: string, baseBranch: string | null) => void
  onClose: () => void
}

export function NewTaskDialog({
  open,
  gitInfo,
  creating,
  error,
  onSubmit,
  onClose,
}: NewTaskDialogProps) {
  const [title, setTitle] = useState('')
  const [baseBranch, setBaseBranch] = useState<string>('')

  // Reset fields whenever the dialog opens, defaulting the base branch.
  useEffect(() => {
    if (open) {
      setTitle('')
      setBaseBranch(gitInfo?.defaultBase ?? '')
    }
  }, [open, gitInfo])

  if (!open) return null

  const isRepo = gitInfo?.isRepo ?? false
  const hasRemote = gitInfo?.hasRemote ?? false
  const canSubmit = isRepo && title.trim().length > 0 && !creating

  const handleSubmit = () => {
    if (!canSubmit) return
    onSubmit(title.trim(), hasRemote ? baseBranch || null : null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60"
        onClick={creating ? undefined : onClose}
      />
      <div className="relative z-10 w-full max-w-md rounded-lg border bg-card p-5 text-card-foreground shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">新增任務</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={creating}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X className="size-4" />
          </button>
        </div>

        {!isRepo ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            目前選擇的資料夾不是 Git repository，請先選擇一個 Git 專案。
          </p>
        ) : (
          <div className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">任務標題</span>
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                placeholder="例如：實作登入頁面"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </label>

            {hasRemote && (
              <label className="block space-y-1.5">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <GitBranch className="size-3.5" />
                  基準分支 (Base Branch)
                </span>
                <select
                  value={baseBranch}
                  onChange={(e) => setBaseBranch(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {(gitInfo?.branches ?? []).map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {!hasRemote && (
              <p className="text-xs text-muted-foreground">
                此 repository 沒有 remote，將以目前分支 (
                {gitInfo?.currentBranch ?? 'HEAD'}) 為基準建立本地 worktree。
              </p>
            )}

            {error && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm">
                {error}
              </p>
            )}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={creating}>
            取消
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={cn(creating && 'opacity-80')}
          >
            {creating && <Loader2 className="animate-spin" />}
            {creating ? '建立 Worktree 中…' : '建立任務'}
          </Button>
        </div>
      </div>
    </div>
  )
}
