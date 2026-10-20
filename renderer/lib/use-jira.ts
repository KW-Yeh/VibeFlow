import { useCallback, useEffect, useRef, useState } from 'react'
import { getJiraInbox, onJiraAuthEvent } from '@/lib/api'
import type { JiraInbox, JiraScope } from '@/lib/types'

export function useJiraInbox(loaded: boolean, scope: JiraScope) {
  const [result, setResult] = useState<{ scope: JiraScope; inbox: JiraInbox } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const request = useRef(0)
  const load = useCallback(async (force: boolean) => {
    const id = ++request.current
    setLoading(true)
    setError(null)
    try {
      const next = await getJiraInbox({ force, scope })
      if (id === request.current && next) {
        setResult((previous) => ({ scope, inbox: next.error && previous?.scope === scope
          && previous.inbox.status === 'ok' && previous.inbox.tickets.length
          ? { ...previous.inbox, error: next.error } : next }))
      }
    } catch (err) {
      if (id === request.current) setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (id === request.current) setLoading(false)
    }
  }, [scope])
  useEffect(() => { if (loaded) void load(false) }, [loaded, load])
  useEffect(() => onJiraAuthEvent((event) => { if (event.type === 'success' || event.type === 'signed-out') void load(true) }), [load])
  return { inbox: result?.scope === scope ? result.inbox : null, loading, error, refresh: () => load(true), reload: () => load(false) }
}
