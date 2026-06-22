import { useState } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Eye,
  FolderOpen,
  Hammer,
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  RefreshCw,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { IconButton } from '@/components/ui/icon-button'
import type { BoardState, ColumnId, Workspace } from '@/lib/types'

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
}

const TASK_GROUPS: { id: ColumnId; label: string }[] = [
  { id: 'in_progress', label: 'In Progress' },
  { id: 'backlog', label: 'Backlog' },
  { id: 'done', label: 'Done' },
]

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
}: SideMenuProps) {
  const [tasksExpanded, setTasksExpanded] = useState<Record<string, boolean>>({
    in_progress: true,
    backlog: false,
    done: false,
  })
  const [workspacesExpanded, setWorkspacesExpanded] = useState(true)

  return (
    <aside
      className={cn(
        'flex flex-shrink-0 flex-col border-r border-border bg-card text-card-foreground transition-[width] duration-200',
        collapsed ? 'w-12' : 'w-64'
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
      <div className={cn('flex flex-1 flex-col py-2', collapsed ? 'overflow-hidden' : 'overflow-y-auto')}>
        {/* Workspaces section */}
        <div className="px-2 pb-2">
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
                  className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
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
                    <p className="px-2 py-1 text-[11px] text-muted-foreground">
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
        {!collapsed && <div className="mx-2 mb-2 border-t border-border" />}

        {/* Tasks section */}
        <div className="px-2">
          {collapsed ? (
            <button
              type="button"
              onClick={onNewTask}
              title="新增任務"
              className="mx-auto flex w-8 items-center justify-center rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Plus className="size-4" />
            </button>
          ) : (
            <>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Tasks
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

              <div className="space-y-1">
                {TASK_GROUPS.map((group) => (
                  <div key={group.id}>
                    <button
                      type="button"
                      onClick={() =>
                        setTasksExpanded((prev) => ({
                          ...prev,
                          [group.id]: !prev[group.id],
                        }))
                      }
                      className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      {tasksExpanded[group.id] ? (
                        <ChevronDown className="size-3 shrink-0" />
                      ) : (
                        <ChevronRight className="size-3 shrink-0" />
                      )}
                      <span className="flex-1 text-left">{group.label}</span>
                      <span className="tabular-nums">
                        {board[group.id].length}
                      </span>
                    </button>
                    {tasksExpanded[group.id] && (
                      <div className="ml-3 space-y-0.5">
                        {board[group.id].length === 0 ? (
                          <p className="px-2 py-0.5 text-[11px] text-muted-foreground/60">
                            空
                          </p>
                        ) : (
                          board[group.id].map((task) => {
                            const isSelected = task.id === selectedTaskId
                            const pipelineStage = task.pipeline?.stage
                            const statusIcon =
                              group.id === 'in_progress' ? (
                                pipelineStage === 'blocked' ? (
                                  <AlertTriangle className="size-3 shrink-0 text-destructive" />
                                ) : pipelineStage === 'reviewing' ? (
                                  <Eye className="size-3 shrink-0 text-amber-400" />
                                ) : pipelineStage === 'developing' || pipelineStage === 'revising' ? (
                                  <span className="size-3 shrink-0 flex items-center justify-center">
                                    <span className="size-1.5 rounded-full bg-amber-400 animate-pulse" />
                                  </span>
                                ) : task.pipeline ? (
                                  <Hammer className="size-3 shrink-0 opacity-60" />
                                ) : (
                                  <span className="size-3 shrink-0 flex items-center justify-center">
                                    <span className="size-1.5 rounded-full bg-primary/60" />
                                  </span>
                                )
                              ) : task.pipeline ? (
                                <Hammer className="size-3 shrink-0 opacity-60" />
                              ) : (
                                <span className="size-3 shrink-0" />
                              )

                            return (
                              <button
                                key={task.id}
                                type="button"
                                onClick={() => onSelectTask(task.id)}
                                className={cn(
                                  'flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs',
                                  isSelected
                                    ? 'bg-primary/15 font-medium text-primary'
                                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                                )}
                                title={task.title}
                              >
                                {statusIcon}
                                <span className="truncate">{task.title}</span>
                              </button>
                            )
                          })
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </aside>
  )
}
