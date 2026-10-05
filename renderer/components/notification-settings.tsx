import { Bell } from 'lucide-react'

import type { NotificationSettings } from '@/lib/types'
import { cn } from '@/lib/utils'

/** Mirrors DEFAULT_NOTIFICATION_SETTINGS in packages/core/src/store.ts. */
export const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  enabled: true,
  stepCompleted: false,
  allCompleted: true,
  waitingInput: true,
  desktop: false,
}

/** The stored settings over the defaults (the store may hold none, or a partial object). */
export function withNotificationDefaults(value?: Partial<NotificationSettings>): NotificationSettings {
  return { ...DEFAULT_NOTIFICATIONS, ...(value ?? {}) }
}

/** What the browser allows for system notifications, or 'unsupported'. */
export function desktopPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  return Notification.permission
}

function Switch({
  checked,
  label,
  disabled,
  onChange,
}: {
  checked: boolean
  label: string
  disabled?: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="rounded-full p-1 outline-none transition-opacity motion-reduce:transition-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span
        className={cn(
          'relative inline-block h-4 w-7 shrink-0 rounded-full transition-colors motion-reduce:transition-none',
          checked ? 'bg-primary' : 'bg-border'
        )}
      >
        <span
          className={cn(
            'absolute left-0 top-0.5 size-3 rounded-full bg-foreground ring-1 ring-border transition-transform motion-reduce:transform-none motion-reduce:transition-none',
            checked ? 'translate-x-3.5' : 'translate-x-0.5'
          )}
        />
      </span>
    </button>
  )
}

function Row({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className={cn('flex items-start justify-between gap-3', disabled && 'opacity-60')}>
      <div className="min-w-0">
        <div className="text-sm">{label}</div>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <Switch checked={checked} label={label} disabled={disabled} onChange={onChange} />
    </div>
  )
}

/**
 * Settings → 通知. Turning desktop notifications on asks the browser first; a
 * refusal leaves the switch off and says so.
 */
export function NotificationSettingsSection({
  value,
  onChange,
  desktopBlocked,
  onRequestDesktop,
}: {
  value: NotificationSettings
  onChange: (next: NotificationSettings) => void
  /** The browser refused (or cannot show) system notifications. */
  desktopBlocked: boolean
  /** Ask the browser for permission; resolves whether it was granted. */
  onRequestDesktop: () => Promise<boolean>
}) {
  const set = (patch: Partial<NotificationSettings>) => onChange({ ...value, ...patch })
  const off = !value.enabled
  return (
    <div className="space-y-3 rounded-lg border border-border/50 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-base font-medium">
          <Bell className="size-4 text-muted-foreground" />
          通知
        </span>
        <Switch checked={value.enabled} label="通知" onChange={(enabled) => set({ enabled })} />
      </div>
      <p className="text-sm text-muted-foreground">
        從 agent 的執行紀錄判斷階段，不需要 agent 額外回報。正在看的卡片不會跳通知。
      </p>
      <div className="space-y-2.5 border-t border-border/50 pt-3">
        <Row label="步驟完成" hint="待辦清單中每完成一項就通知" checked={value.stepCompleted} disabled={off} onChange={(stepCompleted) => set({ stepCompleted })} />
        <Row label="全部步驟完成" checked={value.allCompleted} disabled={off} onChange={(allCompleted) => set({ allCompleted })} />
        <Row label="等待輸入" hint="Agent 停下來等你回覆或允許權限" checked={value.waitingInput} disabled={off} onChange={(waitingInput) => set({ waitingInput })} />
        <Row
          label="桌面通知"
          hint={desktopBlocked ? '瀏覽器已封鎖通知，請在瀏覽器的網站設定中允許。' : '頁面不在前景時也會跳出系統通知'}
          checked={value.desktop && !desktopBlocked}
          disabled={off}
          onChange={async (desktop) => {
            if (!desktop) return set({ desktop: false })
            set({ desktop: await onRequestDesktop() })
          }}
        />
      </div>
    </div>
  )
}
