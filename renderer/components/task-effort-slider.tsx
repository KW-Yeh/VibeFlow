import { Gauge } from 'lucide-react'

import { clampEffort } from '@/lib/effort'
import type { AgentEffort } from '@/lib/types'

const EFFORT_OPTIONS: ReadonlyArray<{
  value: AgentEffort
  label: string
  description: string
}> = [
  { value: 'low', label: '快速', description: '適合範圍明確、低風險的小任務。' },
  { value: 'medium', label: '標準', description: '兼顧速度與推理深度，適合一般開發任務。' },
  { value: 'high', label: '深入', description: '適合跨檔案、除錯或需要較多判斷的任務。' },
  { value: 'xhigh', label: '極致', description: '適合高複雜度、長鏈推理或高風險變更。' },
  { value: 'max', label: '最大', description: '最深的推理，適合最困難的問題。' },
  {
    value: 'ultra',
    label: '委派',
    description: '最深推理並自動委派子任務，耗時與用量可能明顯增加。',
  },
]

/**
 * Mirror of DEFAULT_TASK_EFFORT in packages/core/src/agents.ts. The renderer must
 * not import main at runtime, so the value is duplicated on purpose — change
 * both together (test/agents.test.mjs guards the pair).
 */
export const DEFAULT_TASK_EFFORT: AgentEffort = 'medium'

export function TaskEffortSlider({
  value,
  onChange,
  levels,
  disabled = false,
}: {
  value: AgentEffort
  onChange: (value: AgentEffort) => void
  /** Levels the selected model accepts; empty when it takes no effort. */
  levels: readonly AgentEffort[]
  disabled?: boolean
}) {
  const options = EFFORT_OPTIONS.filter((option) => levels.includes(option.value))

  if (options.length === 0) {
    return (
      <div className="space-y-2.5 rounded-lg border border-border/50 p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-base font-medium">
            <Gauge className="size-4 text-muted-foreground" />
            任務複雜度
          </span>
          <span className="rounded-full bg-muted px-2.5 py-1 text-sm font-medium text-muted-foreground">
            不適用
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          這個 model 不支援調整推理強度，啟動時不會指定任務複雜度。
        </p>
      </div>
    )
  }

  const shown = clampEffort(value, levels) ?? options[0].value
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === shown)
  )
  const selected = options[selectedIndex]

  return (
    <div className="space-y-2.5 rounded-lg border border-border/50 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-base font-medium">
          <Gauge className="size-4 text-muted-foreground" />
          任務複雜度
        </span>
        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-sm font-medium text-primary">
          {selected.label} · {selected.value}
        </span>
      </div>
      <input
        type="range"
        name="task-effort"
        min={0}
        max={options.length - 1}
        step={1}
        value={selectedIndex}
        disabled={disabled || options.length === 1}
        aria-label="任務複雜度"
        aria-valuetext={`${selected.label} (${selected.value})`}
        onChange={(event) => {
          const option = options[Number(event.target.value)]
          if (option) onChange(option.value)
        }}
        className="h-2 w-full cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50"
      />
      <div
        className="grid text-center text-xs text-muted-foreground"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
        aria-hidden="true"
      >
        {options.map((option) => (
          <span key={option.value}>{option.label}</span>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        {selected.description} Claude Code 與 Codex 會在啟動此任務時套用；可選的級距依 model 而定。
      </p>
    </div>
  )
}
