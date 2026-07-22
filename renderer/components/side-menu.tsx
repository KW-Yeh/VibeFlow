import { useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  FolderOpen,
  Hammer,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Rocket,
  Settings,
  Smartphone,
  Trash2,
  Users,
  Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
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
  onManageRoles: () => void
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

  // Backlog / in-progress / done now share one list per project, ordered by
  // creation time so a task keeps its place regardless of its current column.
  for (const group of groups.values()) {
    group.tasks.sort((a, b) => (a.task.createdAt ?? 0) - (b.task.createdAt ?? 0))
  }

  return Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name))
}

function projectInitials(name: string): string {
  return name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '?'
}

function taskStatus(entry: TaskEntry): {
  label: string
  className: string
  pillClassName: string
  icon: ReactNode
} {
  const stage = entry.task.pipeline?.stage

  if (entry.column === 'done' || stage === 'approved') {
    return {
      label: 'Done',
      className: 'text-primary',
      pillClassName: 'bg-primary/10 text-primary',
      icon: <span className="size-1.5 rounded-full bg-primary" />,
    }
  }

  if (stage === 'blocked') {
    return {
      label: 'Blocked',
      className: 'text-destructive',
      pillClassName: 'bg-destructive/10 text-destructive',
      icon: <AlertTriangle className="size-3 shrink-0" />,
    }
  }

  if (stage === 'reviewing') {
    return {
      label: 'Reviewing',
      className: 'text-warning',
      pillClassName: 'bg-warning/10 text-warning',
      icon: <Eye className="size-3 shrink-0" />,
    }
  }

  if (stage === 'revising') {
    return {
      label: 'Revising',
      className: 'text-warning',
      pillClassName: 'bg-warning/10 text-warning',
      icon: <Hammer className="size-3 shrink-0" />,
    }
  }

  if (entry.column === 'in_progress') {
    const planning = entry.task.progress?.planDone !== true
    return {
      label: planning ? 'Planning' : 'Running',
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
    label: 'Backlog',
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
  const status = taskStatus(entry)

  return (
    <button
      type="button"
      onClick={() => onSelectTask(entry.task.id)}
      className={cn(
        'flex w-full min-w-0 items-center gap-1.5 rounded px-2 py-1 text-left text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        selected
          ? 'bg-primary/15 font-medium text-primary'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
      )}
      title={entry.task.title}
    >
      <span className={cn('flex size-3 shrink-0 items-center justify-center', status.className)}>
        {status.icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{entry.task.title}</span>
      <span
        className={cn(
          'shrink-0 rounded-full px-1.5 py-0.5 text-xs font-medium',
          status.pillClassName
        )}
      >
        {status.label}
      </span>
    </button>
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
      <div className="border-t border-border p-2">
        <button
          type="button"
          title={title}
          aria-label={title}
          disabled={!action}
          onClick={action}
          className="mx-auto flex size-8 items-center justify-center rounded-md bg-primary/15 text-primary outline-none transition-colors hover:bg-primary/20 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-70"
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
      </div>
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
    <div className="border-t border-border p-3">
      <div className="rounded-md border border-primary/25 bg-primary/10 p-3">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded bg-primary/15 text-primary">
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
          <div className="mt-3 h-1.5 overflow-hidden rounded bg-background/80">
            <div
              className="h-full rounded bg-primary transition-[width]"
              style={{ width: formatPercent(update.percent) }}
            />
          </div>
        )}

        <button
          type="button"
          disabled={!action}
          onClick={action}
          className="mt-3 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded bg-primary px-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {update.status === 'downloading' && <RefreshCw className="size-3 animate-spin" />}
          {buttonLabel}
        </button>
      </div>
    </div>
  )
}

/** Settings-related controls docked at the bottom of the sidebar. */
function SettingsDock({
  collapsed,
  autoMode,
  onToggleAutoMode,
  onManageRoles,
  onRemoteShare,
  remoteActive,
  onOpenSettings,
}: {
  collapsed: boolean
  autoMode: boolean
  onToggleAutoMode: () => void
  onManageRoles: () => void
  onRemoteShare?: () => void
  remoteActive?: boolean
  onOpenSettings: () => void
}) {
  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1 border-t border-border p-2">
        <IconButton
          aria-label={autoMode ? '關閉 Auto Mode' : '開啟 Auto Mode'}
          title="Auto Mode：移至 In Progress 時自動執行 Agent"
          onClick={onToggleAutoMode}
          className={cn('size-8', autoMode && 'text-primary hover:text-primary')}
        >
          <Zap className={cn('size-4', autoMode && 'fill-current')} />
        </IconButton>
        <IconButton
          aria-label="管理角色"
          onClick={onManageRoles}
          title="管理角色"
          className="size-8"
        >
          <Users className="size-4" />
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
      </div>
    )
  }

  return (
    <div className="space-y-1 border-t border-border p-2">
      <button
        type="button"
        role="switch"
        aria-checked={autoMode}
        onClick={onToggleAutoMode}
        title="開啟時：將卡片移至 In Progress 會自動執行 Agent"
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
      >
        <span
          className={cn(
            'relative inline-block h-4 w-7 shrink-0 rounded-full transition-colors',
            autoMode ? 'bg-primary' : 'bg-border'
          )}
        >
          <span
            className={cn(
              'absolute left-0 top-0.5 size-3 rounded-full bg-foreground ring-1 ring-border transition-transform',
              autoMode ? 'translate-x-3.5' : 'translate-x-0.5'
            )}
          />
        </span>
        Auto Mode
      </button>
      <div className="flex items-center gap-1 px-1">
        <IconButton aria-label="管理角色" onClick={onManageRoles} title="管理角色">
          <Users className="size-4" />
        </IconButton>
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
  onManageRoles,
  onRemoteShare,
  remoteActive,
  onOpenSettings,
  remoteUpdate,
  onCheckForUpdate,
  onDownloadUpdate,
  onInstallUpdate,
}: SideMenuProps) {
  const [projectsExpanded, setProjectsExpanded] = useState<Record<string, boolean>>({})
  const projects = groupTasksByProject(board, selectedTaskId)

  return (
    <aside
      className={cn(
        'flex flex-shrink-0 flex-col border-r border-border bg-card text-card-foreground transition-[width] duration-200',
        collapsed ? 'w-12' : 'w-80'
      )}
    >
      {/* Top: app name + collapse toggle */}
      <div
        className={cn(
          'flex h-12 shrink-0 items-center border-b border-border px-3',
          collapsed ? 'justify-center' : 'justify-between'
        )}
      >
        {!collapsed && (
          <span className="text-[15px] font-semibold tracking-tight text-foreground">
            VibeFlow
          </span>
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
      <div className={cn('shrink-0 px-2 pt-3', collapsed && 'flex justify-center')}>
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
      </div>

      {/* Scrollable content */}
      <div className={cn('flex flex-1 flex-col py-3', collapsed ? 'overflow-hidden' : 'overflow-y-auto')}>
        {/* Projects section */}
        <div className="px-2">
          {collapsed ? (
            <div className="space-y-1">
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
                      'mx-auto flex size-8 items-center justify-center rounded-md text-xs font-semibold transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-40',
                      selected
                        ? 'bg-primary/15 text-primary'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                    )}
                  >
                    {projectInitials(project.name)}
                  </button>
                )
              })}
            </div>
          ) : (
            <>
              <div className="mb-1 flex items-center px-1">
                <span className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Projects
                </span>
              </div>

              <div className="space-y-2">
                {projects.length === 0 ? (
                  <p className="px-2 py-1 text-sm text-muted-foreground">
                    尚無任務
                  </p>
                ) : (
                  projects.map((project) => {
                    const expanded =
                      projectsExpanded[project.key] ?? (project.hasSelected || project.tasks.length > 0)

                    return (
                      <div key={project.key} className="rounded-md">
                        <div
                          className={cn(
                            'group flex items-center gap-1 rounded px-1 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground',
                            project.hasSelected && 'text-foreground'
                          )}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setProjectsExpanded((prev) => ({
                                ...prev,
                                [project.key]: !expanded,
                              }))
                            }
                            className="flex min-w-0 flex-1 items-center gap-1 rounded text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                            title={project.path ?? project.name}
                          >
                            {expanded ? (
                              <ChevronDown className="size-3 shrink-0" />
                            ) : (
                              <ChevronRight className="size-3 shrink-0" />
                            )}
                            <FolderOpen className="size-3 shrink-0" />
                            <span className="min-w-0 flex-1 truncate font-medium">
                              {project.name}
                            </span>
                          </button>
                          <span className="shrink-0 tabular-nums text-muted-foreground group-hover:hidden">
                            {project.total}
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
                                  project.tasks.map((e) => e.task.id)
                                )
                              }
                              className="p-0.5"
                            >
                              <Trash2 className="size-3" />
                            </IconButton>
                          </div>
                        </div>

                        {expanded && (
                          <div className="ml-3 space-y-0.5">
                            {project.tasks.length === 0 ? (
                              <p className="px-2 py-0.5 text-sm text-muted-foreground/60">
                                尚無任務
                              </p>
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
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <SettingsDock
        collapsed={collapsed}
        autoMode={autoMode}
        onToggleAutoMode={onToggleAutoMode}
        onManageRoles={onManageRoles}
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
    </aside>
  )
}
