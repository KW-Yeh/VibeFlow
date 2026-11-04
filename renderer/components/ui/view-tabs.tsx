import { useId } from 'react'
import { LayoutGroup } from 'motion/react'

import { TabIndicator } from '@/components/ui/tab-indicator'
import { cn } from '@/lib/utils'

export type BoardView = 'board' | 'workspace' | 'github' | 'terminals'

const VIEWS: { id: BoardView; label: string }[] = [
  { id: 'board', label: '看板' },
  { id: 'workspace', label: '工作區' },
  { id: 'github', label: '工作項目' },
  { id: 'terminals', label: '終端機' },
]

/** The「看板 ｜ 工作項目」switch heading the top pane, shared by both views. */
export function ViewTabs({
  value,
  onChange,
}: {
  value: BoardView
  onChange: (next: BoardView) => void
}) {
  const group = useId()
  return (
    <LayoutGroup id={group}>
    <div role="tablist" aria-label="檢視" className="flex h-full items-stretch gap-4">
      {VIEWS.map((view) => {
        const active = view.id === value
        return (
          <button
            key={view.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(view.id)}
            className={cn(
              'relative flex items-center px-1 text-sm font-medium outline-none transition-colors motion-reduce:transition-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {view.label}
            {active && (
              <TabIndicator layoutId="view-tab" className="inset-x-0 -bottom-px h-0.5 rounded-full bg-primary" />
            )}
          </button>
        )
      })}
    </div>
    </LayoutGroup>
  )
}
