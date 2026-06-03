import React, { useCallback, useEffect, useState } from 'react'
import Head from 'next/head'

import { KanbanBoard } from '@/components/kanban-board'
import { NewTaskDialog } from '@/components/new-task-dialog'
import { ReviewDialog } from '@/components/review-dialog'
import {
  approve,
  cleanupTask,
  createTask,
  getDiff,
  getGitInfo,
  loadState,
  persistBoard,
  selectProject,
} from '@/lib/api'
import type { BoardState, DiffFile, GitInfo, Task } from '@/lib/types'

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
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null)
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

  const refreshGitInfo = useCallback(async () => {
    const info = await getGitInfo()
    setGitInfo(info)
  }, [])

  useEffect(() => {
    let active = true
    loadState().then((state) => {
      if (!active) return
      if (state) {
        setBoard(state.board)
        setProjectPath(state.projectPath)
        if (state.projectPath) void refreshGitInfo()
      }
      setLoaded(true)
    })
    return () => {
      active = false
    }
  }, [refreshGitInfo])

  const handleBoardChange = (next: BoardState) => {
    setBoard(next)
    void persistBoard(next)
  }

  const handleSelectProject = async () => {
    const state = await selectProject()
    if (state) {
      setProjectPath(state.projectPath)
      setBoard(state.board)
      await refreshGitInfo()
    }
  }

  const handleOpenNewTask = async () => {
    setCreateError(null)
    await refreshGitInfo()
    setDialogOpen(true)
  }

  const handleCreateTask = async (title: string, baseBranch: string | null) => {
    setCreating(true)
    setCreateError(null)
    try {
      const result = await createTask({ title, baseBranch })
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
              projectPath={projectPath}
              onSelectProject={handleSelectProject}
              onNewTask={handleOpenNewTask}
              onReview={handleReview}
              onTaskDone={handleTaskDone}
            />
            <NewTaskDialog
              open={dialogOpen}
              gitInfo={gitInfo}
              creating={creating}
              error={createError}
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
