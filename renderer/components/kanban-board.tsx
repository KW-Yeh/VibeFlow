import { useState } from 'react'
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from '@hello-pangea/dnd'
import { GitBranch, Plus, Terminal } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type ColumnId = 'backlog' | 'in_progress' | 'done'

interface Task {
  id: string
  title: string
  branch: string
}

const COLUMNS: { id: ColumnId; title: string }[] = [
  { id: 'backlog', title: 'Backlog' },
  { id: 'in_progress', title: 'In Progress' },
  { id: 'done', title: 'Done' },
]

const INITIAL_TASKS: Record<ColumnId, Task[]> = {
  backlog: [
    { id: 'task-1', title: '搭建 Electron + Next.js 環境', branch: 'vf-task-1' },
    { id: 'task-2', title: '實作看板拖曳介面', branch: 'vf-task-2' },
  ],
  in_progress: [
    { id: 'task-3', title: '整合 node-pty 互動終端', branch: 'vf-task-3' },
  ],
  done: [],
}

export function KanbanBoard() {
  const [columns, setColumns] = useState(INITIAL_TASKS)

  const onDragEnd = (result: DropResult) => {
    const { source, destination } = result
    if (!destination) return

    const from = source.droppableId as ColumnId
    const to = destination.droppableId as ColumnId

    setColumns((prev) => {
      const next: Record<ColumnId, Task[]> = {
        backlog: [...prev.backlog],
        in_progress: [...prev.in_progress],
        done: [...prev.done],
      }
      const [moved] = next[from].splice(source.index, 1)
      next[to].splice(destination.index, 0, moved)
      return next
    })
  }

  return (
    <div className="min-h-screen bg-background p-6 text-foreground">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">VibeFlow</h1>
          <p className="text-sm text-muted-foreground">
            意圖驅動的本地開發看板
          </p>
        </div>
        <Button size="sm">
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
                      {columns[column.id].length}
                    </span>
                  </div>

                  <div className="flex min-h-24 flex-col gap-2">
                    {columns[column.id].map((task, index) => (
                      <Draggable
                        draggableId={task.id}
                        index={index}
                        key={task.id}
                      >
                        {(dragProvided, dragSnapshot) => (
                          <div
                            ref={dragProvided.innerRef}
                            {...dragProvided.draggableProps}
                            {...dragProvided.dragHandleProps}
                            className={cn(
                              'rounded-md border bg-background p-3 shadow-xs',
                              dragSnapshot.isDragging && 'ring-2 ring-ring'
                            )}
                          >
                            <p className="mb-2 text-sm font-medium">
                              {task.title}
                            </p>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                              <span className="inline-flex items-center gap-1">
                                <GitBranch className="size-3" />
                                {task.branch}
                              </span>
                              {column.id === 'in_progress' && (
                                <span className="inline-flex items-center gap-1">
                                  <Terminal className="size-3" />
                                  PTY
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </Draggable>
                    ))}
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
