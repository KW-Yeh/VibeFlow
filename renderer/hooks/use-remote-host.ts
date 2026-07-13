import { useEffect, useRef, useState } from 'react'
import type { BoardState, ColumnId, MemoryCheckpoint, Task, TaskProgressStep } from '@/lib/types'
import { getCheckpoints, getPlanHtml, onTermData, persistBoard, termInput } from '@/lib/api'

// ─── helpers ────────────────────────────────────────────────────────────────

type RemoteTask = {
  id: string
  title: string
  description?: string
  projectName?: string
  column: ColumnId
  progress?: {
    summary?: string
    steps: TaskProgressStep[]
  }
  pipeline?: { stage: NonNullable<Task['pipeline']>['stage']; round: number }
  launchedAt?: number
  plan?: { html: string }
  checkpoints?: MemoryCheckpoint[]
}

async function buildRemoteTask(task: Task, column: ColumnId): Promise<RemoteTask> {
  const remoteTask: RemoteTask = {
    id: task.id,
    title: task.title,
    description: task.description,
    projectName: task.projectName,
    column,
    progress: task.progress
      ? { summary: task.progress.summary, steps: task.progress.steps }
      : undefined,
    pipeline: task.pipeline
      ? { stage: task.pipeline.stage, round: task.pipeline.round }
      : undefined,
    launchedAt: task.launchedAt,
  }

  if (column !== 'done') return remoteTask

  const [planHtml, checkpoints] = await Promise.all([
    getPlanHtml(task.id).catch(() => null),
    getCheckpoints(task.id).catch(() => []),
  ])

  return {
    ...remoteTask,
    plan: planHtml ? { html: planHtml } : undefined,
    checkpoints,
  }
}

async function buildRemoteState(board: BoardState, autoMode: boolean) {
  const cols: ColumnId[] = ['backlog', 'in_progress', 'done']
  const tasks = await Promise.all(
    cols.flatMap((col) => board[col].map((task) => buildRemoteTask(task, col)))
  )

  return {
    capabilities: { createTask: false },
    tasks,
    // Workspaces were removed from the model; keep the field for wire compat.
    workspaces: [] as { id: string; name: string; available: boolean }[],
    settings: { autoMode },
  }
}

function moveBetweenColumns(board: BoardState, taskId: string, target: ColumnId): BoardState {
  const cols: ColumnId[] = ['backlog', 'in_progress', 'done']
  let task: Task | undefined
  const next = { ...board }
  for (const col of cols) {
    const i = next[col].findIndex(t => t.id === taskId)
    if (i !== -1) {
      task = next[col][i]
      next[col] = next[col].filter(t => t.id !== taskId)
      break
    }
  }
  if (!task) return board
  next[target] = [task, ...next[target]]
  return next
}

// ─── hook ────────────────────────────────────────────────────────────────────

