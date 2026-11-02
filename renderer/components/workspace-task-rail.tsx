import { Eye, Network, PanelLeftClose, PanelLeftOpen } from 'lucide-react'

import { TaskProgressChip } from '@/components/task-progress'
import { IconButton } from '@/components/ui/icon-button'
import { SECTION_LABEL } from '@/components/ui/section-label'
import { cn } from '@/lib/utils'
import type { ColumnId, Task, TaskProgress } from '@/lib/types'

interface WorkspaceTaskRailProps {
  /** The In Progress column, in board order. */
  running: Task[]
  /** The selected card when it is not running: shown on top until another card is picked. */
  viewing: { task: Task; column: ColumnId } | null
  selectedTaskId: string | null
  progress: Record<string, TaskProgress>
  onSelect: (taskId: string) => void
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
}

const COLUMN_NAME: Record<ColumnId, string> = {
  backlog: 'Backlog',
  in_progress: 'In Progress',
  done: 'Done',
}

function statusDot(task: Task, progress: TaskProgress | undefined, column: ColumnId): string {
  if (column === 'backlog') return 'bg-muted-foreground/60'
  if (column === 'done') return 'bg-success'
  if (progress?.activity.state === 'waiting') return 'bg-primary'
  return task.role === 'master' ? 'bg-master animate-pulse' : 'bg-warning animate-pulse'
}

/** Running cards first, each master followed by its own running slaves. */
function orderRunning(running: Task[]): { task: Task; nested: boolean }[] {
  const ids = new Set(running.map((t) => t.id))
  const nested = (t: Task) => Boolean(t.masterId && ids.has(t.masterId))
  return running
    .filter((t) => !nested(t))
    .flatMap((t) => [
      { task: t, nested: false },
      ...running.filter((s) => s.masterId === t.id).map((s) => ({ task: s, nested: true })),
    ])
}

export function WorkspaceTaskRail({
  running,
  viewing,
  selectedTaskId,
  progress,
  onSelect,
  collapsed,
  onCollapsedChange,
}: WorkspaceTaskRailProps) {
  const rows = orderRunning(running)

  if (collapsed) {
    return (
      <nav
        aria-label="進行中的任務"
        className="flex w-11 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-border bg-card/40 py-1.5"
      >
        <IconButton
          aria-label="展開任務清單"
          title="展開任務清單"
          className="mb-1 size-8 rounded-md"
          onClick={() => onCollapsedChange(false)}
        >
          <PanelLeftOpen className="size-4" />
        </IconButton>
        {[...(viewing ? [{ task: viewing.task, column: viewing.column }] : []),
          ...rows.map(({ task }) => ({ task, column: 'in_progress' as const }))].map(({ task, column }) => {
          const selected = task.id === selectedTaskId
          return (
            <button
              key={task.id}
              type="button"
              aria-label={task.title}
              aria-current={selected ? 'page' : undefined}
              title={task.title}
              onClick={() => onSelect(task.id)}
              className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-md outline-none transition-colors motion-reduce:transition-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                selected ? 'bg-primary/15' : 'hover:bg-accent'
              )}
            >
              <span className={cn('size-2 rounded-full', statusDot(task, progress[task.id], column))} />
            </button>
          )
        })}
      </nav>
    )
  }

  const row = (task: Task, column: ColumnId, nested: boolean) => {
    const selected = task.id === selectedTaskId
    const isMaster = task.role === 'master'
    return (
      <button
        key={task.id}
        type="button"
        aria-current={selected ? 'page' : undefined}
        title={task.title}
        onClick={() => onSelect(task.id)}
        className={cn(
          'flex w-full min-w-0 flex-col gap-1 rounded-md border px-2.5 py-2 text-left outline-none transition-colors motion-reduce:transition-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
          nested && 'ml-4 w-[calc(100%-1rem)]',
          selected
            ? 'border-primary/60 bg-accent text-foreground'
            : 'border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground'
        )}
      >
        <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
          {isMaster ? (
            <Network className="size-3.5 shrink-0 text-master" />
          ) : (
            <span className={cn('size-1.5 shrink-0 rounded-full', statusDot(task, progress[task.id], column))} />
          )}
          <span className="min-w-0 truncate">{task.title}</span>
        </span>
        <span className="flex min-w-0 items-center gap-2 pl-3.5 text-xs">
          <span className="min-w-0 truncate">
            {column === 'in_progress' ? (isMaster ? 'Master' : task.projectName ?? '') : COLUMN_NAME[column]}
          </span>
          {column === 'in_progress' && <TaskProgressChip progress={progress[task.id]} />}
        </span>
      </button>
    )
  }

  return (
    <nav
      aria-label="進行中的任務"
      className="flex w-64 shrink-0 flex-col border-r border-border bg-card/40"
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border pl-3 pr-1.5">
        <span className="size-1.5 shrink-0 rounded-full bg-warning" />
        <h2 className={cn(SECTION_LABEL, 'text-warning')}>In Progress</h2>
        <span className="text-xs tabular-nums text-muted-foreground/80">{running.length}</span>
        <span className="flex-1" />
        <IconButton
          aria-label="收合任務清單"
          title="收合任務清單，讓終端機更寬"
          className="p-1"
          onClick={() => onCollapsedChange(true)}
        >
          <PanelLeftClose className="size-3.5" />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-1.5">
        {viewing && (
          <div className="mb-2 space-y-1 border-b border-border pb-2">
            <p className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
              <Eye className="size-3" />
              目前檢視
            </p>
            {row(viewing.task, viewing.column, false)}
          </div>
        )}
        {rows.map(({ task, nested }) => row(task, 'in_progress', nested))}
        {rows.length === 0 && (
          <p className="px-2 py-3 text-sm text-muted-foreground">目前沒有進行中的任務</p>
        )}
      </div>
    </nav>
  )
}
