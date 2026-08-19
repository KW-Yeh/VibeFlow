import {
  Check,
  ChevronDown,
  CircleCheckBig,
  GitBranch,
  Layers,
  ListChecks,
  MessageCircleQuestionMark,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  Users,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { SECTION_LABEL } from '@/components/ui/section-label'
import { IconButton } from '@/components/ui/icon-button'
import { isTaskComplete } from '@/lib/claude'
import { cn } from '@/lib/utils'
import type { BoardState, ColumnId, Role, SubAgentRun, Task } from '@/lib/types'

const COLUMNS: ColumnId[] = ['backlog', 'in_progress', 'done']

const COLUMN_LABEL: Record<ColumnId, string> = {
  backlog: 'Backlog',
  in_progress: 'In Progress',
  done: 'Done',
}

const COLUMN_DOT: Record<ColumnId, string> = {
  backlog: 'bg-muted-foreground/60',
  in_progress: 'bg-warning animate-pulse',
  done: 'bg-success',
}

/** Execution stage a card is in, derived from the agent-maintained progress file. */
type Stage = 'planning' | 'executing' | 'needs-input'

function stageOf(task: Task): Stage {
  if (task.progress?.needsUserInput) return 'needs-input'
  return task.progress?.planDone === true ? 'executing' : 'planning'
}

/** Elapsed run time, coarse on purpose — the board ticks every 30s, not every second. */
function formatElapsed(since: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - since) / 60000))
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`
}

function projectLabel(task: Task): string {
  if (task.projectName) return task.projectName
  const parts = (task.projectPath ?? '').split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] ?? '未指定專案'
}

/** Popover that closes on outside click or Esc. Shared by the card and filter menus. */
function useDismissible(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) close()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, close])
  return ref
}

const MENU_ITEM =
  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors motion-reduce:transition-none'

/** w-52 plus the room the menu needs; used to keep it inside the viewport. */
const MENU_WIDTH = 208
const MENU_HEIGHT = 224

function CardMenu({
  task,
  anchor,
  onEdit,
  onDelete,
  onClose,
}: {
  task: Task
  /** Viewport rect of the card. The menu is fixed-positioned because the
      column it lives in scrolls, and an absolute menu would be clipped. */
  anchor: { top: number; right: number }
  onEdit: () => void
  onDelete: () => void
  onClose: () => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const ref = useDismissible(true, onClose)
  // Keep the menu on screen for cards near the right edge or the splitter.
  const left = Math.max(8, Math.min(anchor.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8))
  const top = Math.max(8, Math.min(anchor.top, window.innerHeight - MENU_HEIGHT))

  return (
    <div
      ref={ref}
      role="menu"
      style={{ top, left }}
      // The menu is a DOM child of the card, which is itself clickable.
      onClick={(event) => event.stopPropagation()}
      className="fixed z-50 w-52 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onEdit()
          onClose()
        }}
        className={cn('focus-visible:ring-[3px] focus-visible:ring-ring/50', MENU_ITEM, 'hover:bg-accent hover:text-accent-foreground')}
      >
        <Pencil className="size-3.5 shrink-0" />
        編輯任務
      </button>

      {confirmDelete ? (
        <div className="flex items-center gap-1 rounded-sm bg-destructive/10 p-1">
          <button
            type="button"
            onClick={() => setConfirmDelete(false)}
            className="rounded-sm px-2 py-1 text-sm text-muted-foreground outline-none transition-colors motion-reduce:transition-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => {
              onDelete()
              onClose()
            }}
            className="ml-auto rounded-sm px-2 py-1 text-sm font-medium text-destructive outline-none transition-colors motion-reduce:transition-none hover:bg-destructive/15 focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            確認刪除
          </button>
        </div>
      ) : (
        <button
          type="button"
          role="menuitem"
          onClick={() => setConfirmDelete(true)}
          className={cn('focus-visible:ring-[3px] focus-visible:ring-ring/50', MENU_ITEM, 'text-destructive hover:bg-destructive/15')}
          title={`刪除任務「${task.title}」（清理 worktree）`}
        >
          <Trash2 className="size-3.5 shrink-0" />
          刪除任務
        </button>
      )}
    </div>
  )
}

function TaskCard({
  task,
  column,
  role,
  subAgentCount,
  selected,
  now,
  onSelect,
  onEdit,
  onDelete,
}: {
  task: Task
  column: ColumnId
  role: Role | null
  subAgentCount: number
  selected: boolean
  now: number
  onSelect: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; right: number } | null>(
    null
  )
  const menuOpen = menuAnchor !== null
  const complete = isTaskComplete(task)
  const stage = stageOf(task)
  const steps = task.progress?.steps ?? []
  const doneSteps = steps.filter((step) => step.done).length
  const running = column === 'in_progress'
  const done = column === 'done'
  const currentStep = steps.find((step) => !step.done)

  return (
    <div
      ref={cardRef}
      role="button"
      tabIndex={0}
      aria-label={`開啟任務：${task.title}`}
      onClick={onSelect}
      onKeyDown={(event) => {
        // Only when the card itself has focus — Enter on the actions menu
        // inside it must not also open the task.
        if (event.target !== event.currentTarget) return
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onSelect()
      }}
      className={cn(
        'relative cursor-pointer rounded-md border bg-card p-3 outline-none transition-colors motion-reduce:transition-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        done && 'bg-card/60',
        selected
          ? 'border-primary shadow-[0_0_0_2px] shadow-primary/20'
          : stage === 'needs-input' && running
            ? 'border-warning/35'
            : 'border-border hover:border-input'
      )}
    >
      {/* Header: project · effort, swapped for the actions menu on hover. */}
      <div className="group/head flex items-center gap-1.5 text-xs text-muted-foreground">
        <Layers className="size-3 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{projectLabel(task)}</span>
        {done && complete ? (
          <span className="flex shrink-0 items-center gap-1 rounded-xs bg-primary/15 px-1.5 py-0.5 font-medium text-primary">
            <CircleCheckBig className="size-2.5" />
            complete
          </span>
        ) : (
          <>
            {task.effort && (
              <span
                className={cn(
                  'shrink-0 rounded-xs bg-secondary px-1.5 py-0.5 font-medium',
                  menuOpen ? 'hidden' : 'group-hover/head:hidden'
                )}
              >
                {task.effort}
              </span>
            )}
            <IconButton
              aria-label={`任務選項：${task.title}`}
              title="移動、編輯或刪除"
              onClick={(event) => {
                event.stopPropagation()
                if (menuOpen) {
                  setMenuAnchor(null)
                  return
                }
                // Anchor to the card, not the trigger: the trigger is
                // hover-revealed, so its rect is empty when it is still hidden.
                const rect = cardRef.current?.getBoundingClientRect()
                if (!rect) return
                setMenuAnchor({ top: rect.top + 32, right: rect.right - 4 })
              }}
              className={cn(
                'size-5 p-0.5',
                menuOpen ? 'flex' : 'hidden group-hover/head:flex'
              )}
            >
              <MoreHorizontal className="size-3.5" />
            </IconButton>
          </>
        )}
      </div>

      {/* Body: the whole card selects the task; the menu above stops propagation. */}
      <div className="mt-2" title={task.title}>
        <span
          className={cn(
            'line-clamp-2 text-[15px] font-medium leading-[1.4]',
            done ? 'text-muted-foreground' : 'text-foreground'
          )}
        >
          {task.title}
        </span>
      </div>

      {running && (
        <div className="mt-2 space-y-2">
          {stage === 'needs-input' ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-2 py-1 text-xs font-medium text-warning">
              <MessageCircleQuestionMark className="size-3" />
              需要你回覆
            </span>
          ) : stage === 'executing' ? (
            <>
              <div className="flex items-center gap-1.5 text-xs">
                <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-warning" />
                <span className="font-medium text-warning">Executing</span>
                {steps.length > 0 && (
                  <span className="ml-auto tabular-nums text-muted-foreground">
                    {doneSteps}/{steps.length}
                  </span>
                )}
              </div>
              {steps.length > 0 && (
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${(doneSteps / steps.length) * 100}%` }}
                  />
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <ListChecks className="size-3 shrink-0" />
              Planning
            </div>
          )}

          {task.progress?.summary && (
            <p className="line-clamp-2 text-xs leading-[1.45] text-muted-foreground">
              {task.progress.summary}
            </p>
          )}

          {/* Live run state. Everything here comes from the progress file the
              agent maintains — the board has no access to terminal output. */}
          {task.launchedAt && stage !== 'needs-input' && (
            <div className="flex items-center gap-1.5 rounded-sm bg-background px-2 py-1.5 font-mono text-[11px] leading-4 text-muted-foreground">
              <span className="size-1 shrink-0 animate-pulse rounded-full bg-success" />
              <span className="min-w-0 flex-1 truncate">
                {currentStep?.text ?? '等待 agent 回報進度…'}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground/70">
                {formatElapsed(task.launchedAt, now)}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <GitBranch className="size-3 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{task.branch}</span>
        {running && subAgentCount > 0 && (
          <span className="flex shrink-0 items-center gap-1">
            <Users className="size-3" />
            {subAgentCount}
          </span>
        )}
      </div>

      {role && !done && (
        <div className="mt-2">
          <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
            {role.name}
          </span>
        </div>
      )}

      {menuAnchor && (
        <CardMenu
          task={task}
          anchor={menuAnchor}
          onEdit={onEdit}
          onDelete={onDelete}
          onClose={() => setMenuAnchor(null)}
        />
      )}
    </div>
  )
}

