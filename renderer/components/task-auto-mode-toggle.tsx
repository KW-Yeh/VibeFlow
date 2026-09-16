import { Zap } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * Whether this card's agent may act without asking for approval. The card's own
 * value is what a launch reads; the board-wide switch only seeds new cards.
 */
export function TaskAutoModeToggle({
  value,
  onChange,
  disabled = false,
}: {
  value: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="space-y-2.5 rounded-lg border border-border/50 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-base font-medium">
          <Zap className="size-4 text-muted-foreground" />
          Auto Mode
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={value}
          aria-label="Auto Mode"
          disabled={disabled}
          onClick={() => onChange(!value)}
          className="rounded-full p-1 outline-none transition-opacity motion-reduce:transition-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span
            className={cn(
              'relative inline-block h-4 w-7 shrink-0 rounded-full transition-colors motion-reduce:transition-none',
              value ? 'bg-primary' : 'bg-border'
            )}
          >
            <span
              className={cn(
                'absolute left-0 top-0.5 size-3 rounded-full bg-foreground ring-1 ring-border transition-transform motion-reduce:transform-none motion-reduce:transition-none',
                value ? 'translate-x-3.5' : 'translate-x-0.5'
              )}
            />
          </span>
        </button>
      </div>
      <p className="text-sm text-muted-foreground">
        {value
          ? '開啟：Agent 會直接修改檔案、執行指令，不會逐次向你確認。'
          : '關閉：Agent 每次要動作前，都會在終端機裡等你允許。'}
      </p>
    </div>
  )
}
