import { useState, type DragEvent } from 'react'
import { Network, PanelLeftClose, PanelLeftOpen } from 'lucide-react'

import { branchLabel, TaskId } from '@/components/board-columns'
import { activityMark, StatusMark, TaskProgressChip } from '@/components/task-progress'
import { IconButton } from '@/components/ui/icon-button'
import { SECTION_LABEL } from '@/components/ui/section-label'
import { TagChips } from '@/components/task-tags'
import { cn } from '@/lib/utils'
import type { Task, TaskProgress } from '@/lib/types'

interface WorkspaceTaskRailProps {
  /** The In Progress column, in board order. */
  running: Task[]
  selectedTaskId: string | null
  progress: Record<string, TaskProgress>
  onSelect: (taskId: string) => void
  /** Reorder a card within In Progress; `beforeId` null = the column's end. */
  onMoveTask: (taskId: string, beforeId: string | null) => void
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
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
  selectedTaskId,
  progress,
  onSelect,
  onMoveTask,
  collapsed,
  onCollapsedChange,
}: WorkspaceTaskRailProps) {
  const rows = orderRunning(running)
  const [dragId, setDragId] = useState<string | null>(null)
  // Where the dragged card would land among its group: before `before`, or at the group's end (null).
  const [aim, setAim] = useState<{ group: string; before: string | null } | null>(null)

  // A master's running cards move only among themselves; the rest (masters
  // included, which carry their cards along) move among each other.
  const ids = new Set(running.map((t) => t.id))
  const groupOf = (t: Task) => (t.masterId && ids.has(t.masterId) ? t.masterId : '')
  const members = (group: string) => running.filter((t) => groupOf(t) === group)
  const dragged = running.find((t) => t.id === dragId)
  const endDrag = () => {
    setDragId(null)
    setAim(null)
  }
  const aimAt = (event: DragEvent<HTMLDivElement>, task: Task) => {
    if (!dragged || groupOf(dragged) !== groupOf(task)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const rect = event.currentTarget.getBoundingClientRect()
    const group = groupOf(task)
    const peers = members(group)
    const before = event.clientY < rect.top + rect.height / 2 ? task.id : peers[peers.indexOf(task) + 1]?.id ?? null
    if (aim?.group !== group || aim.before !== before) setAim({ group, before })
  }
  const drop = () => {
    if (!dragged || !aim) return
    const rest = running.filter((t) => t.id !== dragged.id)
    let beforeId = aim.before
    if (beforeId === null) {
      // The group's end, in the column: right after its last other member.
      const last = members(aim.group).filter((t) => t.id !== dragged.id).at(-1)
      beforeId = last ? rest[rest.indexOf(last) + 1]?.id ?? null : null
    }
    const next = running[running.indexOf(dragged) + 1]?.id ?? null
    if (beforeId !== dragged.id && beforeId !== next) onMoveTask(dragged.id, beforeId)
  }
  /** The last row drawn for a group: a master's block ends with its cards. */
  const groupEndRow = (group: string) =>
    group === '' ? rows.at(-1)?.task.id : members(group).at(-1)?.id

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
        {rows.map(({ task }) => {
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
              <StatusMark {...activityMark(progress[task.id]?.activity)} className="size-2" />
            </button>
          )
        })}
      </nav>
    )
  }

  const row = (task: Task, branch: Branch) => {
    const selected = task.id === selectedTaskId
    const isMaster = task.role === 'master'
    const button = (
      <button
        type="button"
        aria-current={selected ? 'page' : undefined}
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
              <StatusMark {...activityMark(progress[task.id]?.activity)} />
            </span>
          )}
          <span className="min-w-0 flex-1 truncate">{task.title}</span>
          <TaskId id={task.id} className="font-normal" />
        </span>
        {!isMaster && (
          <span className="min-w-0 truncate pl-[22px] text-xs" title={task.projectPath}>
            {task.projectName ?? ''}
          </span>
        )}
        <span className="flex min-w-0 items-center gap-2 pl-[22px] text-xs">
          <span className="min-w-0 truncate font-mono" title={task.branch || undefined}>
            {isMaster ? 'Master' : branchLabel(task)}
          </span>
          <TaskProgressChip progress={progress[task.id]} mark={isMaster} />
        </span>
        <TagChips task={task} className="pl-[22px]" />
      </button>
    )
    const lineBefore = aim?.before === task.id
    const lineAfter = aim !== null && aim.before === null && groupEndRow(aim.group) === task.id
    return (
      <div
        key={task.id}
        draggable
        title={task.title}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', task.id)
          setDragId(task.id)
        }}
        onDragEnd={endDrag}
        onDragOver={(event) => aimAt(event, task)}
        onDrop={(event) => {
          event.preventDefault()
          drop()
          endDrag()
        }}
        className={cn('relative', branch !== 'none' && 'pl-7', dragId === task.id && 'opacity-50')}
      >
        {branch !== 'none' && <TreeLine branch={branch} />}
        {lineBefore && <span aria-hidden="true" className="pointer-events-none absolute -top-[3px] inset-x-0 h-0.5 rounded-full bg-primary" />}
        {button}
        {lineAfter && <span aria-hidden="true" className="pointer-events-none absolute -bottom-[3px] inset-x-0 h-0.5 rounded-full bg-primary" />}
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
        {rows.map(({ task, branch }) => row(task, branch))}
        {rows.length === 0 && (
          <p className="px-2 py-3 text-sm text-muted-foreground">目前沒有進行中的任務</p>
        )}
      </div>
    </nav>
  )
}