function ProjectFilter({
  projects,
  value,
  onChange,
}: {
  projects: string[]
  value: string | null
  onChange: (next: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useDismissible(open, () => setOpen(false))

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-foreground outline-none transition-colors motion-reduce:transition-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <Layers className="size-3.5 shrink-0 text-muted-foreground" />
        {value ?? '所有專案'}
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <div
          ref={ref}
          role="menu"
          className="absolute left-0 top-8 z-20 w-56 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {[null, ...projects].map((project) => (
            <button
              key={project ?? '__all__'}
              type="button"
              role="menuitem"
              onClick={() => {
                onChange(project)
                setOpen(false)
              }}
              className={cn('focus-visible:ring-[3px] focus-visible:ring-ring/50', MENU_ITEM, 'hover:bg-accent hover:text-accent-foreground')}
            >
              <span className="min-w-0 flex-1 truncate">{project ?? '所有專案'}</span>
              {project === value && <Check className="size-3 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export interface BoardColumnsProps {
  board: BoardState
  roles: Role[]
  subAgents: Record<string, SubAgentRun[]>
  selectedTaskId: string | null
  onSelectTask: (taskId: string) => void
  onEditTask: (taskId: string) => void
  onDeleteTask: (taskId: string) => void
  onNewTask: () => void
}

export function BoardColumns({
  board,
  roles,
  subAgents,
  selectedTaskId,
  onSelectTask,
  onEditTask,
  onDeleteTask,
  onNewTask,
}: BoardColumnsProps) {
  const [projectFilter, setProjectFilter] = useState<string | null>(null)
  // Run times are shown to the minute, so a 30s tick is enough to keep them honest.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const allTasks = [...board.backlog, ...board.in_progress, ...board.done]
  const projects = Array.from(new Set(allTasks.map(projectLabel))).sort((a, b) =>
    a.localeCompare(b)
  )
  // A filter that no longer matches any task would silently empty the board.
  const activeFilter = projectFilter && projects.includes(projectFilter) ? projectFilter : null

  const visible = (column: ColumnId) =>
    activeFilter
      ? board[column].filter((task) => projectLabel(task) === activeFilter)
      : board[column]

  const roleById = (id?: string): Role | null =>
    (id && roles.find((r) => r.id === id)) || null

  const total = allTasks.length

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-5">
        <ProjectFilter
          projects={projects}
          value={activeFilter}
          onChange={setProjectFilter}
        />
        <span className="text-sm tabular-nums text-muted-foreground">
          {total} 個任務 · {projects.length} 個專案
        </span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-3 gap-4 overflow-hidden px-5 pb-4 pt-3">
        {COLUMNS.map((column) => {
          const tasks = visible(column)
          return (
            <section key={column} className="flex min-h-0 flex-col gap-2">
              <div className="flex shrink-0 items-center gap-2 px-1">
                <span
                  className={cn('size-1.5 shrink-0 rounded-full', COLUMN_DOT[column])}
                />
                <h2
                  className={cn(SECTION_LABEL, column === 'in_progress' && 'text-warning')}
                >
                  {COLUMN_LABEL[column]}
                </h2>
                <span className="text-xs tabular-nums text-muted-foreground/80">
                  {tasks.length}
                </span>
              </div>

              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-md p-1">
                {tasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    column={column}
                    role={roleById(task.roleId)}
                    subAgentCount={(subAgents[task.id] ?? []).length}
                    selected={task.id === selectedTaskId}
                    now={now}
                    onSelect={() => onSelectTask(task.id)}
                    onEdit={() => onEditTask(task.id)}
                    onDelete={() => onDeleteTask(task.id)}
                  />
                ))}

                {column === 'backlog' && (
                  <button
                    type="button"
                    onClick={onNewTask}
                    className="flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-2.5 text-sm text-muted-foreground outline-none transition-colors motion-reduce:transition-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <Plus className="size-3.5" />
                    新增任務
                  </button>
                )}

                {tasks.length === 0 && column !== 'backlog' && (
                  <p className="px-2 py-1 text-sm text-muted-foreground/60">尚無任務</p>
                )}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
