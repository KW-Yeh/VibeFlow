import { cn } from '@/lib/utils'

export type BoardView = 'board' | 'github'

const VIEWS: { id: BoardView; label: string }[] = [
  { id: 'board', label: '看板' },
  { id: 'github', label: '工作項目' },
]

/** The「看板 ｜ 工作項目」switch heading the top pane, shared by both views. */
export function ViewTabs({
  value,
  onChange,
}: {
  value: BoardView
  onChange: (next: BoardView) => void
}) {
  return (
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
              '-mb-px flex items-center border-b-2 px-1 text-sm font-medium outline-none transition-colors motion-reduce:transition-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              active
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {view.label}
          </button>
        )
      })}
    </div>
  )
}
