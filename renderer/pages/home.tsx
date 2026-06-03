import React, { useEffect, useState } from 'react'
import Head from 'next/head'

import { KanbanBoard } from '@/components/kanban-board'
import { loadState, persistBoard, selectProject } from '@/lib/api'
import type { BoardState } from '@/lib/types'

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

  useEffect(() => {
    let active = true
    loadState().then((state) => {
      if (!active) return
      if (state) {
        setBoard(state.board)
        setProjectPath(state.projectPath)
      }
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

  const handleSelectProject = async () => {
    const state = await selectProject()
    if (state) {
      setProjectPath(state.projectPath)
      setBoard(state.board)
    }
  }

  return (
    <React.Fragment>
      <Head>
        <title>VibeFlow</title>
      </Head>
      <div className="dark">
        {loaded ? (
          <KanbanBoard
            board={board}
            onBoardChange={handleBoardChange}
            projectPath={projectPath}
            onSelectProject={handleSelectProject}
          />
        ) : (
          <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
            載入中…
          </div>
        )}
      </div>
    </React.Fragment>
  )
}
