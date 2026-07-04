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
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  RefreshCw,
  Rocket,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { IconButton } from '@/components/ui/icon-button'
import type {
  BoardState,
  ColumnId,
  RemoteUpdateSnapshot,
  Task,
  Workspace,
} from '@/lib/types'

interface SideMenuProps {
  collapsed: boolean
  onToggleCollapse: () => void
  board: BoardState
  workspaces: Workspace[]
  selectedTaskId: string | null
  onSelectTask: (id: string) => void
  onNewTask: () => void
  onAddWorkspace: () => void
  onEditWorkspace: (ws: Workspace) => void
  onRefreshWorkspaces: () => void
  refreshing: boolean
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
  active: TaskEntry[]
  done: TaskEntry[]
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
        active: [],
        done: [],
        total: 0,
        hasSelected: false,
      }

    if (entry.column === 'done') group.done.push(entry)
    else group.active.push(entry)
    group.total += 1
    group.hasSelected ||= entry.task.id === selectedTaskId
    groups.set(key, group)
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
  icon: ReactNode
} {
  const stage = entry.task.pipeline?.stage

  if (entry.column === 'done' || stage === 'approved') {
    return {
      label: 'Done',
      className: 'text-primary',
      icon: <span className="size-1.5 rounded-full bg-primary" />,
    }
  }

  if (stage === 'blocked') {
    return {
      label: 'Blocked',
      className: 'text-destructive',
      icon: <AlertTriangle className="size-3 shrink-0" />,
    }
  }

  if (stage === 'reviewing') {
    return {
      label: 'Reviewing',
      className: 'text-amber-700',
      icon: <Eye className="size-3 shrink-0" />,
    }
  }

  if (stage === 'revising') {
    return {
      label: 'Revising',
      className: 'text-amber-700',
      icon: <Hammer className="size-3 shrink-0" />,
    }
  }

  if (entry.column === 'in_progress') {
    const planning = entry.task.progress?.planDone !== true
    return {
      label: planning ? 'Planning' : 'Running',
      className: 'text-amber-700',
      icon: (
        <span className="flex size-3 shrink-0 items-center justify-center">
          <span className="size-1.5 rounded-full bg-amber-700 animate-pulse" />
        </span>
      ),
    }
  }

  return {
    label: 'Backlog',
    className: 'text-muted-foreground',
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
        'flex w-full min-w-0 items-center gap-1.5 rounded px-2 py-1 text-left text-xs transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
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
      <span className={cn('shrink-0 text-[11px]', status.className)}>
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
            <p className="text-xs font-medium text-foreground">
              {update.status === 'error' ? '更新暫時不可用' : 'VibeFlow 更新'}
            </p>
            <p className="mt-0.5 break-words text-xs text-muted-foreground">
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
          className="mt-3 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded bg-primary px-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {update.status === 'downloading' && <RefreshCw className="size-3 animate-spin" />}
          {buttonLabel}
        </button>
      </div>
    </div>
  )
}

