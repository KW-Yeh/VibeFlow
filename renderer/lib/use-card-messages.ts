import { useCallback, useEffect, useMemo, useState } from 'react'

import { getMessageThreads, onMessagesChanged } from '@/lib/api'
import type { CardMessageThreadSummary } from '@/lib/types'

const DISMISSED_KEY = 'vibeflow:message-bubbles-dismissed'

export interface ThreadKey {
  from: string
  to: string
}

export const threadKey = (t: ThreadKey) => `${t.from}>${t.to}`

function readDismissed(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeDismissed(value: Record<string, string>): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(value))
  } catch {
    // Private mode or blocked storage: the bubble just comes back next load.
  }
}

export interface CardMessages {
  threads: CardMessageThreadSummary[]
  /** Threads that float as bubbles: any with unread messages, and read ones not closed since their last message. */
  bubbles: CardMessageThreadSummary[]
  unreadByTask: Record<string, number>
  totalUnread: number
  /** Bumps on every change, so an open conversation knows to re-read. */
  revision: number
  open: ThreadKey | null
  setOpen: (key: ThreadKey | null) => void
  dismiss: (thread: CardMessageThreadSummary) => void
}

export function useCardMessages(): CardMessages {
  const [threads, setThreads] = useState<CardMessageThreadSummary[]>([])
  const [revision, setRevision] = useState(0)
  const [dismissed, setDismissed] = useState<Record<string, string>>({})
  const [open, setOpen] = useState<ThreadKey | null>(null)

  useEffect(() => {
    setDismissed(readDismissed())
    let alive = true
    const refresh = () => {
      void getMessageThreads().then((next) => {
        if (alive) setThreads(next)
      }).catch(() => {})
    }
    refresh()
    const stop = onMessagesChanged(() => {
      refresh()
      setRevision((r) => r + 1)
    })
    return () => {
      alive = false
      stop()
    }
  }, [])

  const dismiss = useCallback((thread: CardMessageThreadSummary) => {
    setDismissed((current) => {
      const next = { ...current, [threadKey(thread)]: thread.last.id }
      writeDismissed(next)
      return next
    })
  }, [])

  const derived = useMemo(() => {
    const unreadByTask: Record<string, number> = {}
    let totalUnread = 0
    for (const t of threads) {
      if (!t.unread) continue
      unreadByTask[t.to] = (unreadByTask[t.to] ?? 0) + t.unread
      totalUnread += t.unread
    }
    const bubbles = threads.filter((t) => t.unread > 0 || dismissed[threadKey(t)] !== t.last.id)
    return { unreadByTask, totalUnread, bubbles }
  }, [threads, dismissed])

  return { threads, revision, open, setOpen, dismiss, ...derived }
}
