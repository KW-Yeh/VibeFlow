import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react'
import { useEffect, useId, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Download,
  FolderOpen,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Settings,
  Smartphone,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { compareTasksByNewestFirst } from '@/lib/task-order'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { SECTION_LABEL } from '@/components/ui/section-label'
import {
  createEnterVariants,
  createPresenceVariants,
  MOTION_DURATION,
  MOTION_EASING,
} from '@/lib/motion'
import type {
  BoardState,
  ColumnId,
  RemoteUpdateSnapshot,
  Task,
} from '@/lib/types'

interface SideMenuProps {
  collapsed: boolean
  onToggleCollapse: () => void
  board: BoardState
  selectedTaskId: string | null
  onSelectTask: (id: string) => void
  onNewTask: () => void
  /** Open the new-task form pre-filled for a specific project folder. */
  onNewTaskForProject: (projectPath: string | null) => void
  /** Delete an entire project: every listed task (worktree + branch + conversation). */
  onDeleteProject: (name: string, taskIds: string[]) => void
  /** Global Auto Mode: auto-run a card's execution on entering In Progress. */
  autoMode: boolean
  onToggleAutoMode: () => void
  onRemoteShare?: () => void
  remoteActive?: boolean
  onOpenSettings: () => void
  remoteUpdate: RemoteUpdateSnapshot | null
  onCheckForUpdate: () => void
  onDownloadUpdate: () => void
  onInstallUpdate: () => void
}

type TaskEntry = {
  task: Task
  column: ColumnId
}

type ProjectGroup = {
  key: string
  name: string
  path: string | null
  tasks: TaskEntry[]
  total: number
  hasSelected: boolean
}

function basename(path?: string | null): string {
  if (!path) return ''
  const parts = path.split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

function projectName(task: Task): string {
  return task.projectName || basename(task.projectPath) || 'Unassigned'
}

function projectKey(task: Task): string {
  return task.projectPath || `name:${projectName(task)}`
}

function taskEntries(board: BoardState): TaskEntry[] {
  return [
    ...board.in_progress.map((task) => ({ task, column: 'in_progress' as const })),
    ...board.backlog.map((task) => ({ task, column: 'backlog' as const })),
    ...board.done.map((task) => ({ task, column: 'done' as const })),
  ]
}

// In-progress first, then backlog, then done; newest-first within each group so
// the task the user is most likely acting on floats to the top of the project.
const COLUMN_RANK: Record<ColumnId, number> = { in_progress: 0, backlog: 1, done: 2 }

function sortTasksWithinProject(entries: TaskEntry[]): TaskEntry[] {
  return [...entries].sort((a, b) => {
    const rank = COLUMN_RANK[a.column] - COLUMN_RANK[b.column]
    return rank !== 0 ? rank : compareTasksByNewestFirst(a.task, b.task)
  })
}

if (process.env.NODE_ENV !== 'production') {
  const t = (id: string, column: ColumnId, createdAt: number): TaskEntry => ({
    column,
    task: { id, createdAt } as Task,
  })
  const ordered = sortTasksWithinProject([
    t('old-done', 'done', 1),
    t('new-backlog', 'backlog', 3),
    t('old-inprog', 'in_progress', 2),
    t('new-inprog', 'in_progress', 4),
  ]).map((e) => e.task.id)
  console.assert(
    JSON.stringify(ordered) ===
      JSON.stringify(['new-inprog', 'old-inprog', 'new-backlog', 'old-done']),
    'sortTasksWithinProject: expected in_progress→backlog→done, newest-first within group, got',
    ordered
  )
}

function groupTasksByProject(
  board: BoardState,
  selectedTaskId: string | null
): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>()

  for (const entry of taskEntries(board)) {
    const key = projectKey(entry.task)
    const group =
      groups.get(key) ??
      {
        key,
        name: projectName(entry.task),
        path: entry.task.projectPath ?? null,
        tasks: [],
        total: 0,
        hasSelected: false,
      }

    group.tasks.push(entry)
    group.total += 1
    group.hasSelected ||= entry.task.id === selectedTaskId
    groups.set(key, group)
  }

  for (const group of groups.values()) {
    group.tasks = sortTasksWithinProject(group.tasks)
  }

  return Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name))
}

