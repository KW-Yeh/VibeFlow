import { useEffect, useState } from 'react'
import { AlertTriangle, FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Workspace } from '@/lib/types'

interface WorkspaceDialogProps {
  open: boolean
  workspace?: Workspace | null
  pickFolder: () => Promise<string | null>
  saving: boolean
  error: string | null
  onSubmit: (name: string, path: string) => void
  onDelete?: () => void
  onClose: () => void
}

export function WorkspaceDialog({
  open,
  workspace,
  pickFolder,
  saving,
  error,
  onSubmit,
  onDelete,
  onClose,
}: WorkspaceDialogProps) {
  const [name, setName] = useState('')
  const [path, setPath] = useState('')

  useEffect(() => {
    if (open) {
      setName(workspace?.name ?? '')
      setPath(workspace?.path ?? '')
    }
  }, [open, workspace])

  if (!open) return null

  const handlePickFolder = async () => {
    const picked = await pickFolder()
    if (picked) {
      setPath(picked)
      if (!name) {
        setName(picked.split('/').pop() ?? picked)
      }
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !path.trim()) return
    onSubmit(name.trim(), path.trim())
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[480px] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-card p-6 shadow-xl">
        <h2 className="mb-4 text-base font-semibold">
          {workspace ? '編輯 Workspace' : '新增 Workspace'}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm text-muted-foreground">名稱</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例：MyProject Context"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-muted-foreground">資料夾路徑</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/path/to/workspace"
                className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <Button type="button" variant="outline" size="sm" onClick={handlePickFolder}>
                <FolderOpen className="size-3.5" />
              </Button>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              資料夾中應包含{' '}
              <code className="rounded bg-muted px-1 py-0.5">context.html</code>{' '}
              作為知識目錄
            </p>
          </div>
          {error && (
            <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="size-3.5 shrink-0" />
              {error}
            </div>
          )}
          <div className="flex items-center justify-between pt-1">
            <div>
              {workspace && onDelete && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onDelete}
                  className="text-destructive hover:border-destructive hover:bg-destructive/10"
                >
                  刪除
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onClose}>
                取消
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={saving || !name.trim() || !path.trim()}
              >
                {saving ? '儲存中…' : workspace ? '儲存' : '新增'}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
