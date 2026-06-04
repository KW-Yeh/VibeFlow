import { useEffect, useState } from 'react'
import { Loader2, RotateCcw, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { DEFAULT_SYSTEM_PROMPT } from '@/lib/claude'
import { cn } from '@/lib/utils'

interface SettingsDialogProps {
  open: boolean
  /** Current custom system prompt ('' = the built-in default is in effect). */
  systemPrompt: string
  saving: boolean
  error: string | null
  /** Called with the new custom prompt ('' = revert to the default). */
  onSave: (systemPrompt: string) => void
  onClose: () => void
}

export function SettingsDialog({
  open,
  systemPrompt,
  saving,
  error,
  onSave,
  onClose,
}: SettingsDialogProps) {
  const [text, setText] = useState('')

  // Seed the editor with the effective prompt whenever the dialog opens.
  useEffect(() => {
    if (open) {
      setText(systemPrompt.trim() ? systemPrompt : DEFAULT_SYSTEM_PROMPT)
    }
  }, [open, systemPrompt])

  if (!open) return null

  const isDefault = text.trim() === DEFAULT_SYSTEM_PROMPT.trim()
  const canSubmit = text.trim().length > 0 && !saving

  const handleSubmit = () => {
    if (!canSubmit) return
    // Persist '' when the text matches the default, so future default
    // improvements apply automatically instead of freezing a stale copy.
    onSave(isDefault ? '' : text.trim())
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60"
        onClick={saving ? undefined : onClose}
      />
      <div className="relative z-10 w-full max-w-2xl rounded-lg border bg-card p-5 text-card-foreground shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">設定</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">
              System Prompt
              <span
                className={cn(
                  'ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium',
                  isDefault
                    ? 'bg-secondary text-secondary-foreground'
                    : 'bg-primary/15 text-primary'
                )}
              >
                {isDefault ? '預設' : '已自訂'}
              </span>
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={saving || isDefault}
              onClick={() => setText(DEFAULT_SYSTEM_PROMPT)}
            >
              <RotateCcw className="size-3" />
              重設為預設
            </Button>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            spellCheck={false}
            className="w-full resize-y rounded-md border bg-background px-3 py-2 font-mono text-xs leading-5 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
          <p className="text-xs text-muted-foreground">
            啟動 Claude 時會以此 prompt 作為 system prompt；
            進度追蹤協議（寫入 .vibeflow-progress.json）會自動附加在後面，無需在此填寫。
          </p>

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
            {saving ? '儲存中…' : '儲存設定'}
          </Button>
        </div>
      </div>
    </div>
  )
}