export function useRemoteHost({
  board,
  autoMode,
  onStateChange,
}: {
  board: BoardState
  autoMode: boolean
  onStateChange: (board: BoardState) => void
}) {
  const [roomCode, setRoomCode] = useState<string | null>(null)
  const [peerCount, setPeerCount] = useState(0)

  // Use refs so async message handlers always see latest values.
  const peersRef = useRef<Set<any>>(new Set())
  const termSubsRef = useRef<Map<string, Set<any>>>(new Map())
  const boardRef = useRef(board)
  const autoModeRef = useRef(autoMode)
  const onStateChangeRef = useRef(onStateChange)

  useEffect(() => { boardRef.current = board }, [board])
  useEffect(() => { autoModeRef.current = autoMode }, [autoMode])
  useEffect(() => { onStateChangeRef.current = onStateChange }, [onStateChange])

  // ── broadcast state on every board change ────────────────────────────────
  useEffect(() => {
    if (!peersRef.current.size) return
    let cancelled = false

    void buildRemoteState(board, autoMode).then((state) => {
      if (cancelled) return
      for (const conn of peersRef.current) {
        try { conn.send({ type: 'vf:state', payload: state }) } catch { /* conn closed */ }
      }
    })

    return () => { cancelled = true }
  }, [board, autoMode])

  // ── handle incoming message from a remote client ──────────────────────────
  async function handleMessage(raw: unknown, conn: any) {
    if (!raw || typeof raw !== 'object') return
    const { type, payload } = raw as { type: string; payload?: any }

    switch (type) {
      case 'client:get-state':
        try {
          conn.send({
            type: 'vf:state',
            payload: await buildRemoteState(boardRef.current, autoModeRef.current),
          })
        } catch { /* ignored */ }
        break

      case 'client:send-command': {
        const { taskId, text } = payload ?? {}
        if (!taskId || !text) break
        termInput(taskId, String(text).slice(0, 1000))
        break
      }

      case 'client:subscribe-terminal': {
        const { taskId } = payload ?? {}
        if (!taskId) break
        let set = termSubsRef.current.get(taskId)
        if (!set) { set = new Set(); termSubsRef.current.set(taskId, set) }
        set.add(conn)
        break
      }

      case 'client:unsubscribe-terminal': {
        const { taskId } = payload ?? {}
        if (taskId) termSubsRef.current.get(taskId)?.delete(conn)
        break
      }

      case 'client:move-task': {
        const { taskId, targetColumn } = payload ?? {}
        if (!taskId || !targetColumn) break
        const newBoard = moveBetweenColumns(boardRef.current, taskId, targetColumn)
        onStateChangeRef.current(newBoard)
        await persistBoard(newBoard)
        break
      }
    }
  }

  // ── start PeerJS host when roomCode is set ────────────────────────────────
  useEffect(() => {
    if (!roomCode) return

    let destroyed = false
    let peer: any

    async function init() {
      const { Peer } = await import('peerjs')
      if (destroyed) return

      peer = new Peer(`vibeflow-${roomCode}`)

      peer.on('connection', (conn: any) => {
        peersRef.current.add(conn)
        setPeerCount(c => c + 1)

        conn.on('open', () => {
          void (async () => {
            try {
              conn.send({ type: 'vf:hello', payload: { version: '1.0' } })
              conn.send({
                type: 'vf:state',
                payload: await buildRemoteState(boardRef.current, autoModeRef.current),
              })
            } catch { /* ignored */ }
          })()
        })

        conn.on('data', (raw: unknown) => { void handleMessage(raw, conn) })

        conn.on('close', () => {
          peersRef.current.delete(conn)
          setPeerCount(c => c - 1)
          for (const [, set] of termSubsRef.current) set.delete(conn)
        })
      })

      peer.on('error', (err: Error) => {
        console.error('[VibeFlow Remote] PeerJS error:', err)
      })
    }

    void init()

    return () => {
      destroyed = true
      for (const conn of peersRef.current) { try { conn.close() } catch { /* ignored */ } }
      peersRef.current.clear()
      termSubsRef.current.clear()
      setPeerCount(0)
      peer?.destroy()
    }
  }, [roomCode]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── forward terminal output to subscribed remote clients ──────────────────
  useEffect(() => {
    if (!roomCode) return
    return onTermData(({ sessionKey, data }) => {
      const taskId = sessionKey.split(':')[0]
      const subs = termSubsRef.current.get(taskId)
      if (!subs?.size) return
      const msg = { type: 'vf:terminal-chunk', payload: { taskId, data } }
      for (const conn of subs) {
        try { conn.send(msg) } catch { /* conn closed */ }
      }
    })
  }, [roomCode])

  return {
    roomCode,
    peerCount,
    startSharing: () => {
      const code = String(Math.floor(100000 + Math.random() * 900000))
      setRoomCode(code)
    },
    stopSharing: () => setRoomCode(null),
  }
}
