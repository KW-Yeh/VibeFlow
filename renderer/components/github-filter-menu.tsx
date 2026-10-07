import { Check, ChevronDown, type LucideIcon } from 'lucide-react'
import { useState } from 'react'

import { MENU_ITEM, useDismissible } from '@/components/board-columns'
import { toggleValue } from '@/lib/github-filter'
import { cn } from '@/lib/utils'

/** Multi-select twin of the board's ProjectFilter: the first row clears, the rest toggle. */
export function GithubFilterMenu({
  name,
  allLabel,
  icon: Icon,
  options,
  value,
  onChange,
  optionLabel = (option) => option,
}: {
  /** Short name for the button once several values are ticked, e.g. 「專案 · 2」. */
  name: string
  allLabel: string
  icon: LucideIcon
  options: string[]
  value: string[]
  onChange: (next: string[]) => void
  optionLabel?: (option: string) => string
}) {
  const [open, setOpen] = useState(false)
  const ref = useDismissible(open, () => setOpen(false))
  const text =
    value.length === 0 ? allLabel : value.length === 1 ? optionLabel(value[0]) : `${name} · ${value.length}`

  return (
    <div
      ref={ref}
      className="relative shrink-0"
      onKeyDown={(event) => {
        // Esc closes this menu only, not the detail drawer behind it.
        if (event.key === 'Escape' && open) {
          event.stopPropagation()
          setOpen(false)
        }
      }}
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${name}篩選：${text}`}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-foreground outline-none transition-colors motion-reduce:transition-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="max-w-40 truncate">{text}</span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={`${name}篩選`}
          className="absolute left-0 top-8 z-20 max-h-80 w-56 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={value.length === 0}
            onClick={() => onChange([])}
            className={cn('focus-visible:ring-[3px] focus-visible:ring-ring/50', MENU_ITEM, 'hover:bg-accent hover:text-accent-foreground')}
          >
            <span className="min-w-0 flex-1 truncate">{allLabel}</span>
            {value.length === 0 && <Check className="size-3 shrink-0" />}
          </button>
          {options.map((option) => {
            const checked = value.includes(option)
            return (
              <button
                key={option}
                type="button"
                role="menuitemcheckbox"
                aria-checked={checked}
                onClick={() => onChange(toggleValue(value, option))}
                className={cn('focus-visible:ring-[3px] focus-visible:ring-ring/50', MENU_ITEM, 'hover:bg-accent hover:text-accent-foreground')}
              >
                <span className="min-w-0 flex-1 truncate">{optionLabel(option)}</span>
                {checked && <Check className="size-3 shrink-0" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
