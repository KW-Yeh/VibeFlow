import { Circle, CircleCheck, CircleDot, Hand, Loader2, MessageCircleQuestion } from 'lucide-react'

import { SECTION_LABEL } from '@/components/ui/section-label'
import type { Activity, TaskProgress, TodoItem, TokenUsage } from '@/lib/types'
import { cn } from '@/lib/utils'

// Everything here is read from the agent's own transcript by core
// (packages/core/src/progress-tracker.ts); nothing is asked of the model.

/** Every token the usage represents (reasoning is already inside output). */
export function usageTotal(u: TokenUsage): number {
  return u.input + u.output + u.cacheRead + u.cacheWrite
}

/** 950 · 12.3k · 1.24M — compact enough for a card footer. */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

function todoCounts(todos: TodoItem[] | null): { done: number; total: number } | null {
  if (!todos || todos.length === 0) return null
  return { done: todos.filter((t) => t.status === 'completed').length, total: todos.length }
}

function activityLabel(activity: Activity): string | null {
  if (activity.state === 'waiting') return activity.waitingFor === 'permission' ? '等待權限' : '等待輸入'
  if (activity.state === 'working') return activity.tool ? `執行中：${activity.tool}` : '執行中'
  return null
}

function relativeTime(at: number | undefined): string | null {
  if (!at) return null
  const s = Math.max(0, Math.round((Date.now() - at) / 1000))
  if (s < 60) return `${s} 秒前`
  if (s < 3600) return `${Math.floor(s / 60)} 分鐘前`
  return `${Math.floor(s / 3600)} 小時前`
}

function ProgressBar({ done, total, className }: { done: number; total: number; className?: string }) {
  return (
    <span
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-label={`完成 ${done}/${total} 個步驟`}
      className={cn('relative block h-1 overflow-hidden rounded-full bg-border', className)}
    >
      <span
        className="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] motion-reduce:transition-none"
        style={{ width: `${(done / total) * 100}%` }}
      />
    </span>
  )
}

/**
 * The card's one-line summary: steps done, a thin bar, waiting state and
 * tokens. Running cards pass live `progress`; done cards only `usage`.
 */
export function TaskProgressBadge({
  progress,
  usage,
}: {
  progress?: TaskProgress | null
  usage?: TokenUsage
}) {
  const total = progress?.totalUsage ?? usage
  if (!progress && !total) return null
  const counts = todoCounts(progress?.todos ?? null)
  const waiting = progress?.activity.state === 'waiting'
  const tokens = total ? usageTotal(total) : 0
  return (
    <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
      {counts && (
        <>
          <span className="shrink-0 tabular-nums">
            {counts.done}/{counts.total}
          </span>
          <ProgressBar done={counts.done} total={counts.total} className="min-w-8 flex-1" />
        </>
      )}
      {!counts && <span className="flex-1" />}
      {waiting && (
        <span className="flex shrink-0 items-center gap-1 rounded-xs bg-primary/15 px-1.5 py-0.5 font-medium text-primary">
          {progress?.activity.waitingFor === 'permission' ? (
            <Hand className="size-2.5" />
          ) : (
            <MessageCircleQuestion className="size-2.5" />
          )}
          {progress?.activity.waitingFor === 'permission' ? '等待權限' : '等待輸入'}
        </span>
      )}
      {tokens > 0 && (
        <span className="shrink-0 tabular-nums" title={`${tokens.toLocaleString()} tokens`}>
          {formatTokens(tokens)} tok
        </span>
      )}
    </div>
  )
}

function TodoIcon({ status }: { status: TodoItem['status'] }) {
  if (status === 'completed') return <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-primary" />
  if (status === 'in_progress') return <CircleDot className="mt-0.5 size-3.5 shrink-0 text-foreground" />
  return <Circle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/60" />
}

function UsageTable({ usage, contextTokens }: { usage: TokenUsage; contextTokens?: number }) {
  const rows: [string, number][] = [
    ['輸入', usage.input],
    ['輸出', usage.output],
    ['快取讀取', usage.cacheRead],
    ['快取寫入', usage.cacheWrite],
  ]
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="text-right tabular-nums">{value.toLocaleString()}</dd>
        </div>
      ))}
      {usage.reasoning > 0 && (
        <div className="contents">
          <dt className="text-muted-foreground">　其中推理</dt>
          <dd className="text-right tabular-nums text-muted-foreground">{usage.reasoning.toLocaleString()}</dd>
        </div>
      )}
      <div className="contents font-medium">
        <dt>合計</dt>
        <dd className="text-right tabular-nums">{usageTotal(usage).toLocaleString()}</dd>
      </div>
      {contextTokens != null && contextTokens > 0 && (
        <div className="contents">
          <dt className="text-muted-foreground">目前 context</dt>
          <dd className="text-right tabular-nums text-muted-foreground">{contextTokens.toLocaleString()}</dd>
        </div>
      )}
    </dl>
  )
}

/** The task tab's progress section: the agent's todo list, what it is doing, and token usage. */
export function TaskProgressDetail({
  progress,
  usage,
}: {
  progress?: TaskProgress | null
  usage?: TokenUsage
}) {
  const total = progress?.totalUsage ?? usage
  if (!progress && !total) return null
  const counts = todoCounts(progress?.todos ?? null)
  const label = progress ? activityLabel(progress.activity) : null
  const when = progress ? relativeTime(progress.activity.at) : null
  const priorRuns = progress && usageTotal(progress.totalUsage) > usageTotal(progress.runUsage)

  return (
    <section className="space-y-3 rounded-md border border-border/70 p-3" aria-label="任務進度">
      {progress && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className={SECTION_LABEL}>進度</span>
            {counts && (
              <span className="text-xs tabular-nums text-muted-foreground">
                {counts.done}/{counts.total}
              </span>
            )}
            <span className="flex-1" />
            {label && (
              <span
                className={cn(
                  'flex items-center gap-1 text-xs',
                  progress.activity.state === 'waiting' ? 'text-primary' : 'text-muted-foreground'
                )}
              >
                {progress.activity.state === 'working' && (
                  <Loader2 className="size-3 animate-spin motion-reduce:animate-none" />
                )}
                {label}
                {when && <span className="text-muted-foreground">· {when}</span>}
              </span>
            )}
          </div>
          {counts && <ProgressBar done={counts.done} total={counts.total} />}
          {progress.todos && progress.todos.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {progress.todos.map((todo, i) => (
                <li key={todo.id ?? `${i}:${todo.content}`} className="flex items-start gap-2">
                  <TodoIcon status={todo.status} />
                  <span
                    className={cn(
                      'min-w-0 break-words',
                      todo.status === 'completed' && 'text-muted-foreground line-through',
                      todo.status === 'in_progress' && 'font-medium'
                    )}
                  >
                    {todo.status === 'in_progress' && todo.activeForm ? todo.activeForm : todo.content}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Agent 尚未建立待辦清單。</p>
          )}
        </div>
      )}
      {total && usageTotal(total) > 0 && (
        <div className="space-y-2">
          <span className={SECTION_LABEL}>Token 使用量{priorRuns ? '（含先前執行）' : ''}</span>
          <UsageTable usage={total} contextTokens={progress?.contextTokens} />
        </div>
      )}
    </section>
  )
}
