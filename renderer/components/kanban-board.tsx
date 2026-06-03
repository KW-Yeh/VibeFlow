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
  FolderOpen,
  GitBranch,
  Plus,
  Terminal as TerminalIcon,
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
  projectPath: string | null
  onSelectProject: () => void
  onNewTask: () => void
}

export function KanbanBoard({
  board,
  onBoardChange,
  projectPath,
  onSelectProject,
  onNewTask,
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
  }

  return (
    <div className="min-h-screen bg-background p-6 text-foreground">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">VibeFlow</h1>
          <button
            type="button"
            onClick={onSelectProject}
            className="mt-1 inline-flex max-w-full items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            title="點擊以選擇專案資料夾"
          >
            <FolderOpen className="size-3.5 shrink-0" />
            <span className="truncate">
              {projectPath ?? '尚未選擇專案資料夾'}
            </span>
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={onSelectProject}>
            <FolderOpen />
            選擇專案
          </Button>
          <Button size="sm" onClick={onNewTask} disabled={!projectPath}>
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
                      const cwd = task.worktreePath ?? projectPath
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
                                <button
                                  type="button"
                                  onClick={() => toggleExpanded(task.id)}
                                  title={isExpanded ? '收合終端' : '展開終端'}
                                  className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                                >
                                  <TerminalIcon className="size-3.5" />
                                  {isExpanded ? (
                                    <ChevronDown className="size-3" />
                                  ) : (
                                    <ChevronRight className="size-3" />
                                  )}
                                </button>
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
