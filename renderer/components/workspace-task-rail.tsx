import { Eye, Network, PanelLeftClose, PanelLeftOpen } from 'lucide-react'

import { TaskId } from '@/components/board-columns'
import { activityMark, StatusMark, TaskProgressChip } from '@/components/task-progress'
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

function statusMark(progress: TaskProgress | undefined, column: ColumnId) {
  if (column === 'backlog') return { dot: 'bg-muted-foreground/60', label: COLUMN_NAME.backlog }
  if (column === 'done') return { dot: 'bg-success', label: COLUMN_NAME.done }
  return activityMark(progress?.activity)
}

type Branch = 'none' | 'middle' | 'last'

/** Running cards first, each master followed by its own running slaves. */
function orderRunning(running: Task[]): { task: Task; branch: Branch }[] {
  const ids = new Set(running.map((t) => t.id))
  const nested = (t: Task) => Boolean(t.masterId && ids.has(t.masterId))
  return running
    .filter((t) => !nested(t))
    .flatMap((t) => {
      const slaves = running.filter((s) => s.masterId === t.id)
      return [
        { task: t, branch: 'none' as const },
        ...slaves.map((s, i) => ({ task: s, branch: i === slaves.length - 1 ? ('last' as const) : ('middle' as const) })),
      ]
    })
}

/** The file-tree connector from a master down to one of its slaves. */
function TreeLine({ branch }: { branch: Exclude<Branch, 'none'> }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute -top-1 left-[18px] w-2.5 border-l border-master/50',
        branch === 'last' ? 'h-6' : '-bottom-1'
      )}
    >
      <span className="absolute left-0 top-[23px] w-full border-t border-master/50" />
    </span>
  )
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
              <StatusMark {...statusMark(progress[task.id], column)} className="size-2" />
            </button>
          )
        })}
      </nav>
    )
  }

  const row = (task: Task, column: ColumnId, branch: Branch) => {
    const selected = task.id === selectedTaskId
    const isMaster = task.role === 'master'
    const button = (
      <button
        key={task.id}
        type="button"
        aria-current={selected ? 'page' : undefined}
        title={task.title}
        onClick={() => onSelect(task.id)}
        className={cn(
          'flex w-full min-w-0 flex-col gap-1 rounded-md border px-2.5 py-2 text-left outline-none transition-colors motion-reduce:transition-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
          selected
            ? 'border-primary/60 bg-accent text-foreground'
            : 'border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground'
        )}
      >
        <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
          {isMaster ? (
            <Network className="size-3.5 shrink-0 text-master" />
          ) : (
            <span className="flex w-3.5 shrink-0 justify-center">
              <StatusMark {...statusMark(progress[task.id], column)} />
            </span>
          )}
          <span className="min-w-0 flex-1 truncate">{task.title}</span>
          <TaskId id={task.id} className="font-normal" />
        </span>
        <span className="flex min-w-0 items-center gap-2 pl-[22px] text-xs">
          <span className="min-w-0 truncate">
            {column === 'in_progress' ? (isMaster ? 'Master' : task.projectName ?? '') : COLUMN_NAME[column]}
          </span>
          {column === 'in_progress' && <TaskProgressChip progress={progress[task.id]} mark={isMaster} />}
        </span>
      </button>
    )
    if (branch === 'none') return button
    return (
      <div key={task.id} className="relative pl-7">
        <TreeLine branch={branch} />
        {button}
      </div>
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
            {row(viewing.task, viewing.column, 'none')}
          </div>
        )}
        {rows.map(({ task, branch }) => row(task, 'in_progress', branch))}
        {rows.length === 0 && (
          <p className="px-2 py-3 text-sm text-muted-foreground">目前沒有進行中的任務</p>
        )}
      </div>
    </nav>
  )
}
