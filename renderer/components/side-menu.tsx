import { Inbox, Plus, Settings, Smartphone, SquareKanban, Terminal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { IconButton } from '@/components/ui/icon-button'
import type { BoardView } from '@/components/ui/view-tabs'

interface SideMenuProps {
  view: BoardView
  onSelectView: (view: BoardView) => void
  onNewTask: () => void
  onRemoteShare?: () => void
  remoteActive?: boolean
  onOpenSettings: () => void
}

export function SideMenu({
  view,
  onSelectView,
  onNewTask,
  onRemoteShare,
  remoteActive,
  onOpenSettings,
}: SideMenuProps) {
  return (
    <aside className="flex w-12 flex-shrink-0 flex-col overflow-hidden border-r border-border bg-card text-card-foreground">
      <div className="flex h-12 shrink-0 items-center justify-center border-b border-border">
        <img src="/logo.svg" alt="VibeFlow" className="size-5" />
      </div>

      <div className="flex shrink-0 justify-center px-2 pt-3">
        <IconButton aria-label="新增任務" onClick={onNewTask} title="新增任務" className="size-8 p-1.5">
          <Plus className="size-4" />
        </IconButton>
      </div>

      <nav aria-label="檢視" className="flex flex-1 flex-col items-center gap-1 px-2 py-3">
        <IconButton
          aria-label="看板"
          aria-current={view === 'board' ? 'page' : undefined}
          title="看板"
          onClick={() => onSelectView('board')}
          className={cn('size-8', view === 'board' && 'text-primary hover:text-primary')}
        >
          <SquareKanban className="size-4" />
        </IconButton>
        <IconButton
          aria-label="工作項目"
          aria-current={view === 'github' ? 'page' : undefined}
          title="工作項目"
          onClick={() => onSelectView('github')}
          className={cn('size-8', view === 'github' && 'text-primary hover:text-primary')}
        >
          <Inbox className="size-4" />
        </IconButton>
        <IconButton
          aria-label="終端機"
          aria-current={view === 'terminals' ? 'page' : undefined}
          title="終端機"
          onClick={() => onSelectView('terminals')}
          className={cn('size-8', view === 'terminals' && 'text-primary hover:text-primary')}
        >
          <Terminal className="size-4" />
        </IconButton>
      </nav>

      <div className="flex flex-col items-center gap-1 border-t border-border p-2">
        {onRemoteShare && (
          <IconButton
            aria-label="遠端控制"
            onClick={onRemoteShare}
            title="遠端控制"
            className={cn('size-8', remoteActive && 'text-primary hover:text-primary')}
          >
            <Smartphone className="size-4" />
          </IconButton>
        )}
        <IconButton
          aria-label="設定 System Prompt"
          onClick={onOpenSettings}
          title="設定（System Prompt）"
          className="size-8"
        >
          <Settings className="size-4" />
        </IconButton>
      </div>
    </aside>
  )
}
