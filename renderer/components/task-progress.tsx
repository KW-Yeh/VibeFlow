import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Circle, CircleCheck, CircleDot, Loader2 } from 'lucide-react'

import { AnimatedNumber } from '@/components/ui/animated-number'
import { createPresenceVariants, MOTION_PULSE, MOTION_SPRING } from '@/lib/motion'

import { SECTION_LABEL } from '@/components/ui/section-label'
import { normalizeRuns } from '@/lib/run-records'
import type { Activity, RunEnd, RunRecord, TaskProgress, TodoItem, TokenUsage } from '@/lib/types'
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
      <motion.span
        className="absolute inset-0 origin-left rounded-full bg-primary"
        initial={false}
        animate={{ scaleX: total > 0 ? done / total : 0 }}
        transition={MOTION_SPRING.layout}
      />
    </span>
  )
}

/**
 * A state shown as a spinner while it runs, otherwise as a dot of `dot`'s color.
 * A change of state cross-fades, and stopping for a permission pulses once, so
 * a card that just started waiting on the user is noticed.
 */
export function StatusMark({
  dot,
  spinning,
  label,
  className,
}: {
  dot: string
  spinning?: boolean
  label: string
  className?: string
}) {
  const reducedMotion = useReducedMotion() ?? false
  const variants = createPresenceVariants({ timing: 'micro', transform: { scale: 0.5 }, reducedMotion })
  const permission = label === '等待權限'
  return (
    <span role="img" aria-label={label} title={label} className="relative flex shrink-0 items-center justify-center">
      <AnimatePresence mode="popLayout" initial={false}>
        {spinning ? (
          <motion.span key="spinning" variants={variants} initial="hidden" animate="visible" exit="exit" className={cn('flex', className)}>
            <Loader2 aria-hidden="true" className="size-3 animate-spin text-warning motion-reduce:animate-none" />
          </motion.span>
        ) : (
          <motion.span
            key={`${dot}-${permission}`}
            variants={variants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className={cn('relative size-1.5 rounded-full', dot, className)}
          >
            {permission && !reducedMotion && (
              <motion.span
                aria-hidden="true"
                initial={{ scale: 1, opacity: 0.7 }}
                animate={{ scale: 3, opacity: 0 }}
                transition={MOTION_PULSE}
                className={cn('absolute inset-0 rounded-full', dot)}
              />
            )}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  )
}

/** What a running card's agent is doing: working, or stopped for an answer or a permission. */
export function activityMark(activity: Activity | undefined): { dot: string; spinning: boolean; label: string } {
  if (activity?.state === 'waiting') {
    return activity.waitingFor === 'permission'
      ? { dot: 'bg-warning', spinning: false, label: '等待權限' }
      : { dot: 'bg-primary', spinning: false, label: '等待輸入' }
  }
  return { dot: 'bg-warning', spinning: true, label: activity?.tool ? `執行中：${activity.tool}` : '執行中' }
}

/**
 * The card's one-line summary: steps done, a thin bar, what the agent is
 * doing and tokens. Running cards pass live `progress`; done cards only `usage`.
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
  const tokens = total ? usageTotal(total) : 0
  return (
    <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
      {progress && <StatusMark {...activityMark(progress.activity)} />}
      {counts && (
        <>
          <span className="shrink-0 tabular-nums">
            {counts.done}/{counts.total}
          </span>
          <ProgressBar done={counts.done} total={counts.total} className="min-w-8 flex-1" />
        </>
      )}
      {!counts && <span className="flex-1" />}
      {tokens > 0 && (
        <span className="shrink-0 tabular-nums" title={`${tokens.toLocaleString()} tokens`}>
          <AnimatedNumber value={tokens} format={formatTokens} /> tok
        </span>
      )}
    </div>
  )
}

/** Steps done and what the agent is doing — sized for a toolbar. `mark: false` when the row already shows it. */
export function TaskProgressChip({ progress, mark = true }: { progress?: TaskProgress | null; mark?: boolean }) {
  const counts = todoCounts(progress?.todos ?? null)
  const showMark = mark && Boolean(progress)
  if (!counts && !showMark) return null
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
      {showMark && <StatusMark {...activityMark(progress?.activity)} />}
      {counts && (
        <>
          <ProgressBar done={counts.done} total={counts.total} className="w-10" />
          <span className="tabular-nums">
            {counts.done}/{counts.total}
          </span>
        </>
      )}
    </span>
  )
}

function TodoIcon({ status }: { status: TodoItem['status'] }) {
  const reducedMotion = useReducedMotion() ?? false
  const variants = createPresenceVariants({ timing: 'micro', transform: { scale: 0.5 }, reducedMotion })
  const icon =
    status === 'completed' ? <CircleCheck className="size-3.5 text-primary" />
    : status === 'in_progress' ? <CircleDot className="size-3.5 text-foreground" />
    : <Circle className="size-3.5 text-muted-foreground/60" />
  return (
    <span className="relative mt-0.5 flex size-3.5 shrink-0">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={status} variants={variants} initial="hidden" animate="visible" exit="exit" className="flex">
          {icon}
        </motion.span>
      </AnimatePresence>
    </span>
  )
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
          <dd className="text-right tabular-nums"><AnimatedNumber value={value} /></dd>
        </div>
      ))}
      {usage.reasoning > 0 && (
        <div className="contents">
          <dt className="text-muted-foreground">　其中推理</dt>
          <dd className="text-right tabular-nums text-muted-foreground"><AnimatedNumber value={usage.reasoning} /></dd>
        </div>
      )}
      <div className="contents font-medium">
        <dt>合計</dt>
        <dd className="text-right tabular-nums"><AnimatedNumber value={usageTotal(usage)} /></dd>
      </div>
      {contextTokens != null && contextTokens > 0 && (
        <div className="contents">
          <dt className="text-muted-foreground">目前 context</dt>
          <dd className="text-right tabular-nums text-muted-foreground"><AnimatedNumber value={contextTokens} /></dd>
        </div>
      )}
    </dl>
  )
}

