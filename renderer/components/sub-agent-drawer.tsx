import { useState } from 'react'
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Loader2,
  X,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import type { SubAgentRun, SubAgentStatus } from '@/lib/types'

interface SubAgentDrawerProps {
  open: boolean
  taskTitle: string
  runs: SubAgentRun[]
  onClose: () => void
}

const STATUS_META: Record<
  SubAgentStatus,
  { label: string; icon: typeof Bot; tone: string; spin?: boolean }
> = {
  running: {
    label: '執行中',
    icon: Loader2,
    tone: 'text-amber-500',
    spin: true,
  },
  completed: { label: '已完成', icon: CheckCircle2, tone: 'text-primary' },
  error: { label: '失敗', icon: AlertTriangle, tone: 'text-destructive' },
}

/** Copy-to-clipboard button shown beside a prompt/result block. */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const onCopy = () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <button
      type="button"
      onClick={onCopy}
      title="複製"
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <Copy className="size-3" />
      {copied ? '已複製' : '複製'}
    </button>
  )
}

/** Collapsible labeled text block (prompt / result), monospace + scrollable. */
function TextBlock({
  label,
  text,
  defaultOpen,
}: {
  label: string
  text: string
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(!!defaultOpen)
  return (
    <div className="rounded-md border border-border/40 bg-muted/30">
      <div className="flex items-center justify-between px-2 py-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
        >
          {open ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          )}
          {label}
        </button>
        {open && <CopyButton text={text} />}
      </div>
      {open && (
        <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words border-t border-border/40 px-2.5 py-2 text-[11px] leading-relaxed text-foreground/90">
          {text}
        </pre>
      )}
    </div>
  )
}

/** A single sub-agent run in the timeline. */
function RunItem({ run, index }: { run: SubAgentRun; index: number }) {
  const meta = STATUS_META[run.status]
  const Icon = meta.icon
  // Default-open the prompt of the first item / any still-running item so the
  // user lands on the most relevant content without extra clicks.
  const promptDefaultOpen = index === 0 || run.status === 'running'
  return (
    <li className="rounded-lg border border-border/40 bg-card p-3">
      <div className="mb-2 flex items-center gap-2">
        <Icon className={cn('size-4 shrink-0', meta.tone, meta.spin && 'animate-spin')} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {run.subagentType || '子代理'}
          {run.description ? (
            <span className="ml-1 font-normal text-muted-foreground">
              · {run.description}
            </span>
          ) : null}
        </span>
        <span className={cn('shrink-0 text-[10px] font-medium', meta.tone)}>
          {meta.label}
        </span>
      </div>
      <div className="space-y-2">
        <TextBlock label="Prompt" text={run.prompt} defaultOpen={promptDefaultOpen} />
        {run.status !== 'running' && run.result != null && (
          <TextBlock label="結果" text={run.result} />
        )}
      </div>
    </li>
  )
}

/**
 * Right-side slide-out drawer listing the sub-agents the card's agent spawned
 * via the Task tool — each with the prompt it received and its final result.
 * Read-only; the data is session-only (cleared on app restart).
 */
export function SubAgentDrawer({
  open,
  taskTitle,
  runs,
  onClose,
}: SubAgentDrawerProps) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-10 flex h-full w-full max-w-md flex-col border-l bg-card text-card-foreground shadow-lg">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-1.5 truncate text-lg font-semibold">
              <Bot className="size-4 shrink-0 text-primary" />
              子代理
            </h2>
            <p className="truncate text-xs text-muted-foreground">{taskTitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="關閉"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {runs.length === 0 ? (
            <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
              這個任務尚未衍生任何子代理
            </div>
          ) : (
            <ul className="space-y-3">
              {runs.map((run, i) => (
                <RunItem key={run.id} run={run} index={i} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
