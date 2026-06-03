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
  Plus,
  Terminal as TerminalIcon,
  Trash2,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { TaskTerminal } from '@/components/task-terminal'
import { cn } from '@/lib/utils'
import type { BoardState, ColumnId } from '@/lib/types'

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
  onTaskDone: (taskId: string) => void
  onDeleteTask: (taskId: string) => void
}

export function KanbanBoard({
  board,
  onBoardChange,
  onNewTask,
  onReview,
  onTaskDone,
  onDeleteTask,
}: KanbanBoardProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggleExpanded = (taskId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
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
    next[to].splice(destination.index, 0, moved)
    onBoardChange(next)

    // Moving a card into Done finalizes it: tear down PTY + worktree.
    if (to === 'done' && from !== 'done') {
      onTaskDone(moved.id)
    }
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
        <Button size="sm" onClick={onNewTask}>
          <Plus />
          新增任務
        </Button>
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
                    'flex flex-col rounded-lg border bg-card p-3 transition-colors',
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
                                  <p className="mb-2 text-sm font-medium">
                                    {task.title}
                                  </p>
                                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                                    <span className="inline-flex items-center gap-1">
                                      <GitBranch className="size-3" />
                                      {task.branch}
                                    </span>
                                    {task.pushed && (
                                      <span className="text-[10px] uppercase tracking-wide text-emerald-500">
                                        pushed
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
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
                                <TaskTerminal taskId={task.id} cwd={cwd} />
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
