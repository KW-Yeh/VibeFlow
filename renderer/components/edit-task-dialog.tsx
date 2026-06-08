import { useEffect, useState } from 'react'
import { Loader2, UserRound, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
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
  onSubmit: (title: string, description: string, roleId: string) => void
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

  // Seed the fields from the task whenever a new one is opened.
  useEffect(() => {
    if (task) {
      setTitle(task.title)
      setDescription(task.description ?? '')
      setRoleId(task.roleId ?? '')
    }
  }, [task])

  if (!task) return null

  const canSubmit = title.trim().length > 0 && !saving
  const selectedRole = roles.find((r) => r.id === roleId) ?? null

  const handleSubmit = () => {
    if (!canSubmit) return
    onSubmit(title.trim(), description.trim(), roleId)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60"
        onClick={saving ? undefined : onClose}
      />
      <div className="relative z-10 w-full max-w-md rounded-lg border bg-card p-5 text-card-foreground shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">編輯任務</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X className="size-4" />
          </button>
        </div>

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

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm">
              {error}
            </p>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
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
      </div>
    </div>
  )
}