// Default expansion the first time a project shows up: open it when there is
// something left to do (or the selected task lives there). Seeded once and then
// frozen, so a project does not collapse under the user as its tasks finish.
function defaultProjectExpanded(project: ProjectGroup): boolean {
  return project.hasSelected || project.tasks.some((entry) => entry.column !== 'done')
}

function projectInitials(name: string): string {
  return name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '?'
}

const COLUMN_LABEL = {
  backlog: 'Backlog',
  in_progress: 'In Progress',
  done: 'Done',
} satisfies Record<ColumnId, string>

function columnLabel(column: ColumnId): string {
  return COLUMN_LABEL[column]
}

function columnVisual(column: Exclude<ColumnId, 'done'>): {
  className: string
  pillClassName: string
  icon: ReactNode
} {
  if (column === 'in_progress') {
    return {
      className: 'text-warning',
      pillClassName: 'bg-warning/10 text-warning',
      icon: (
        <span className="flex size-3 shrink-0 items-center justify-center">
          <span className="size-1.5 rounded-full bg-warning animate-pulse" />
        </span>
      ),
    }
  }

  return {
    className: 'text-muted-foreground',
    pillClassName: 'bg-muted-foreground/10 text-muted-foreground',
    icon: <span className="size-1.5 rounded-full bg-muted-foreground/60" />,
  }
}

