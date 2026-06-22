import { useEffect, useState } from 'react'
import { Loader2, ShieldCheck, UserRound, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { DialogShell } from '@/components/ui/dialog-shell'
import { IconButton } from '@/components/ui/icon-button'
import { RoleAvatar } from '@/components/roles-dialog'
import { cn } from '@/lib/utils'
import type { Role, Task } from '@/lib/types'

interface EditTaskDialogProps {
  /** The task being edited, or null when the dialog is closed. */
  task: Task | null
  /** Roles available for assignment ('' = use the default, no role). */
  roles: Role[]
  saving: boolean
  error: string | null
  onSubmit: (
    title: string,
    description: string,
    roleId: string,
    reviewerRoleId: string
  ) => void
  onClose: () => void
}

export function EditTaskDialog({
  task,
  roles,
  saving,
  error,
  onSubmit,
  onClose,
}: EditTaskDialogProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [roleId, setRoleId] = useState('')
  const [reviewerRoleId, setReviewerRoleId] = useState('')
  const [confirmClose, setConfirmClose] = useState(false)

  // Seed the fields from the task whenever a new one is opened.
  useEffect(() => {
    if (task) {
      setTitle(task.title)
      setDescription(task.description ?? '')
      setRoleId(task.roleId ?? '')
      setReviewerRoleId(task.reviewerRoleId ?? '')
    }
  }, [task])

  if (!task) return null

  const isDirty =
    title !== task.title ||
    description !== (task.description ?? '') ||
    roleId !== (task.roleId ?? '') ||
    reviewerRoleId !== (task.reviewerRoleId ?? '')

  const handleClose = () => {
    if (isDirty && !saving) {
      setConfirmClose(true)
    } else {
      onClose()
    }
  }

  const canSubmit = title.trim().length > 0 && !saving
  const selectedRole = roles.find((r) => r.id === roleId) ?? null
  const selectedReviewerRole =
    roles.find((r) => r.id === reviewerRoleId) ?? null

  const handleSubmit = () => {
    if (!canSubmit) return
    onSubmit(title.trim(), description.trim(), roleId, reviewerRoleId)
  }

  return (
    <DialogShell
      title="編輯任務"
      saving={saving}
      onClose={handleClose}
      contentClassName="max-w-md p-5"
    >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">編輯任務</h2>
          <IconButton
            aria-label="關閉編輯任務"
            onClick={handleClose}
            disabled={saving}
            className="p-1"
          >
            <X className="size-4" />
          </IconButton>
        </div>

        {confirmClose && (
          <div className="mb-4 flex items-center justify-between rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
            <span className="text-amber-200">有未儲存的變更，確定要離開？</span>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setConfirmClose(false)}
                className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent"
              >
                繼續編輯
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded px-2 py-0.5 text-xs text-destructive hover:bg-destructive/15"
              >
                放棄離開
              </button>
            </div>
          </div>
        )}

        <div className="space-y-4">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">任務標題</span>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：實作登入頁面"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-sm font-medium">詳細描述（選填）</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="描述這個任務的目標、需求或背景脈絡…"
              className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </label>

          <div className="space-y-1.5">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <UserRound className="size-3.5" />
              指派角色（選填）
            </span>
            <div className="flex items-center gap-2">
              {selectedRole && (
                <RoleAvatar role={selectedRole} className="size-8 text-sm" />
              )}
              <select
                value={roleId}
                onChange={(e) => setRoleId(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <option value="">預設（不指派角色）</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <ShieldCheck className="size-3.5" />
              Code Reviewer（選填，啟用自動審查）
            </span>
            <div className="flex items-center gap-2">
              {selectedReviewerRole && (
                <RoleAvatar
                  role={selectedReviewerRole}
                  className="size-8 text-sm"
                />
              )}
              <select
                value={reviewerRoleId}
                onChange={(e) => setReviewerRoleId(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <option value="">不自動審查</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm">
              {error}
            </p>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={handleClose} disabled={saving}>
            取消
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={cn(saving && 'opacity-80')}
          >
            {saving && <Loader2 className="animate-spin" />}
            {saving ? '儲存中…' : '儲存變更'}
          </Button>
        </div>
    </DialogShell>
  )
}