const RUN_END_LABEL: Record<RunEnd, string> = { restart: '重新開始', completed: '完成', handoff: '交接' }
const COMPLEXITY_LABEL: Record<string, string> = { simple: '簡單', moderate: '中等', complex: '複雜', unclear: '不明確' }

/** One line per finished run: what it ran on, what it cost, and how it ended. */
function RunHistory({ runs }: { runs: RunRecord[] }) {
  return (
    <div className="space-y-2">
      <span className={SECTION_LABEL}>執行紀錄</span>
      <ol className="space-y-1 text-sm">
        {runs.map((run, i) => (
          <li key={`${run.runId ?? ''}:${run.startedAt}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="tabular-nums text-muted-foreground">#{i + 1}</span>
            <span className="font-medium">{run.model ?? 'CLI 預設'}</span>
            <span className="text-muted-foreground">
              {[run.effort ?? '預設 effort', run.complexity && COMPLEXITY_LABEL[run.complexity]].filter(Boolean).join(' · ')}
            </span>
            <span className="ml-auto tabular-nums text-muted-foreground">
              {run.calls} 次呼叫 · {formatTokens(usageTotal(run.usage))} · {RUN_END_LABEL[run.endedBy]}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** The task tab's progress section: the agent's todo list, what it is doing, token usage, and the runs that ended. */
export function TaskProgressDetail({
  progress,
  usage,
  runs,
}: {
  progress?: TaskProgress | null
  usage?: TokenUsage
  runs?: unknown
}) {
  const total = progress?.totalUsage ?? usage
  if (!progress && !total) return null
  const history = normalizeRuns(runs)
  const counts = todoCounts(progress?.todos ?? null)
  const label = progress ? activityLabel(progress.activity) : null
  const when = progress ? relativeTime(progress.activity.at) : null
  const priorRuns = progress && usageTotal(progress.totalUsage) > usageTotal(progress.runUsage)
  const reducedMotion = useReducedMotion() ?? false
  const todoVariants = createPresenceVariants({ timing: 'standard', transform: { y: -4 }, reducedMotion })

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
              <AnimatePresence initial={false}>
              {progress.todos.map((todo, i) => (
                <motion.li
                  key={todo.id ?? `${i}:${todo.content}`}
                  layout="position"
                  variants={todoVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className="flex items-start gap-2"
                >
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
                </motion.li>
              ))}
              </AnimatePresence>
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
      {history.length > 0 && <RunHistory runs={history} />}
    </section>
  )
}
