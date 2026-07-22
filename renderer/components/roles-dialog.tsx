import { useEffect, useRef, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { ChevronDown, ImagePlus, Loader2, Plus, Trash2 } from 'lucide-react'

import { AvatarCropDialog } from '@/components/avatar-crop-dialog'
import { Button } from '@/components/ui/button'
import { DialogShell } from '@/components/ui/dialog-shell'
import { PRESET_ROLES } from '@/lib/claude'
import { cn } from '@/lib/utils'
import type { Role } from '@/lib/types'

interface RolesDialogProps {
  open: boolean
  roles: Role[]
  saving: boolean
  error: string | null
  onCreate: (input: Omit<Role, 'id'>) => Promise<boolean>
  onUpdate: (roleId: string, patch: Omit<Role, 'id'>) => Promise<boolean>
  onDelete: (roleId: string) => void
  onClose: () => void
}

/** Read an image File as a raw data URL, handed off to the crop dialog. */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('讀取圖片失敗'))
    reader.onload = () => resolve(reader.result as string)
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
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [showPresets, setShowPresets] = useState(false)
  const [cropSrc, setCropSrc] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Reset to the list view whenever the dialog (re-)opens.
  useEffect(() => {
    if (open) {
      setEditingId(null)
      setForm(EMPTY_FORM)
      setAvatarError(null)
      setConfirmDeleteId(null)
      setShowPresets(false)
      setCropSrc(null)
    }
  }, [open])

  const applyPreset = (preset: Omit<Role, 'id'>) => {
    setForm({
      name: preset.name,
      avatar: preset.avatar ?? '',
      positioning: preset.positioning ?? '',
      responsibilities: preset.responsibilities ?? '',
      boundaries: preset.boundaries ?? '',
    })
    setShowPresets(false)
    setAvatarError(null)
  }

  const startCreate = () => {
    setForm(EMPTY_FORM)
    setAvatarError(null)
    setShowPresets(false)
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
    setShowPresets(false)
    setEditingId(role.id)
  }

  const handlePickImage = async (file: File | undefined) => {
    if (!file) return
    setAvatarError(null)
    try {
      const dataUrl = await fileToDataUrl(file)
      setCropSrc(dataUrl)
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : String(err))
    }
  }

  const isEditing = editingId !== null
  const canSubmit = form.name.trim().length > 0 && !saving

  const handleSubmit = async () => {
    if (!canSubmit) return
    const input: Omit<Role, 'id'> = {
      name: form.name.trim(),
      avatar: form.avatar.trim() || undefined,
      positioning: form.positioning.trim() || undefined,
      responsibilities: form.responsibilities.trim() || undefined,
      boundaries: form.boundaries.trim() || undefined,
    }
    const ok =
      editingId === 'new'
        ? await onCreate(input)
        : editingId
          ? await onUpdate(editingId, input)
          : false
    // Return to the list view only on a successful save; on failure the form
    // stays put so the user can fix the error (e.g. a duplicate name).
    if (ok) {
      setEditingId(null)
      setForm(EMPTY_FORM)
      setAvatarError(null)
    }
  }

  return (
    <>
    <AnimatePresence>
      {open && (
        <DialogShell
          key="roles-dialog"
      title={isEditing ? (editingId === 'new' ? '新增角色' : '編輯角色') : '角色'}
      description={isEditing ? '定義 agent 執行任務時的角色定位、職責與邊界。' : '管理新增任務與編輯任務可指派的角色。'}
      saving={saving}
      onClose={onClose}
      showHeader
      contentClassName="max-w-2xl"
      footer={
        !isEditing ? (
          <>
            <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
              關閉
            </Button>
            <Button size="sm" onClick={startCreate} className="active:scale-95">
              <Plus />
              新增角色
            </Button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditingId(null)}
                disabled={saving}
              >
                返回
              </Button>
              {editingId && editingId !== 'new' && (
                confirmDeleteId === editingId ? (
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmDeleteId(null)}
                    >
                      取消
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        onDelete(editingId)
                        setConfirmDeleteId(null)
                        setEditingId(null)
                      }}
                      disabled={saving}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      確認刪除
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmDeleteId(editingId)}
                    disabled={saving}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                    刪除
                  </Button>
                )
              )}
            </div>
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
        )
      }
    >
        {!isEditing ? (
          <div className="space-y-3">
            {roles.length === 0 ? (
              <p className="rounded-md border border-dashed border-border/50 p-6 text-center text-base text-muted-foreground">
                還沒有任何角色 — 建立角色後即可在新增任務時指派。
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {roles.map((role) => (
                  <button
                    key={role.id}
                    type="button"
                    onClick={() => startEdit(role)}
                    className="flex flex-col items-center gap-1.5 rounded-md border bg-background p-3 text-center transition-colors hover:border-border hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <RoleAvatar role={role} className="size-12 text-xl" />
                    <p className="w-full truncate text-base font-medium">
                      {role.name}
                    </p>
                    {role.positioning && (
                      <p className="line-clamp-2 w-full text-sm text-muted-foreground">
                        {role.positioning}
                      </p>
                    )}
                  </button>
                ))}
              </div>
            )}
            {error && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-base">
                {error}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Preset selector */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowPresets((v) => !v)}
                className="flex w-full items-center justify-between rounded-md border border-dashed border-border/60 px-3 py-2 text-base text-muted-foreground hover:border-border hover:text-foreground"
              >
                <span>從預設角色選擇</span>
                <ChevronDown
                  className={cn(
                    'size-3.5 transition-transform motion-reduce:transform-none motion-reduce:transition-none',
                    showPresets && 'rotate-180'
                  )}
                />
              </button>
              {showPresets && (
                <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
                  {PRESET_ROLES.map((preset) => (
                    <li key={preset.name}>
                      <button
                        type="button"
                        onClick={() => applyPreset(preset)}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-accent"
                      >
                        <RoleAvatar role={preset} className="size-7 text-base" />
                        <div className="min-w-0">
                          <p className="text-base font-medium">{preset.name}</p>
                          {preset.positioning && (
                            <p className="truncate text-sm text-muted-foreground">
                              {preset.positioning}
                            </p>
                          )}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex items-center gap-3">
              <RoleAvatar
                role={{ name: form.name || '?', avatar: form.avatar }}
                className="size-14 text-2xl"
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
                  name="role-avatar"
                  autoComplete="off"
                  onChange={(e) =>
                    setForm((f) => ({ ...f, avatar: e.target.value }))
                  }
                  placeholder="或輸入 emoji / 縮寫"
                  disabled={isImageAvatar(form.avatar)}
                  className="w-40 rounded-md border bg-background px-2.5 py-1.5 text-base outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
                />
              </div>
            </div>
            {avatarError && (
              <p className="text-sm text-destructive">{avatarError}</p>
            )}

            <label className="block space-y-1.5">
              <span className="text-base font-medium">角色名稱</span>
              <input
                autoFocus
                name="role-name"
                autoComplete="off"
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder="例如：資深前端工程師"
                className="w-full rounded-md border bg-background px-3 py-2 text-base outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-base font-medium">角色定位描述</span>
              <textarea
                name="role-positioning"
                autoComplete="off"
                value={form.positioning}
                onChange={(e) =>
                  setForm((f) => ({ ...f, positioning: e.target.value }))
                }
                rows={2}
                placeholder="這個角色是誰、站在什麼立場思考…"
                className="w-full resize-y rounded-md border bg-background px-3 py-2 text-base outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-base font-medium">職責內容</span>
              <textarea
                name="role-responsibilities"
                autoComplete="off"
                value={form.responsibilities}
                onChange={(e) =>
                  setForm((f) => ({ ...f, responsibilities: e.target.value }))
                }
                rows={3}
                placeholder="這個角色負責哪些事情…"
                className="w-full resize-y rounded-md border bg-background px-3 py-2 text-base outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-base font-medium">執行邊界描述</span>
              <textarea
                name="role-boundaries"
                autoComplete="off"
                value={form.boundaries}
                onChange={(e) =>
                  setForm((f) => ({ ...f, boundaries: e.target.value }))
                }
                rows={3}
                placeholder="這個角色應該 / 不應該做什麼、有哪些限制…"
                className="w-full resize-y rounded-md border bg-background px-3 py-2 text-base outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </label>

            {error && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-base">
                {error}
              </p>
            )}
          </div>
        )}

        </DialogShell>
      )}
    </AnimatePresence>
    <AnimatePresence>
      {open && cropSrc && (
        <AvatarCropDialog
          key="avatar-crop-dialog"
          src={cropSrc}
          onCancel={() => setCropSrc(null)}
          onApply={(dataUrl) => {
            setForm((f) => ({ ...f, avatar: dataUrl }))
            setCropSrc(null)
          }}
        />
      )}
    </AnimatePresence>
    </>
  )
}
