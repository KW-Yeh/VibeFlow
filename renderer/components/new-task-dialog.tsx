import { useEffect, useState } from 'react'
import { FolderOpen, GitBranch, Loader2, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { GitInfo } from '@/lib/types'

interface NewTaskDialogProps {
  open: boolean
  creating: boolean
  error: string | null
  pickFolder: () => Promise<string | null>
  loadGitInfo: (projectPath: string) => Promise<GitInfo | null>
  onSubmit: (
    title: string,
    projectPath: string,
    baseBranch: string | null
  ) => void
  onClose: () => void
}

function basename(p: string): string {
  const parts = p.split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

export function NewTaskDialog({
  open,
  creating,
  error,
  pickFolder,
  loadGitInfo,
  onSubmit,
  onClose,
}: NewTaskDialogProps) {
  const [title, setTitle] = useState('')
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null)
  const [loadingInfo, setLoadingInfo] = useState(false)
  const [baseBranch, setBaseBranch] = useState('')

  // Reset everything whenever the dialog opens.
  useEffect(() => {
    if (open) {
      setTitle('')
      setProjectPath(null)
      setGitInfo(null)
      setLoadingInfo(false)
      setBaseBranch('')
    }
  }, [open])

  if (!open) return null

  const handlePick = async () => {
    const path = await pickFolder()
    if (!path) return
    setProjectPath(path)
    setGitInfo(null)
    setLoadingInfo(true)
    try {
      const info = await loadGitInfo(path)
      setGitInfo(info)
      setBaseBranch(info?.defaultBase ?? '')
    } finally {
      setLoadingInfo(false)
    }
  }

  const isRepo = gitInfo?.isRepo ?? false
  const hasRemote = gitInfo?.hasRemote ?? false
  const canSubmit =
    Boolean(projectPath) &&
    isRepo &&
    title.trim().length > 0 &&
    !creating &&
    !loadingInfo

  const handleSubmit = () => {
    if (!canSubmit || !projectPath) return
    onSubmit(title.trim(), projectPath, hasRemote ? baseBranch || null : null)
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

        <div className="space-y-4">
          {/* Project folder picker (per task) */}
          <div className="space-y-1.5">
            <span className="text-sm font-medium">專案資料夾</span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePick}
                disabled={creating}
              >
                <FolderOpen />
                {projectPath ? '更換資料夾' : '選擇資料夾'}
              </Button>
              {projectPath && (
                <span
                  className="truncate text-xs text-muted-foreground"
                  title={projectPath}
                >
                  {basename(projectPath)}
                </span>
              )}
            </div>
          </div>

          {loadingInfo && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              偵測 Git 狀態中…
            </p>
          )}

          {projectPath && !loadingInfo && !isRepo && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
              這個資料夾不是 Git repository，請改選一個 Git 專案。
            </p>
          )}

          {isRepo && (
            <>
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

              {hasRemote ? (
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
              ) : (
                <p className="text-xs text-muted-foreground">
                  此 repository 沒有 remote，將以目前分支 (
                  {gitInfo?.currentBranch ?? 'HEAD'}) 為基準建立本地 worktree。
                </p>
              )}
            </>
          )}

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm">
              {error}
            </p>
          )}
        </div>

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
