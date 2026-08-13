import { X } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { ColumnId } from '@/lib/types'

export interface TerminalTab {
  taskId: string
  /**
   * VSCode-style preview tab: shown in italics and replaced *in place* by the
   * next preview tab, until an interaction (or a double click) pins it.
   */
  preview: boolean
}

export interface TerminalTabEntry extends TerminalTab {
  title: string
  column: ColumnId
}

interface TerminalTabBarProps {
  entries: TerminalTabEntry[]
  activeTaskId: string | null
  onSelect: (taskId: string) => void
  onPin: (taskId: string) => void
  onClose: (taskId: string) => void
}

export function TerminalTabBar({
  entries,
  activeTaskId,
  onSelect,
  onPin,
  onClose,
}: TerminalTabBarProps) {
  if (entries.length === 0) return null

  return (
    <div className="flex h-9 shrink-0 items-stretch overflow-x-auto overflow-y-hidden border-b border-border bg-card/40">
      {entries.map((entry) => {
        const active = entry.taskId === activeTaskId
        return (
          <div
            key={entry.taskId}
            className={cn(
              'group flex h-full min-w-0 max-w-52 shrink-0 items-center gap-1 border-r border-border/60 pl-3 pr-1.5 transition-colors motion-reduce:transition-none',
              active
                ? 'bg-background text-foreground'
                : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'
            )}
          >
            <button
              type="button"
              aria-current={active ? 'page' : undefined}
              title={entry.title}
              onClick={() => onSelect(entry.taskId)}
              onDoubleClick={() => onPin(entry.taskId)}
              onAuxClick={(event) => {
                if (event.button === 1) onClose(entry.taskId)
              }}
              className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm py-0.5 text-left text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <span
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  entry.column === 'in_progress'
                    ? 'bg-warning animate-pulse'
                    : 'bg-muted-foreground/50'
                )}
              />
              <span className={cn('min-w-0 truncate', entry.preview && 'italic')}>
                {entry.title}
              </span>
            </button>
            <button
              type="button"
              aria-label={`關閉分頁 ${entry.title}`}
              title="關閉分頁（執行中的 agent 會繼續在背景執行）"
              onClick={() => onClose(entry.taskId)}
              className={cn(
                'flex size-5 shrink-0 items-center justify-center rounded-sm outline-none transition-colors motion-reduce:transition-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:opacity-100',
                active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              )}
            >
              <X className="size-3" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
