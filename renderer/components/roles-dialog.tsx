import { useEffect, useRef, useState } from 'react'
import { ImagePlus, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Role } from '@/lib/types'

interface RolesDialogProps {
  open: boolean
  roles: Role[]
  saving: boolean
  error: string | null
  onCreate: (input: Omit<Role, 'id'>) => void
  onUpdate: (roleId: string, patch: Omit<Role, 'id'>) => void
  onDelete: (roleId: string) => void
  onClose: () => void
}

/** Max edge length for stored avatar images — keeps the data URL small. */
const AVATAR_MAX_EDGE = 128

/**
 * Read an image File, downscale it to fit AVATAR_MAX_EDGE, and return a JPEG
 * data URL. Downscaling keeps the persisted state (electron-store) compact.
 */
function fileToAvatarDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('讀取圖片失敗'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('無法解析圖片'))
      img.onload = () => {
        const scale = Math.min(
          1,
          AVATAR_MAX_EDGE / Math.max(img.width, img.height)
        )
        const w = Math.round(img.width * scale)
        const h = Math.round(img.height * scale)
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('無法建立繪圖環境'))
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}

function isImageAvatar(avatar?: string): boolean {
  return !!avatar && avatar.startsWith('data:')
}

/** Avatar bubble: image when a data URL, otherwise the emoji/initials text. */
export function RoleAvatar({
  role,
  className,
}: {
  role: Pick<Role, 'name' | 'avatar'>
  className?: string
}) {
  const base =
    'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary text-secondary-foreground'
  if (isImageAvatar(role.avatar)) {
    return (
      <img
        src={role.avatar}
        alt={role.name}
        className={cn(base, 'object-cover', className)}
      />
    )
  }
  const fallback = role.avatar?.trim() || role.name.trim().slice(0, 1) || '?'
  return (
    <span className={cn(base, className)} aria-hidden>
      {fallback}
    </span>
  )
}

interface FormState {
  name: string
  avatar: string
  positioning: string
  responsibilities: string
  boundaries: string
}

const EMPTY_FORM: FormState = {
  name: '',
  avatar: '',
  positioning: '',
  responsibilities: '',
  boundaries: '',
}

