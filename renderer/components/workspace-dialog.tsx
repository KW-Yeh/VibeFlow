import { useEffect, useState } from 'react'
import { FolderOpen } from 'lucide-react'
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
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (open) {
      setName(workspace?.name ?? '')
      setPath(workspace?.path ?? '')
      setConfirmDelete(false)
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={saving ? undefined : onClose} />
      <div className="relative z-10 w-full max-w-[480px] rounded-lg border bg-card p-5 text-card-foreground shadow-lg">
        <h2 className="mb-4 text-base font-semibold">
          {workspace ? '編輯 Workspace' : '新增 Workspace'}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium">名稱</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例：MyProject Context"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium">資料夾路徑</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/path/to/workspace"
                className="flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
              <Button type="button" variant="secondary" size="sm" onClick={handlePickFolder}>
                <FolderOpen className="size-3.5" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              資料夾中應包含{' '}
              <code className="rounded bg-muted px-1 py-0.5 font-mono">context.html</code>{' '}
              作為知識目錄
            </p>
          </div>
          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex items-center justify-between pt-1">
            <div>
              {workspace && onDelete && (
                confirmDelete ? (
                  <div className="flex gap-1.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmDelete(false)}
                    >
                      取消
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={onDelete}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      確認刪除
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmDelete(true)}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    刪除
                  </Button>
                )
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
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
