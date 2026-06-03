import { useState } from 'react'
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from '@hello-pangea/dnd'
import {
  ChevronDown,
  ChevronRight,
  FolderGit2,
  GitBranch,
  GitCompare,
  Pencil,
  Play,
  Plus,
  Terminal as TerminalIcon,
  Trash2,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { TaskTerminal } from '@/components/task-terminal'
import { buildClaudeCommand } from '@/lib/claude'
import { cn } from '@/lib/utils'
import type { BoardState, ColumnId, Task } from '@/lib/types'

const COLUMNS: { id: ColumnId; title: string }[] = [
  { id: 'backlog', title: 'Backlog' },
  { id: 'in_progress', title: 'In Progress' },
  { id: 'done', title: 'Done' },
]

interface KanbanBoardProps {
  board: BoardState
  onBoardChange: (board: BoardState) => void
  onNewTask: () => void
  onReview: (taskId: string) => void
  onEditTask: (taskId: string) => void
  onTaskDone: (taskId: string) => void
  onDeleteTask: (taskId: string) => void
  /** Global Auto Mode: auto-run a card's Claude execution on entering In Progress. */
  autoMode: boolean
  onToggleAutoMode: () => void
}

interface LaunchEntry {
  command: string
  nonce: number
}

export function KanbanBoard({
  board,
  onBoardChange,
  onNewTask,
  onReview,
  onEditTask,
  onTaskDone,
  onDeleteTask,
  autoMode,
  onToggleAutoMode,
}: KanbanBoardProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // Per-task armed launch command; bumping `nonce` (re-)fires it in the terminal.
  const [launch, setLaunch] = useState<Record<string, LaunchEntry>>({})

  const toggleExpanded = (taskId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  // Expand the card and arm (or re-arm) its Claude launch command.
  const armLaunch = (task: Task) => {
    setExpanded((prev) => new Set(prev).add(task.id))
    setLaunch((prev) => ({
      ...prev,
      [task.id]: {
        command: buildClaudeCommand(task),
        nonce: (prev[task.id]?.nonce ?? 0) + 1,
      },
    }))
  }

  // Manual run (▶ button): always (re-)launches, and stamps launchedAt once.
  const runTask = (task: Task) => {
    armLaunch(task)
    if (!task.launchedAt) {
      const stamp = Date.now()
      onBoardChange({
        backlog: board.backlog.map((t) =>
          t.id === task.id ? { ...t, launchedAt: stamp } : t
        ),
        in_progress: board.in_progress.map((t) =>
          t.id === task.id ? { ...t, launchedAt: stamp } : t
        ),
        done: board.done.map((t) =>
          t.id === task.id ? { ...t, launchedAt: stamp } : t
        ),
      })
    }
  }

  const onDragEnd = (result: DropResult) => {
    const { source, destination } = result
    if (!destination) return
    if (
      source.droppableId === destination.droppableId &&
      source.index === destination.index
    ) {
      return
    }

    const from = source.droppableId as ColumnId
    const to = destination.droppableId as ColumnId

    const next: BoardState = {
      backlog: [...board.backlog],
      in_progress: [...board.in_progress],
      done: [...board.done],
    }
    const [moved] = next[from].splice(source.index, 1)

    // Entering In Progress auto-runs the card's Claude execution once, when
    // Auto Mode is on and it hasn't been launched before.
    let toInsert = moved
    let autoLaunch = false
    if (
      to === 'in_progress' &&
      from !== 'in_progress' &&
      autoMode &&
      !moved.launchedAt
    ) {
      toInsert = { ...moved, launchedAt: Date.now() }
      autoLaunch = true
    }

    next[to].splice(destination.index, 0, toInsert)
    onBoardChange(next)

    // Moving a card into Done finalizes it: tear down PTY + worktree.
    if (to === 'done' && from !== 'done') {
      onTaskDone(moved.id)
    }

    if (autoLaunch) armLaunch(toInsert)
  }

  return (
    <div className="min-h-screen bg-background p-6 text-foreground">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">VibeFlow</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            意圖驅動的本地開發看板 · 可同時管理多個專案
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={autoMode}
            onClick={onToggleAutoMode}
            title="開啟時：將卡片拖到 In Progress 會自動執行 Claude"
            className="flex items-center gap-2 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <span
              className={cn(
                'relative h-4 w-7 rounded-full transition-colors',
                autoMode ? 'bg-emerald-500' : 'bg-muted'
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 size-3 rounded-full bg-white transition-transform',
                  autoMode ? 'translate-x-3.5' : 'translate-x-0.5'
                )}
              />
            </span>
            Auto Mode
          </button>
          <Button size="sm" onClick={onNewTask}>
            <Plus />
            新增任務
          </Button>
        </div>
      </header>

      <DragDropContext onDragEnd={onDragEnd}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {COLUMNS.map((column) => (
            <Droppable droppableId={column.id} key={column.id}>
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className={cn(
                    'flex flex-col rounded-lg border border-border/40 bg-card p-3 transition-colors',
                    snapshot.isDraggingOver && 'bg-accent'
                  )}
                >
                  <div className="mb-3 flex items-center justify-between px-1">
                    <span className="text-sm font-semibold">
                      {column.title}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {board[column.id].length}
                    </span>
                  </div>

                  <div className="flex min-h-24 flex-col gap-2">
                    {board[column.id].map((task, index) => {
                      const isExpanded = expanded.has(task.id)
                      const cwd = task.worktreePath ?? task.projectPath ?? null
                      return (
                        <Draggable
                          draggableId={task.id}
                          index={index}
                          key={task.id}
                        >
                          {(dragProvided, dragSnapshot) => (
                            <div
                              ref={dragProvided.innerRef}
                              {...dragProvided.draggableProps}
                              className={cn(
                                'rounded-md border bg-background p-3 shadow-xs',
                                dragSnapshot.isDragging && 'ring-2 ring-ring'
                              )}
                            >
                              <div className="flex items-start gap-2">
                                {/* Drag handle limited to this region so the
                                    terminal below stays interactive. */}
                                <div
                                  {...dragProvided.dragHandleProps}
                                  className="min-w-0 flex-1 cursor-grab active:cursor-grabbing"
                                >
                                  {task.projectName && (
                                    <span className="mb-1.5 inline-flex max-w-full items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground">
                                      <FolderGit2 className="size-2.5 shrink-0" />
                                      <span className="truncate">
                                        {task.projectName}
                                      </span>
                                    </span>
                                  )}
                                  <p className="mb-2 break-words text-sm font-medium">
                                    {task.title}
                                  </p>
                                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                                    <span className="inline-flex min-w-0 max-w-full items-center gap-1">
                                      <GitBranch className="size-3 shrink-0" />
                                      <span className="break-all">
                                        {task.branch}
                                      </span>
                                    </span>
                                    {task.pushed && (
                                      <span className="text-[10px] uppercase tracking-wide text-emerald-500">
                                        pushed
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                  {cwd && (
                                    <button
                                      type="button"
                                      onClick={() => runTask(task)}
                                      title={
                                        task.launchedAt
                                          ? '重新執行（啟動 Claude）'
                                          : '開始執行（啟動 Claude）'
                                      }
                                      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-emerald-500"
                                    >
                                      <Play className="size-3.5" />
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => onEditTask(task.id)}
                                    title="編輯任務"
                                    className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                                  >
                                    <Pencil className="size-3.5" />
                                  </button>
                                  {task.worktreePath && (
                                    <button
                                      type="button"
                                      onClick={() => onReview(task.id)}
                                      title="審查變更"
                                      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                                    >
                                      <GitCompare className="size-3.5" />
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => toggleExpanded(task.id)}
                                    title={isExpanded ? '收合終端' : '展開終端'}
                                    className="flex items-center rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                                  >
                                    <TerminalIcon className="size-3.5" />
                                    {isExpanded ? (
                                      <ChevronDown className="size-3" />
                                    ) : (
                                      <ChevronRight className="size-3" />
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => onDeleteTask(task.id)}
                                    title="刪除卡片（並清理 worktree）"
                                    className="rounded p-1 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                                  >
                                    <Trash2 className="size-3.5" />
                                  </button>
                                </div>
                              </div>

                              {isExpanded && (
                                <>
                                  {task.description && (
                                    <p className="mt-2 whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2.5 text-xs text-muted-foreground">
                                      {task.description}
                                    </p>
                                  )}
                                  <TaskTerminal
                                    taskId={task.id}
                                    cwd={cwd}
                                    launchCommand={launch[task.id]?.command}
                                    launchNonce={launch[task.id]?.nonce ?? 0}
                                    onLaunchRequest={() => runTask(task)}
                                  />
                                </>
                              )}
                            </div>
                          )}
                        </Draggable>
                      )
                    })}
                    {provided.placeholder}
                  </div>
                </div>
              )}
            </Droppable>
          ))}
        </div>
      </DragDropContext>
    </div>
  )
}
