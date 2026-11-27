import { useEffect, useRef, useState, type RefObject } from 'react'

import { MessageBubbles } from '@/components/message-bubbles'
import { MessageDialog } from '@/components/message-dialog'
import type { Task, TaskProgress } from '@/lib/types'
import type { CardMessages } from '@/lib/use-card-messages'

const COMPACT_BELOW_PX = 360
const EDGE_PX = 16

type AsideBox = { width: number; right: number }

function useAsideBox(enabled: boolean, layerRef: RefObject<HTMLDivElement | null>): AsideBox | null {
  const [box, setBox] = useState<AsideBox | null>(null)
  useEffect(() => {
    if (!enabled) {
      setBox(null)
      return
    }
    const measure = () => {
      const container = layerRef.current?.parentElement
      const aside = Array.from(document.querySelectorAll<HTMLElement>('[data-workspace-aside]')).find((el) => el.offsetWidth > 0)
      if (!container || !aside) return setBox(null)
      const a = aside.getBoundingClientRect()
      const c = container.getBoundingClientRect()
      setBox((prev) => {
        const next = { width: Math.round(a.width), right: Math.round(c.right - a.right) }
        return prev && prev.width === next.width && prev.right === next.right ? prev : next
      })
    }
    measure()
    const observer = new ResizeObserver(measure)
    for (const el of document.querySelectorAll('[data-workspace-aside]')) observer.observe(el)
    if (layerRef.current?.parentElement) observer.observe(layerRef.current.parentElement)
    const timer = window.setInterval(measure, 1000)
    return () => {
      observer.disconnect()
      window.clearInterval(timer)
    }
  }, [enabled, layerRef])
  return box
}

interface MessageLayerProps {
  messages: CardMessages
  onWorkspace: boolean
  focusTaskId: string | null
  tasks: Map<string, { task: Task; running: boolean }>
  progress: Record<string, TaskProgress>
}

export function MessageLayer({ messages, onWorkspace, focusTaskId, tasks, progress }: MessageLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null)
  const aside = useAsideBox(onWorkspace, layerRef)
  const compact = !!aside && aside.width < COMPACT_BELOW_PX
  const titleOf = (id: string) => tasks.get(id)?.task.title
  const isMaster = (id: string) => tasks.get(id)?.task.role === 'master'
  const { open, setOpen, dismiss, revision } = messages
  const thread = open ? messages.threads.find((t) => t.from === open.from && t.to === open.to) : undefined

  return (
    <div
      ref={layerRef}
      style={{ right: (aside?.right ?? 0) + EDGE_PX }}
      className="pointer-events-none absolute bottom-4 top-16 z-40 flex flex-col items-end justify-end"
    >
      {thread ? (
        <MessageDialog
          key={`${thread.from}>${thread.to}`}
          thread={thread}
          revision={revision}
          running={tasks.get(thread.to)?.running ?? false}
          progress={progress[thread.to]}
          titleOf={titleOf}
          isMaster={isMaster}
          onMinimize={() => setOpen(null)}
          onClose={() => {
            setOpen(null)
            if (!thread.unread) dismiss(thread)
          }}
        />
      ) : (
        <MessageBubbles
          bubbles={messages.bubbles}
          focusTaskId={onWorkspace ? focusTaskId : null}
          compact={compact}
          isMaster={isMaster}
          onOpen={(t) => setOpen({ from: t.from, to: t.to })}
          onDismiss={dismiss}
        />
      )}
    </div>
  )
}