export function RolesDialog({
  open,
  roles,
  saving,
  error,
  onCreate,
  onUpdate,
  onDelete,
  onClose,
}: RolesDialogProps) {
  // null = list view; 'new' = creating; otherwise the id being edited.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Reset to the list view whenever the dialog (re-)opens.
  useEffect(() => {
    if (open) {
      setEditingId(null)
      setForm(EMPTY_FORM)
      setAvatarError(null)
    }
  }, [open])

  if (!open) return null

  const startCreate = () => {
    setForm(EMPTY_FORM)
    setAvatarError(null)
    setEditingId('new')
  }

  const startEdit = (role: Role) => {
    setForm({
      name: role.name,
      avatar: role.avatar ?? '',
      positioning: role.positioning ?? '',
      responsibilities: role.responsibilities ?? '',
      boundaries: role.boundaries ?? '',
    })
    setAvatarError(null)
    setEditingId(role.id)
  }

  const handlePickImage = async (file: File | undefined) => {
    if (!file) return
    setAvatarError(null)
    try {
      const dataUrl = await fileToAvatarDataUrl(file)
      setForm((f) => ({ ...f, avatar: dataUrl }))
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : String(err))
    }
  }

  const isEditing = editingId !== null
  const canSubmit = form.name.trim().length > 0 && !saving

  const handleSubmit = () => {
    if (!canSubmit) return
    const input: Omit<Role, 'id'> = {
      name: form.name.trim(),
      avatar: form.avatar.trim() || undefined,
      positioning: form.positioning.trim() || undefined,
      responsibilities: form.responsibilities.trim() || undefined,
      boundaries: form.boundaries.trim() || undefined,
    }
    if (editingId === 'new') onCreate(input)
    else if (editingId) onUpdate(editingId, input)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60"
        onClick={saving ? undefined : onClose}
      />
      <div className="relative z-10 flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg border bg-card p-5 text-card-foreground shadow-lg">
        <div className="mb-4 flex shrink-0 items-center justify-between">
          <h2 className="text-lg font-semibold">
            {isEditing ? (editingId === 'new' ? '新增角色' : '編輯角色') : '角色'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X className="size-4" />
          </button>
        </div>

        {!isEditing ? (
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
            {roles.length === 0 ? (
              <p className="rounded-md border border-dashed border-border/50 p-6 text-center text-sm text-muted-foreground">
                還沒有任何角色 — 建立角色後即可在新增任務時指派。
              </p>
            ) : (
              <ul className="space-y-2">
                {roles.map((role) => (
                  <li
                    key={role.id}
                    className="flex items-center gap-3 rounded-md border bg-background p-2.5"
                  >
                    <RoleAvatar role={role} className="size-9 text-sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {role.name}
                      </p>
                      {role.positioning && (
                        <p className="truncate text-xs text-muted-foreground">
                          {role.positioning}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => startEdit(role)}
                      title="編輯角色"
                      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(role.id)}
                      disabled={saving}
                      title="刪除角色"
                      className="rounded p-1 text-muted-foreground hover:bg-destructive/15 hover:text-destructive disabled:opacity-50"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {error && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm">
                {error}
              </p>
            )}
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            <div className="flex items-center gap-3">
              <RoleAvatar
                role={{ name: form.name || '?', avatar: form.avatar }}
                className="size-14 text-xl"
              />
              <div className="space-y-1.5">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    void handlePickImage(e.target.files?.[0])
                    e.target.value = ''
                  }}
                />
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fileRef.current?.click()}
                  >
                    <ImagePlus className="size-3.5" />
                    選擇圖片
                  </Button>
                  {form.avatar && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setForm((f) => ({ ...f, avatar: '' }))}
                    >
                      移除
                    </Button>
                  )}
                </div>
                <input
                  value={isImageAvatar(form.avatar) ? '' : form.avatar}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, avatar: e.target.value }))
                  }
                  placeholder="或輸入 emoji / 縮寫"
                  disabled={isImageAvatar(form.avatar)}
                  className="w-40 rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
                />
              </div>
            </div>
            {avatarError && (
              <p className="text-xs text-destructive">{avatarError}</p>
            )}

            <label className="block space-y-1.5">
              <span className="text-sm font-medium">角色名稱</span>
              <input
                autoFocus
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder="例如：資深前端工程師"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium">角色定位描述</span>
              <textarea
                value={form.positioning}
                onChange={(e) =>
                  setForm((f) => ({ ...f, positioning: e.target.value }))
                }
                rows={2}
                placeholder="這個角色是誰、站在什麼立場思考…"
                className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium">職責內容</span>
              <textarea
                value={form.responsibilities}
                onChange={(e) =>
                  setForm((f) => ({ ...f, responsibilities: e.target.value }))
                }
                rows={3}
                placeholder="這個角色負責哪些事情…"
                className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium">執行邊界描述</span>
              <textarea
                value={form.boundaries}
                onChange={(e) =>
                  setForm((f) => ({ ...f, boundaries: e.target.value }))
                }
                rows={3}
                placeholder="這個角色應該 / 不應該做什麼、有哪些限制…"
                className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </label>

            {error && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm">
                {error}
              </p>
            )}
          </div>
        )}

        <div className="mt-5 flex shrink-0 justify-between gap-2">
          {!isEditing ? (
            <>
              <Button variant="ghost" size="sm" onClick={onClose}>
                關閉
              </Button>
              <Button size="sm" onClick={startCreate} className="active:scale-95">
                <Plus />
                新增角色
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditingId(null)}
                disabled={saving}
              >
                返回
              </Button>
              <Button
                size="sm"
                onClick={handleSubmit}
                disabled={!canSubmit}
                className={cn(saving && 'opacity-80')}
              >
                {saving && <Loader2 className="animate-spin" />}
                {saving ? '儲存中…' : '儲存角色'}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
