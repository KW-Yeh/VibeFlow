import { X, Eye } from 'lucide-react'

import { TaskTerminal } from '@/components/task-terminal'
import { cn } from '@/lib/utils'
import type { Task } from '@/lib/types'

export interface ReviewerEntry {
  task: Task
  sessionKey: string
  cwd: string | null
  launchCommand?: string
  launchNonce?: number
  reviewerRoleName?: string
}

interface ReviewTerminalPanelProps {
  /**
   * Active reviewer sessions to keep mounted. One <TaskTerminal> is rendered
   * per entry and ALL stay mounted regardless of which one is visible — this
   * mirrors the executor `mounted` set so concurrent reviewers coexist and
   * switching/closing the panel never kills a running reviewer's PTY.
   */
  entries: ReviewerEntry[]
  /**
   * The task whose reviewer is currently shown. null → the whole panel is
   * CSS-hidden but every TaskTerminal stays mounted (PTY + scrollback survive).
   */
  visibleTaskId: string | null
  onClose: () => void
  onLaunchRequest: (taskId: string) => void
}

/**
 * Right-side slide-out panel hosting the reviewer PTY terminals.
 *
 * Mounting model — IMPORTANT:
 *   A TaskTerminal is rendered for every entry and kept mounted; only the entry
 *   matching `visibleTaskId` is shown (others use CSS `hidden`). We NEVER drop a
 *   terminal based on visibility because TaskTerminal's unmount cleanup kills the
 *   PTY. A reviewer session only ends when its entry leaves `entries` (i.e.
 *   killReviewerSession removed it from the active set).
 */
export function ReviewTerminalPanel({
  entries,
  visibleTaskId,
  onClose,
  onLaunchRequest,
}: ReviewTerminalPanelProps) {
  // No active reviewer sessions — nothing to keep alive, safe to fully unmount.
  if (entries.length === 0) return null

  const visible = entries.find((e) => e.task.id === visibleTaskId) ?? null

  return (
    // Outer overlay is CSS-hidden when nothing is selected; terminals stay mounted.
    <div className={cn('fixed inset-0 z-50 flex justify-end', !visible && 'hidden')}>
      {/* Semi-transparent backdrop: clicking it closes (hides) the panel. */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Panel */}
      <div className="relative z-10 flex h-full w-full max-w-xl flex-col border-l bg-card text-card-foreground shadow-lg">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b px-5 py-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-1.5 truncate text-lg font-semibold">
              <Eye className="size-4 shrink-0 text-amber-500" />
              Reviewer
            </h2>
            {visible && (
              <p className="truncate text-xs text-muted-foreground">
                {visible.reviewerRoleName
                  ? `${visible.reviewerRoleName} · ${visible.task.title}`
                  : visible.task.title}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            title="關閉 Reviewer 面板"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body: one terminal per active reviewer; only the selected one is shown.
            All remain mounted so their PTY sessions and scrollback survive. */}
        <div className="min-h-0 flex-1">
          {entries.map((e) => (
            <div
              key={e.task.id}
              className={cn(
                'h-full flex-col p-3',
                e.task.id === visibleTaskId ? 'flex' : 'hidden'
              )}
            >
              <TaskTerminal
                taskId={e.task.id}
                sessionKey={e.sessionKey}
                cwd={e.cwd}
                launchCommand={e.launchCommand}
                launchNonce={e.launchNonce ?? 0}
                launchLabel="啟動 Reviewer"
                onLaunchRequest={() => onLaunchRequest(e.task.id)}
                readOnly={false}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
