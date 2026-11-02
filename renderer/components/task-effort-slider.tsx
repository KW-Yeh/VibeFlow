import { fieldClass } from '@/components/ui/field'
import { clampEffort } from '@/lib/effort'
import { cn } from '@/lib/utils'
import type { AgentEffort, ManualEffort } from '@/lib/types'

const EFFORT_OPTIONS: ReadonlyArray<{
  value: AgentEffort
  label: string
  description: string
}> = [
  { value: 'auto', label: '自動', description: 'Jev 會依任務與目前模型選擇合適的推理強度。' },
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
export const DEFAULT_TASK_EFFORT: AgentEffort = 'auto'

/** The effort row of a task form: the levels the model accepts, plus auto. */
export function TaskEffortSelect({
  value,
  onChange,
  levels,
  disabled = false,
  className,
}: {
  value: AgentEffort
  onChange: (value: AgentEffort) => void
  /** Levels the selected model accepts; empty when it takes no effort. */
  levels: readonly ManualEffort[]
  disabled?: boolean
  className?: string
}) {
  const options = EFFORT_OPTIONS.filter((option) => option.value === 'auto' || levels.includes(option.value))
  const shown = value === 'auto' ? value : clampEffort(value, levels) ?? 'auto'
  const selected = options.find((option) => option.value === shown) ?? options[0]

  return (
    <select
      name="task-effort"
      value={selected.value}
      disabled={disabled || options.length === 1}
      title={levels.length === 0 ? '這個 model 不支援調整推理強度，啟動時使用模型預設值。' : selected.description}
      onChange={(event) => onChange(event.target.value as AgentEffort)}
      className={cn(fieldClass, className)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label} · {option.value}
        </option>
      ))}
    </select>
  )
}
