import { useEffect, useState } from 'react'
import { Loader2, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Task } from '@/lib/types'

interface EditTaskDialogProps {
  /** The task being edited, or null when the dialog is closed. */
  task: Task | null
  saving: boolean
  error: string | null
  onSubmit: (title: string, description: string) => void
  onClose: () => void
}

export function EditTaskDialog({
  task,
  saving,
  error,
  onSubmit,
  onClose,
}: EditTaskDialogProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')

  // Seed the fields from the task whenever a new one is opened.
  useEffect(() => {
    if (task) {
      setTitle(task.title)
      setDescription(task.description ?? '')
    }
  }, [task])

  if (!task) return null

  const canSubmit = title.trim().length > 0 && !saving

  const handleSubmit = () => {
    if (!canSubmit) return
    onSubmit(title.trim(), description.trim())
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
