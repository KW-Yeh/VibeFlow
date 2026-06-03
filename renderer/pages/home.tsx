import React, { useEffect, useState } from 'react'
import Head from 'next/head'

import { KanbanBoard } from '@/components/kanban-board'
import { NewTaskDialog } from '@/components/new-task-dialog'
import { ReviewDialog } from '@/components/review-dialog'
import {
  approve,
  cleanupTask,
  createTask,
  deleteTask,
  getDiff,
  getGitInfo,
  loadState,
  persistBoard,
  pickFolder,
} from '@/lib/api'
import type { BoardState, DiffFile, Task } from '@/lib/types'

// Rendered until the persisted state loads, and as a fallback when the
// Electron bridge is unavailable (plain browser / static export preview).
const FALLBACK_BOARD: BoardState = {
  backlog: [],
  in_progress: [],
  done: [],
}

function findTask(board: BoardState, taskId: string): Task | null {
  for (const column of Object.values(board)) {
    const found = column.find((t) => t.id === taskId)
    if (found) return found
  }
  return null
}

export default function HomePage() {
  const [board, setBoard] = useState<BoardState>(FALLBACK_BOARD)
  const [loaded, setLoaded] = useState(false)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Review dialog state
  const [reviewTaskId, setReviewTaskId] = useState<string | null>(null)
  const [reviewTitle, setReviewTitle] = useState('')
  const [reviewFiles, setReviewFiles] = useState<DiffFile[]>([])
  const [reviewLoading, setReviewLoading] = useState(false)
  const [finalizing, setFinalizing] = useState(false)
  const [reviewResult, setReviewResult] = useState<{
    committed: boolean
    pushed: boolean
  } | null>(null)
  const [reviewError, setReviewError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    loadState().then((state) => {
      if (!active) return
      if (state) setBoard(state.board)
      setLoaded(true)
    })
    return () => {
      active = false
    }
  }, [])

  const handleBoardChange = (next: BoardState) => {
    setBoard(next)
    void persistBoard(next)
  }

  const handleOpenNewTask = () => {
    setCreateError(null)
    setDialogOpen(true)
  }

  const handleCreateTask = async (
    title: string,
    projectPath: string,
    baseBranch: string | null
  ) => {
    setCreating(true)
    setCreateError(null)
    try {
      const result = await createTask({ title, projectPath, baseBranch })
      if (result) {
        setBoard(result.state.board)
        setDialogOpen(false)
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  const handleReview = async (taskId: string) => {
    const task = findTask(board, taskId)
    setReviewTaskId(taskId)
    setReviewTitle(task?.title ?? taskId)
    setReviewResult(null)
    setReviewError(null)
    setReviewFiles([])
    setReviewLoading(true)
    try {
      setReviewFiles(await getDiff(taskId))
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : String(err))
    } finally {
      setReviewLoading(false)
    }
  }

  const handleApprove = async (message: string) => {
    if (!reviewTaskId) return
    setFinalizing(true)
    setReviewError(null)
    try {
      const res = await approve(reviewTaskId, message)
      if (res) {
        setReviewResult(res.result)
        setBoard(res.state.board)
      }
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : String(err))
    } finally {
      setFinalizing(false)
    }
  }

  const handleTaskDone = async (taskId: string) => {
    const state = await cleanupTask(taskId)
    if (state) setBoard(state.board)
  }

  const handleDeleteTask = async (taskId: string) => {
    const state = await deleteTask(taskId)
    if (state) setBoard(state.board)
  }

  return (
    <React.Fragment>
      <Head>
        <title>VibeFlow</title>
      </Head>
      <div className="dark">
        {loaded ? (
          <>
            <KanbanBoard
              board={board}
              onBoardChange={handleBoardChange}
              onNewTask={handleOpenNewTask}
              onReview={handleReview}
              onTaskDone={handleTaskDone}
              onDeleteTask={handleDeleteTask}
            />
            <NewTaskDialog
              open={dialogOpen}
              creating={creating}
              error={createError}
              pickFolder={pickFolder}
              loadGitInfo={getGitInfo}
              onSubmit={handleCreateTask}
              onClose={() => setDialogOpen(false)}
            />
            <ReviewDialog
              open={reviewTaskId !== null}
              taskTitle={reviewTitle}
              files={reviewFiles}
              loading={reviewLoading}
              finalizing={finalizing}
              result={reviewResult}
              error={reviewError}
              onApprove={handleApprove}
              onClose={() => setReviewTaskId(null)}
            />
          </>
        ) : (
          <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
            載入中…
          </div>
        )}
      </div>
    </React.Fragment>
  )
}
