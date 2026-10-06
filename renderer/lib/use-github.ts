import { useCallback, useEffect, useRef, useState } from 'react'

import { getGithubInbox, getGithubTaskLinks } from '@/lib/api'
import type { BoardState, GithubInbox, GithubTaskLinks } from '@/lib/types'

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** The board's projects — the set of repos the inbox is about. */
function projectSignature(board: BoardState): string {
  const paths = new Set<string>()
  for (const column of Object.values(board)) for (const t of column) if (t.projectPath) paths.add(t.projectPath)
  return Array.from(paths).sort().join('\n')
}

/** What decides a card's Issue/PR: its source, branch, and whether that branch is real yet. */
function linkSignature(board: BoardState): string {
  const parts: string[] = []
  for (const column of Object.values(board)) {
    for (const t of column) {
      parts.push(
        [t.id, t.projectPath, t.branch, t.provisionedAt ?? '', t.github?.number ?? '', t.outcome?.pr?.number ?? ''].join('|')
      )
    }
  }
  return parts.sort().join('\n')
}

export function useGithubInbox(board: BoardState, loaded: boolean) {
  const [inbox, setInbox] = useState<GithubInbox | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const request = useRef(0)

  const load = useCallback(async (force: boolean) => {
    const id = ++request.current
    setLoading(true)
    setError(null)
    try {
      const next = await getGithubInbox({ force })
      if (id === request.current) setInbox(next)
    } catch (err) {
      if (id === request.current) setError(errorText(err))
    } finally {
      if (id === request.current) setLoading(false)
    }
  }, [])

  const signature = projectSignature(board)
  useEffect(() => {
    if (loaded) void load(false)
  }, [loaded, signature, load])

  return { inbox, loading, error, refresh: () => load(true), reload: () => load(false) }
}

export function useGithubTaskLinks(board: BoardState, loaded: boolean) {
  const [links, setLinks] = useState<Record<string, GithubTaskLinks>>({})
  const request = useRef(0)

  const load = useCallback(async (force: boolean) => {
    const id = ++request.current
    try {
      const next = await getGithubTaskLinks({ force })
      if (id === request.current) setLinks(next)
    } catch {
      // Links are decoration: a failed lookup leaves the cards as they were.
    }
  }, [])

  const signature = linkSignature(board)
  useEffect(() => {
    if (loaded) void load(false)
  }, [loaded, signature, load])

  return { links, refresh: () => load(true) }
}