function TaskRow({
  entry,
  selected,
  onSelectTask,
}: {
  entry: TaskEntry
  selected: boolean
  onSelectTask: (id: string) => void
}) {
  const reducedMotion = useReducedMotion() ?? false
  const visual = entry.column === 'done' ? null : columnVisual(entry.column)

  return (
    <motion.button
      data-selected-task={selected || undefined}
      type="button"
      onClick={() => onSelectTask(entry.task.id)}
      whileTap={reducedMotion ? undefined : { scale: 0.99, opacity: 0.9 }}
      transition={{
        duration: reducedMotion ? 0 : MOTION_DURATION.micro,
        ease: MOTION_EASING.enter,
      }}
      className={cn(
        'flex w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm transition-colors motion-reduce:transition-none outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        selected
          ? 'bg-primary/15 font-medium text-primary'
          : entry.column === 'done'
            ? 'text-muted-foreground/60 hover:bg-accent/50 hover:text-muted-foreground'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground'
      )}
      title={entry.task.title}
    >
      {/* Fixed leading slot keeps every row's title aligned; done rows render an
          empty placeholder instead of dropping the column (A1 left-edge alignment). */}
      <span
        className={cn(
          'flex size-3 shrink-0 items-center justify-center',
          visual?.className
        )}
      >
        {visual?.icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{entry.task.title}</span>
      {visual ? (
        <span
          className={cn(
            'shrink-0 rounded-full px-1.5 py-0.5 text-xs font-medium',
            visual.pillClassName
          )}
        >
          {columnLabel(entry.column)}
        </span>
      ) : null}
    </motion.button>
  )
}

function ProjectTaskList({
  id,
  project,
  selectedTaskId,
  onSelectTask,
}: {
  id: string
  project: ProjectGroup
  selectedTaskId: string | null
  onSelectTask: (id: string) => void
}) {
  const isPresent = useIsPresent()
  const reducedMotion = useReducedMotion() ?? false

  return (
    <motion.div
      id={id}
      initial="hidden"
      animate="visible"
      exit="exit"
      variants={createPresenceVariants({
        timing: 'standard',
        exitTiming: 'micro',
        transform: { y: -4 },
        reducedMotion,
      })}
      inert={!isPresent}
      aria-hidden={!isPresent || undefined}
      className={cn('ml-3 space-y-0.5', !isPresent && 'pointer-events-none')}
    >
      {project.tasks.length === 0 ? (
        <p className="px-2 py-0.5 text-sm text-muted-foreground/60">尚無任務</p>
      ) : (
        project.tasks.map((entry) => (
          <TaskRow
            key={entry.task.id}
            entry={entry}
            selected={entry.task.id === selectedTaskId}
            onSelectTask={onSelectTask}
          />
        ))
      )}
    </motion.div>
  )
}

function ProjectDisclosure({
  project,
  expanded,
  selectedTaskId,
  onToggle,
  onSelectTask,
  onNewTaskForProject,
  onDeleteProject,
}: {
  project: ProjectGroup
  expanded: boolean
  selectedTaskId: string | null
  onToggle: () => void
  onSelectTask: (id: string) => void
  onNewTaskForProject: (projectPath: string | null) => void
  onDeleteProject: (name: string, taskIds: string[]) => void
}) {
  const contentId = useId()

  return (
    <div>
      <div
        className={cn(
          'group flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors motion-reduce:transition-none hover:bg-accent hover:text-foreground',
          project.hasSelected && 'text-foreground'
        )}
      >
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          title={project.path ?? project.name}
        >
          {expanded ? (
            <ChevronDown className="size-3 shrink-0" />
          ) : (
            <ChevronRight className="size-3 shrink-0" />
          )}
          <FolderOpen className="size-3 shrink-0" />
          <span className="min-w-0 flex-1 truncate font-medium">{project.name}</span>
        </button>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground group-hover:hidden">
          {project.tasks.length}
        </span>
        <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
          <IconButton
            aria-label={`在 ${project.name} 新增任務`}
            title="在此專案新增任務"
            onClick={() => onNewTaskForProject(project.path)}
            className="p-0.5"
          >
            <Plus className="size-3" />
          </IconButton>
          <IconButton
            aria-label={`刪除專案 ${project.name}`}
            title="刪除整個專案（含所有任務）"
            tone="danger"
            onClick={() =>
              onDeleteProject(
                project.name,
                project.tasks.map((entry) => entry.task.id)
              )
            }
            className="p-0.5"
          >
            <Trash2 className="size-3" />
          </IconButton>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <ProjectTaskList
            key={project.key}
            id={contentId}
            project={project}
            selectedTaskId={selectedTaskId}
            onSelectTask={onSelectTask}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function SidebarModeContent({
  mode,
  className,
  children,
}: {
  mode: 'collapsed' | 'expanded'
  className?: string
  children: ReactNode
}) {
  const reducedMotion = useReducedMotion() ?? false

  return (
    <motion.div
      key={mode}
      initial="hidden"
      animate="visible"
      variants={createEnterVariants({
        timing: 'micro',
        reducedMotion,
      })}
      className={className}
    >
      {children}
    </motion.div>
  )
}

function formatPercent(value?: number): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '0%'
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`
}

function shouldShowUpdateBanner(update: RemoteUpdateSnapshot | null): boolean {
  if (!update) return false
  return ['available', 'downloading', 'downloaded', 'error'].includes(update.status)
}

function UpdateBanner({
  update,
  collapsed,
  onCheck,
  onDownload,
  onInstall,
}: {
  update: RemoteUpdateSnapshot | null
  collapsed: boolean
  onCheck: () => void
  onDownload: () => void
  onInstall: () => void
}) {
  if (!update || !shouldShowUpdateBanner(update)) return null

  if (collapsed) {
    const title =
      update.status === 'downloaded'
        ? '更新已下載，點擊重新啟動'
        : update.status === 'downloading'
          ? `正在下載更新 ${formatPercent(update.percent)}`
          : update.status === 'error'
            ? '更新檢查失敗，點擊重試'
            : `新版本 ${update.version ?? ''} 可用`
    const action =
      update.status === 'downloaded'
        ? onInstall
        : update.status === 'error'
          ? onCheck
          : update.status === 'available'
            ? onDownload
            : undefined

    return (
      <SidebarModeContent mode="collapsed" className="border-t border-border p-2">
        <button
          type="button"
          title={title}
          aria-label={title}
          disabled={!action}
          onClick={action}
          className="mx-auto flex size-8 items-center justify-center rounded-md bg-primary/15 text-primary outline-none transition-colors motion-reduce:transition-none hover:bg-primary/20 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-70"
        >
          {update.status === 'downloaded' ? (
            <Rocket className="size-4" />
          ) : update.status === 'downloading' ? (
            <Download className="size-4 animate-pulse" />
          ) : update.status === 'error' ? (
            <AlertTriangle className="size-4" />
          ) : (
            <RefreshCw className="size-4" />
          )}
        </button>
      </SidebarModeContent>
    )
  }

  const version = update.version ? `v${update.version}` : '新版本'
  const message =
    update.status === 'downloaded'
      ? '下載完成，重新啟動後套用。'
      : update.status === 'downloading'
        ? `正在下載 ${formatPercent(update.percent)}`
        : update.status === 'error'
          ? update.message || '更新檢查失敗。'
          : `${version} 可以使用。`
  const buttonLabel =
    update.status === 'downloaded'
      ? '重新啟動'
      : update.status === 'downloading'
        ? '下載中'
        : update.status === 'error'
          ? '重試'
          : '升版'
  const action =
    update.status === 'downloaded'
      ? onInstall
      : update.status === 'error'
        ? onCheck
        : update.status === 'available'
          ? onDownload
          : undefined

  return (
    <SidebarModeContent mode="expanded" className="border-t border-border p-3">
      <div className="rounded-md border border-primary/25 bg-primary/10 p-3">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
            {update.status === 'downloaded' ? (
              <CheckCircle2 className="size-4" />
            ) : update.status === 'error' ? (
              <AlertTriangle className="size-4" />
            ) : (
              <Download className="size-4" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">
              {update.status === 'error' ? '更新暫時不可用' : 'VibeFlow 更新'}
            </p>
            <p className="mt-0.5 break-words text-sm text-muted-foreground">
              {message}
            </p>
          </div>
        </div>

        {update.status === 'downloading' && (
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-background/80">
            <div
              className="h-full rounded-full bg-primary transition-[width] motion-reduce:transition-none"
              style={{ width: formatPercent(update.percent) }}
            />
          </div>
        )}

        <button
          type="button"
          disabled={!action}
          onClick={action}
          className="mt-3 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-primary px-2 text-sm font-medium text-primary-foreground outline-none transition-colors motion-reduce:transition-none hover:bg-primary/90 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {update.status === 'downloading' && <RefreshCw className="size-3 animate-spin" />}
          {buttonLabel}
        </button>
      </div>
    </SidebarModeContent>
  )
}

/** Settings-related controls docked at the bottom of the sidebar. */
function SettingsDock({
  collapsed,
  autoMode,
  onToggleAutoMode,
  onRemoteShare,
  remoteActive,
  onOpenSettings,
}: {
  collapsed: boolean
  autoMode: boolean
  onToggleAutoMode: () => void
  onRemoteShare?: () => void
  remoteActive?: boolean
  onOpenSettings: () => void
}) {
  if (collapsed) {
    return (
      <SidebarModeContent
        mode="collapsed"
        className="flex flex-col items-center gap-1 border-t border-border p-2"
      >
        <IconButton
          aria-label={autoMode ? '關閉 Auto Mode' : '開啟 Auto Mode'}
          title="Auto Mode：移至 In Progress 時自動執行 Agent"
          onClick={onToggleAutoMode}
          className={cn('size-8', autoMode && 'text-primary hover:text-primary')}
        >
          <Zap className={cn('size-4', autoMode && 'fill-current')} />
        </IconButton>
        {onRemoteShare && (
          <IconButton
            aria-label="遠端控制"
            onClick={onRemoteShare}
            title="遠端控制"
            className={cn(
              'size-8',
              remoteActive && 'text-primary hover:text-primary'
            )}
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
      </SidebarModeContent>
    )
  }

  return (
    <SidebarModeContent
      mode="expanded"
      className="space-y-1 border-t border-border p-2"
    >
      <button
        type="button"
        role="switch"
        aria-checked={autoMode}
        onClick={onToggleAutoMode}
        title="開啟時：將卡片移至 In Progress 會自動執行 Agent"
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground outline-none transition-colors motion-reduce:transition-none hover:bg-accent/60 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span
          className={cn(
            'relative inline-block h-4 w-7 shrink-0 rounded-full transition-colors motion-reduce:transition-none',
            autoMode ? 'bg-primary' : 'bg-border'
          )}
        >
          <span
            className={cn(
              'absolute left-0 top-0.5 size-3 rounded-full bg-foreground ring-1 ring-border transition-transform motion-reduce:transform-none motion-reduce:transition-none',
              autoMode ? 'translate-x-3.5' : 'translate-x-0.5'
            )}
          />
        </span>
        Auto Mode
      </button>
      <div className="flex items-center gap-1 px-1">
        {onRemoteShare && (
          <IconButton
            aria-label="遠端控制"
            onClick={onRemoteShare}
            title="遠端控制"
            className={cn(
              remoteActive
                ? 'text-primary hover:text-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Smartphone className="size-4" />
          </IconButton>
        )}
        <IconButton
          aria-label="設定 System Prompt"
          onClick={onOpenSettings}
          title="設定（System Prompt）"
        >
          <Settings className="size-4" />
        </IconButton>
      </div>
    </SidebarModeContent>
  )
}

function SidebarSearch({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && value) {
            event.preventDefault()
            onChange('')
          }
        }}
        placeholder="搜尋任務"
        aria-label="搜尋任務"
        className="h-8 w-full rounded-md border border-border bg-background pl-7 pr-7 text-sm text-foreground outline-none transition-colors motion-reduce:transition-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />
      {value ? (
        <button
          type="button"
          aria-label="清除搜尋"
          title="清除搜尋"
          onClick={() => onChange('')}
          className="absolute right-1.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors motion-reduce:transition-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  )
}

export function SideMenu({
  collapsed,
  onToggleCollapse,
  board,
  selectedTaskId,
  onSelectTask,
  onNewTask,
  onNewTaskForProject,
  onDeleteProject,
  autoMode,
  onToggleAutoMode,
  onRemoteShare,
  remoteActive,
  onOpenSettings,
  remoteUpdate,
  onCheckForUpdate,
  onDownloadUpdate,
  onInstallUpdate,
}: SideMenuProps) {
  const [projectsExpanded, setProjectsExpanded] = useState<Record<string, boolean>>({})
  const [query, setQuery] = useState('')
  const reducedMotion = useReducedMotion() ?? false
  const contentVariants = createEnterVariants({
    timing: 'micro',
    reducedMotion,
  })

  const q = query.trim().toLowerCase()
  const searching = !collapsed && q.length > 0
  // Seeding reads the unfiltered list so a transient search filter can never
  // freeze a project's default at "no matching tasks".
  const allProjects = groupTasksByProject(board, selectedTaskId)
  const projects = searching
    ? allProjects
        .map((project) => ({
          ...project,
          tasks: project.tasks.filter((entry) =>
            entry.task.title.toLowerCase().includes(q)
          ),
        }))
        .filter((project) => project.tasks.length > 0)
    : allProjects

  const projectKeys = allProjects.map((project) => project.key).join(' ')
  useEffect(() => {
    setProjectsExpanded((prev) => {
      let changed = false
      const next = { ...prev }
      for (const project of allProjects) {
        if (project.key in next) continue
        next[project.key] = defaultProjectExpanded(project)
        changed = true
      }
      return changed ? next : prev
    })
    // `allProjects` is a fresh array every render; the key signature is what
    // actually decides whether the project set changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectKeys])

  // When searching, every matching project is force-expanded so hits are always
  // visible; clearing the query restores the user's manual expansion state.
  // The fallback covers the first frame before the seeding effect commits.
  const isExpanded = (project: ProjectGroup) =>
    searching || (projectsExpanded[project.key] ?? defaultProjectExpanded(project))
  const allExpanded =
    projects.length > 0 && projects.every((project) => isExpanded(project))
  const toggleAll = () => {
    const next = !allExpanded
    setProjectsExpanded((prev) => {
      const updated = { ...prev }
      for (const project of projects) updated[project.key] = next
      return updated
    })
  }

  // Keep the selected task in view when selection changes programmatically
  // (e.g. remote control) even if it sits below the fold.
  useEffect(() => {
    const row = document.querySelector<HTMLElement>('aside [data-selected-task]')
    row?.scrollIntoView({ block: 'nearest' })
  }, [selectedTaskId])

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 48 : 320 }}
      transition={{
        duration: reducedMotion ? 0 : MOTION_DURATION.spatial,
        ease: MOTION_EASING.enter,
      }}
      className="flex flex-shrink-0 flex-col overflow-x-clip border-r border-border bg-card text-card-foreground"
    >
      {/* Top: app name + collapse toggle */}
      <div
        className={cn(
          'flex h-12 shrink-0 items-center border-b border-border px-3',
          collapsed ? 'justify-center' : 'justify-between'
        )}
      >
        {!collapsed && (
          <motion.span
            initial="hidden"
            animate="visible"
            variants={contentVariants}
            className="text-[15px] font-semibold tracking-tight text-foreground"
          >
            VibeFlow
          </motion.span>
        )}
        <IconButton
          aria-label={collapsed ? '展開選單' : '收合選單'}
          onClick={onToggleCollapse}
          title={collapsed ? '展開選單' : '收合選單'}
          className="p-1"
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4" />
          ) : (
            <PanelLeftClose className="size-4" />
          )}
        </IconButton>
      </div>

      {/* New task */}
      <SidebarModeContent
        mode={collapsed ? 'collapsed' : 'expanded'}
        className={cn(
          'shrink-0 px-2 pt-3',
          collapsed ? 'flex justify-center' : 'w-full'
        )}
      >
        {collapsed ? (
          <IconButton
            aria-label="新增任務"
            onClick={onNewTask}
            title="新增任務"
            className="size-8 p-1.5"
          >
            <Plus className="size-4" />
          </IconButton>
        ) : (
          <Button
            size="sm"
            className="w-full rounded-md active:scale-95"
            onClick={onNewTask}
          >
            <Plus />
            新增任務
          </Button>
        )}
      </SidebarModeContent>

      {/* Search / filter (expanded only) */}
      {!collapsed && (
        <SidebarModeContent mode="expanded" className="shrink-0 px-2 pt-2">
          <SidebarSearch value={query} onChange={setQuery} />
        </SidebarModeContent>
      )}

      {/* Scrollable content */}
      <div className={cn('flex flex-1 flex-col py-3', collapsed ? 'overflow-hidden' : 'overflow-y-auto')}>
        {/* Projects section */}
        <div className="px-2">
          {collapsed ? (
            <motion.div
              key="collapsed-projects"
              initial="hidden"
              animate="visible"
              variants={contentVariants}
              className="space-y-1"
            >
              {projects.map((project) => {
                const firstTask = project.tasks[0]?.task
                const selected = project.hasSelected
                return (
                  <button
                    key={project.key}
                    type="button"
                    aria-label={`開啟 ${project.name}`}
                    title={project.path ?? project.name}
                    disabled={!firstTask}
                    onClick={() => firstTask && onSelectTask(firstTask.id)}
                    className={cn(
                      'mx-auto flex size-8 items-center justify-center rounded-md text-xs font-semibold transition-colors motion-reduce:transition-none outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-40',
                      selected
                        ? 'bg-primary/15 text-primary'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                    )}
                  >
                    {projectInitials(project.name)}
                  </button>
                )
              })}
            </motion.div>
          ) : (
            <motion.div
              key="expanded-projects"
              initial="hidden"
              animate="visible"
              variants={contentVariants}
            >
              <div className="mb-1 flex items-center gap-1 px-2">
                <span className={SECTION_LABEL}>
                  Projects
                </span>
                {!searching && projects.length > 0 && (
                  <IconButton
                    aria-label={allExpanded ? '全部收合' : '全部展開'}
                    title={allExpanded ? '全部收合' : '全部展開'}
                    onClick={toggleAll}
                    className="ml-auto p-0.5"
                  >
                    {allExpanded ? (
                      <ChevronsDownUp className="size-3.5" />
                    ) : (
                      <ChevronsUpDown className="size-3.5" />
                    )}
                  </IconButton>
                )}
              </div>

              <div className="space-y-1">
                {projects.length === 0 ? (
                  <p className="px-2 py-1 text-sm text-muted-foreground">
                    {searching ? '找不到符合的任務' : '尚無任務'}
                  </p>
                ) : (
                  projects.map((project) => {
                    const expanded = isExpanded(project)

                    return (
                      <ProjectDisclosure
                        key={project.key}
                        project={project}
                        expanded={expanded}
                        selectedTaskId={selectedTaskId}
                        onToggle={() =>
                          setProjectsExpanded((prev) => ({
                            ...prev,
                            [project.key]: !expanded,
                          }))
                        }
                        onSelectTask={onSelectTask}
                        onNewTaskForProject={onNewTaskForProject}
                        onDeleteProject={onDeleteProject}
                      />
                    )
                  })
                )}
              </div>
            </motion.div>
          )}
        </div>
      </div>

      <SettingsDock
        collapsed={collapsed}
        autoMode={autoMode}
        onToggleAutoMode={onToggleAutoMode}
        onRemoteShare={onRemoteShare}
        remoteActive={remoteActive}
        onOpenSettings={onOpenSettings}
      />

      <UpdateBanner
        update={remoteUpdate}
        collapsed={collapsed}
        onCheck={onCheckForUpdate}
        onDownload={onDownloadUpdate}
        onInstall={onInstallUpdate}
      />
    </motion.aside>
  )
}
