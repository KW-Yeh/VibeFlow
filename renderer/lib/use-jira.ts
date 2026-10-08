import { useCallback, useEffect, useRef, useState } from 'react'
import { getJiraInbox, onJiraAuthEvent } from '@/lib/api'
import type { JiraInbox } from '@/lib/types'

export function useJiraInbox(loaded: boolean) {
  const [inbox, setInbox] = useState<JiraInbox | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const request = useRef(0)
  const load = useCallback(async (force: boolean) => {
    const id = ++request.current
    setLoading(true)
    setError(null)
    try {
      const next = await getJiraInbox({ force })
      if (id === request.current && next) setInbox((previous) => next.error && previous?.status === 'ok' && previous.tickets.length
        ? { ...previous, error: next.error } : next)
    } catch (err) {
      if (id === request.current) setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (id === request.current) setLoading(false)
    }
  }, [])
  useEffect(() => { if (loaded) void load(false) }, [loaded, load])
  useEffect(() => onJiraAuthEvent((event) => { if (event.type === 'success' || event.type === 'signed-out') void load(true) }), [load])
  return { inbox, loading, error, refresh: () => load(true), reload: () => load(false) }
}
