import { useEffect, useState } from 'react'

import { MessageBubbles } from '@/components/message-bubbles'
import { MessageDialog } from '@/components/message-dialog'
import type { Task, TaskProgress } from '@/lib/types'
import type { CardMessages } from '@/lib/use-card-messages'

const ASIDE_WIDTH_VAR = '--vf-workspace-aside'
const COMPACT_BELOW_PX = 360

function useAsideWidth(enabled: boolean): number | null {
  const [width, setWidth] = useState<number | null>(null)
  useEffect(() => {
    if (!enabled) return
    const read = () => {
      const px = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(ASIDE_WIDTH_VAR))
      setWidth(Number.isFinite(px) ? px : null)
    }
    read()
    const observer = new MutationObserver(read)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
    return () => observer.disconnect()
  }, [enabled])
  return width
}

interface MessageLayerProps {
  messages: CardMessages
  onWorkspace: boolean
  focusTaskId: string | null
  tasks: Map<string, { task: Task; running: boolean }>
  progress: Record<string, TaskProgress>
}

export function MessageLayer({ messages, onWorkspace, focusTaskId, tasks, progress }: MessageLayerProps) {
  const asideWidth = useAsideWidth(onWorkspace)
  const compact = onWorkspace && asideWidth !== null && asideWidth < COMPACT_BELOW_PX
  const titleOf = (id: string) => tasks.get(id)?.task.title
  const isMaster = (id: string) => tasks.get(id)?.task.role === 'master'
  const { open, setOpen, dismiss, revision } = messages
  const thread = open ? messages.threads.find((t) => t.from === open.from && t.to === open.to) : undefined

  return (
    <div className="pointer-events-none absolute bottom-4 right-4 top-16 z-40 flex flex-col items-end justify-end">
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