export function SideMenu({
  collapsed,
  onToggleCollapse,
  board,
  workspaces,
  selectedTaskId,
  onSelectTask,
  onNewTask,
  onAddWorkspace,
  onEditWorkspace,
  onRefreshWorkspaces,
  refreshing,
  remoteUpdate,
  onCheckForUpdate,
  onDownloadUpdate,
  onInstallUpdate,
}: SideMenuProps) {
  const [projectsExpanded, setProjectsExpanded] = useState<Record<string, boolean>>({})
  const [doneExpanded, setDoneExpanded] = useState<Record<string, boolean>>({})
  const [workspacesExpanded, setWorkspacesExpanded] = useState(true)
  const projects = groupTasksByProject(board, selectedTaskId)

  return (
    <aside
      className={cn(
        'flex flex-shrink-0 flex-col border-r border-border bg-card text-card-foreground transition-[width] duration-200',
        collapsed ? 'w-12' : 'w-72'
      )}
    >
      {/* Header */}
      <div className="flex h-12 items-center justify-end border-b border-border px-3">
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

      {/* Scrollable content */}
      <div className={cn('flex flex-1 flex-col py-3', collapsed ? 'overflow-hidden' : 'overflow-y-auto')}>
        {/* Workspaces section */}
        <div className="px-2 pb-3">
          {collapsed ? (
            <button
              type="button"
              onClick={onAddWorkspace}
              title="Workspaces"
              className="mx-auto flex w-8 items-center justify-center rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Layers className="size-4" />
            </button>
          ) : (
            <>
              <div className="mb-1 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setWorkspacesExpanded((v) => !v)}
                  className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                >
                  {workspacesExpanded ? (
                    <ChevronDown className="size-3" />
                  ) : (
                    <ChevronRight className="size-3" />
                  )}
                  Workspaces
                </button>
                <div className="flex items-center gap-1">
                  <IconButton
                    aria-label="重新掃描所有 workspace"
                    onClick={onRefreshWorkspaces}
                    disabled={refreshing}
                    title="重新掃描所有 workspace"
                    className="p-1"
                  >
                    <RefreshCw
                      className={cn('size-3', refreshing && 'animate-spin')}
                    />
                  </IconButton>
                  <IconButton
                    aria-label="新增 Workspace"
                    onClick={onAddWorkspace}
                    title="新增 Workspace"
                    className="p-1"
                  >
                    <Plus className="size-3" />
                  </IconButton>
                </div>
              </div>

              {workspacesExpanded && (
                <div className="space-y-0.5">
                  {workspaces.length === 0 ? (
                    <p className="px-2 py-1 text-xs text-muted-foreground">
                      尚無 workspace
                    </p>
                  ) : (
                    workspaces.map((ws) => (
                      <div
                        key={ws.id}
                        className="group flex items-center gap-1.5 rounded px-2 py-1 hover:bg-accent"
                      >
                        <FolderOpen
                          className={cn(
                            'size-3 shrink-0',
                            ws.available === false
                              ? 'text-destructive'
                              : 'text-muted-foreground'
                          )}
                        />
                        <span
                          className="flex-1 truncate text-xs"
                          title={ws.path}
                        >
                          {ws.name}
                        </span>
                        {ws.available === false && (
                          <span title="資料夾不存在">
                            <AlertTriangle className="size-3 shrink-0 text-destructive" />
                          </span>
                        )}
                        <IconButton
                          aria-label={`編輯 ${ws.name}`}
                          onClick={() => onEditWorkspace(ws)}
                          className="hidden p-0.5 group-hover:inline-flex"
                          title="編輯"
                        >
                          <Pencil className="size-3" />
                        </IconButton>
                      </div>
                    ))
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Divider */}
        {!collapsed && <div className="mx-2 mb-3 border-t border-border" />}

        {/* Projects section */}
        <div className="px-2">
          {collapsed ? (
            <div className="space-y-1">
              <IconButton
                aria-label="新增任務"
                onClick={onNewTask}
                title="新增任務"
                className="mx-auto size-8 p-1.5"
              >
                <Plus className="size-4" />
              </IconButton>
              {projects.map((project) => {
                const firstTask = project.active[0]?.task ?? project.done[0]?.task
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
                      'mx-auto flex size-8 items-center justify-center rounded-md text-[11px] font-semibold transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-40',
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
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Projects
                </span>
                <IconButton
                  aria-label="新增任務"
                  onClick={onNewTask}
                  title="新增任務"
                  className="p-1"
                >
                  <Plus className="size-3" />
                </IconButton>
              </div>

              <div className="space-y-2">
                {projects.length === 0 ? (
                  <p className="px-2 py-1 text-xs text-muted-foreground">
                    尚無任務
                  </p>
                ) : (
                  projects.map((project) => {
                    const expanded =
                      projectsExpanded[project.key] ?? (project.hasSelected || project.active.length > 0)
                    const doneOpen = doneExpanded[project.key] ?? false

                    return (
                      <div key={project.key} className="rounded-md">
                        <button
                          type="button"
                          onClick={() =>
                            setProjectsExpanded((prev) => ({
                              ...prev,
                              [project.key]: !expanded,
                            }))
                          }
                          className={cn(
                            'flex w-full items-center gap-1 rounded px-1 py-1 text-xs text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
                            project.hasSelected && 'text-foreground'
                          )}
                          title={project.path ?? project.name}
                        >
                          {expanded ? (
                            <ChevronDown className="size-3 shrink-0" />
                          ) : (
                            <ChevronRight className="size-3 shrink-0" />
                          )}
                          <FolderOpen className="size-3 shrink-0" />
                          <span className="min-w-0 flex-1 truncate text-left font-medium">
                            {project.name}
                          </span>
                          <span className="tabular-nums text-muted-foreground">
                            {project.total}
                          </span>
                        </button>

                        {expanded && (
                          <div className="ml-3 space-y-0.5">
                            {project.active.length === 0 ? (
                              <p className="px-2 py-0.5 text-xs text-muted-foreground/60">
                                無進行中任務
                              </p>
                            ) : (
                              project.active.map((entry) => (
                                <TaskRow
                                  key={entry.task.id}
                                  entry={entry}
                                  selected={entry.task.id === selectedTaskId}
                                  onSelectTask={onSelectTask}
                                />
                              ))
                            )}

                            {project.done.length > 0 && (
                              <div>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDoneExpanded((prev) => ({
                                      ...prev,
                                      [project.key]: !doneOpen,
                                    }))
                                  }
                                  className="mt-1 flex w-full items-center gap-1 rounded px-2 py-0.5 text-xs text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                                >
                                  {doneOpen ? (
                                    <ChevronDown className="size-3 shrink-0" />
                                  ) : (
                                    <ChevronRight className="size-3 shrink-0" />
                                  )}
                                  <span className="flex-1 text-left">Done</span>
                                  <span className="tabular-nums">{project.done.length}</span>
                                </button>
                                {doneOpen && (
                                  <div className="space-y-0.5">
                                    {project.done.map((entry) => (
                                      <TaskRow
                                        key={entry.task.id}
                                        entry={entry}
                                        selected={entry.task.id === selectedTaskId}
                                        onSelectTask={onSelectTask}
                                      />
                                    ))}
                                  </div>
                                )}
                              </div>
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
