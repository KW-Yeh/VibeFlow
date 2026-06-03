import React, { useCallback, useEffect, useState } from 'react'
import Head from 'next/head'

import { KanbanBoard } from '@/components/kanban-board'
import { NewTaskDialog } from '@/components/new-task-dialog'
import {
  createTask,
  getGitInfo,
  loadState,
  persistBoard,
  selectProject,
} from '@/lib/api'
import type { BoardState, GitInfo } from '@/lib/types'

// Rendered until the persisted state loads, and as a fallback when the
// Electron bridge is unavailable (plain browser / static export preview).
const FALLBACK_BOARD: BoardState = {
  backlog: [],
  in_progress: [],
  done: [],
}

export default function HomePage() {
  const [board, setBoard] = useState<BoardState>(FALLBACK_BOARD)
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

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
            />
            <NewTaskDialog
              open={dialogOpen}
              gitInfo={gitInfo}
              creating={creating}
              error={createError}
              onSubmit={handleCreateTask}
              onClose={() => setDialogOpen(false)}
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
