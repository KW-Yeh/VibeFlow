import {
  Check,
  ChevronDown,
  CircleCheckBig,
  CircleDot,
  GitBranch,
  GitPullRequest,
  GitPullRequestDraft,
  Layers,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  Terminal,
  Users,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { SECTION_LABEL } from '@/components/ui/section-label'
import { IconButton } from '@/components/ui/icon-button'
import { ViewTabs, type BoardView } from '@/components/ui/view-tabs'
import { openExternal } from '@/lib/api'
import { GITHUB_STATE_CLASS, GITHUB_STATE_LABEL } from '@/lib/github-display'
import { cn } from '@/lib/utils'
import type {
  BoardState,
  ColumnId,
  GithubLink,
  GithubTaskLinks,
  SubAgentRun,
  Task,
  TaskProgress,
} from '@/lib/types'
import { TaskProgressBadge } from '@/components/task-progress'

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

function projectLabel(task: Task): string {
  if (task.projectName) return task.projectName
  const parts = (task.projectPath ?? '').split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] ?? '未指定專案'
}

/** Popover that closes on outside click or Esc. Shared by the card and filter menus. */
export function useDismissible(open: boolean, close: () => void) {
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

export const MENU_ITEM =
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
  /** Absent = the card is read-only (only Backlog cards are editable). */
  onEdit?: () => void
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
      {onEdit && (
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
      )}

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

function GithubLinkButton({ link }: { link: GithubLink }) {
  const Icon =
    link.kind === 'issue' ? CircleDot : link.state === 'draft' ? GitPullRequestDraft : GitPullRequest
  const kind = link.kind === 'issue' ? 'Issue' : 'PR'
  return (
    <button
      type="button"
      title={`${kind} #${link.number} · ${GITHUB_STATE_LABEL[link.state]}（在 GitHub 開啟）`}
      aria-label={`在 GitHub 開啟 ${kind} #${link.number}`}
      onClick={(event) => {
        event.stopPropagation()
        void openExternal(link.url)
      }}
      className={cn(
        'flex shrink-0 items-center gap-0.5 rounded-xs outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50',
        GITHUB_STATE_CLASS[link.state]
      )}
    >
      <Icon className="size-3" />#{link.number}
    </button>
  )
}

function TaskCard({
  task,
  column,
  subAgentCount,
  progress,
  links,
  selected,
  onSelect,
  onEdit,
  onDelete,
  onOpenTerminal,
}: {
  task: Task
  column: ColumnId
  subAgentCount: number
  progress: TaskProgress | null
  links?: GithubTaskLinks
  selected: boolean
  onSelect: () => void
  onEdit?: () => void
  onDelete: () => void
  onOpenTerminal: () => void
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; right: number } | null>(
    null
  )
  const menuOpen = menuAnchor !== null
  const running = column === 'in_progress'
  const done = column === 'done'

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
          : 'border-border hover:border-input'
      )}
    >
      {/* Header: project · effort, swapped for the actions menu on hover. */}
      <div className="group/head flex items-center gap-1.5 text-xs text-muted-foreground">
        <Layers className="size-3 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{projectLabel(task)}</span>
        <IconButton
          aria-label={`在專案目錄開啟 Terminal：${task.title}`}
          title="在專案目錄開啟額外 Terminal"
          onClick={(event) => { event.stopPropagation(); onOpenTerminal() }}
          className="size-6 shrink-0 p-1"
        >
          <Terminal className="size-3.5" />
        </IconButton>
        {done ? (
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

      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <GitBranch className="size-3 shrink-0" />
        <span
          className="min-w-0 flex-1 truncate"
          title={column === 'backlog' && !task.worktreePath ? '分支會在開始執行時建立' : undefined}
        >
          {task.branch}
          {column === 'backlog' && !task.worktreePath && (
            <span className="text-muted-foreground/70">（開始時建立）</span>
          )}
        </span>
        {running && subAgentCount > 0 && (
          <span className="flex shrink-0 items-center gap-1">
            <Users className="size-3" />
            {subAgentCount}
          </span>
        )}
        {links?.issue && <GithubLinkButton link={links.issue} />}
        {links?.pr && <GithubLinkButton link={links.pr} />}
      </div>

      {(running || done) && <TaskProgressBadge progress={progress} usage={task.usage} />}

      {task.jevRoute && (
        <p className="mt-1.5 truncate text-xs text-muted-foreground" title={task.jevRoute.reason}>
          Jev：{task.jevRoute.model ?? 'CLI 預設模型'}{task.jevRoute.plannerModel ? ` · ${task.jevRoute.plannerModel} 規劃` : ''}
          {task.jevRoute.status === 'fallback' ? '（備援）' : ''}
        </p>
      )}

      {column === 'backlog' && task.launchError && (
        <p className="mt-1.5 truncate text-xs text-destructive" title={task.launchError}>
          開始失敗：{task.launchError}
        </p>
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

export function ProjectFilter({
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
  subAgents: Record<string, SubAgentRun[]>
  progress: Record<string, TaskProgress>
  selectedTaskId: string | null
  onSelectTask: (taskId: string) => void
  onEditTask: (taskId: string) => void
  onDeleteTask: (taskId: string) => void
  onOpenTaskTerminal: (taskId: string) => void
  onNewTask: () => void
  view: BoardView
  onViewChange: (next: BoardView) => void
  taskLinks: Record<string, GithubTaskLinks>
}

export function BoardColumns({
  board,
  subAgents,
  progress,
  view,
  onViewChange,
  taskLinks,
  selectedTaskId,
  onSelectTask,
  onEditTask,
  onDeleteTask,
  onOpenTaskTerminal,
  onNewTask,
}: BoardColumnsProps) {
  const [projectFilter, setProjectFilter] = useState<string | null>(null)
  // Run times are shown to the minute, so a 30s tick is enough to keep them honest.

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

  const total = allTasks.length

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-5">
        <ViewTabs value={view} onChange={onViewChange} />
        <span className="h-4 w-px bg-border" />
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
                    subAgentCount={(subAgents[task.id] ?? []).length}
                    progress={column === 'in_progress' ? progress[task.id] ?? null : null}
                    links={taskLinks[task.id]}
                    selected={task.id === selectedTaskId}
                    onSelect={() => onSelectTask(task.id)}
                    onEdit={column === 'backlog' ? () => onEditTask(task.id) : undefined}
                    onDelete={() => onDeleteTask(task.id)}
                    onOpenTerminal={() => onOpenTaskTerminal(task.id)}
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
