import { useEffect, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { FileText, Loader2, Moon, Square } from 'lucide-react'

import { MarkdownContent } from '@/components/markdown-content'
import { Button } from '@/components/ui/button'
import { DialogShell } from '@/components/ui/dialog-shell'
import { fieldClass } from '@/components/ui/field'
import {
  loadState,
  listReports,
  readReport,
  setRelease,
  setSettings,
  setTaskStatus,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import { taskStatus } from '@/lib/status'
import type { AutonomousSettings, BoardState, ReleaseState, ReportEntry, Task } from '@/lib/types'

/*
 * The night shift's minimal UI: 下班派工 (the release switch), 改方向重派,
 * the morning reports and their settings (spec: docs/features/night-shift/).
 */

const SLOT_FREEING = ['needs_review', 'stuck', 'pr_opened', 'ready']

function occupied(board: BoardState): number {
  return board.in_progress.filter((t) => {
    if (t.role === 'master') return false
    const status = taskStatus(t)
    return !status || !SLOT_FREEING.includes(status)
  }).length
}

/** Same order and rules as core's dispatchable(): 待辦, then running cards marked to go again. */
function tonightCount(board: BoardState): number {
  const done = new Set(board.done.map((t) => t.id))
  const ready = (t: Task) => t.role !== 'master' && taskStatus(t) === 'ready' && !t.quotaWait && (t.after ?? []).every((id) => done.has(id))
  return [
    ...board.backlog.filter(ready),
    ...board.in_progress.filter((t) => ready(t) && t.launchedAt && t.worktreePath),
  ].length
}

// ---------------------------------------------------------------------------
// 下班派工
// ---------------------------------------------------------------------------

export function ReleaseControl({
  board,
  release,
  concurrency,
  onOpenReports,
}: {
  board: BoardState
  release: ReleaseState | undefined
  concurrency: number
  onOpenReports: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const on = release?.enabled === true
  const tonight = tonightCount(board)
  const run = async (enabled: boolean) => {
    setBusy(true)
    setError(null)
    try {
      await setRelease(enabled)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex items-center gap-2 text-sm">
      {on ? (
        <>
          <span
            role="status"
            className="flex items-center gap-1.5 rounded-full border border-success/50 bg-success/15 px-2.5 py-1 text-xs text-success"
            title="執行中名額 / 並行上限 · 還沒派出的今晚卡片"
          >
            <Moon className="size-3" />
            夜班進行中 <span className="tabular-nums">{occupied(board)}/{concurrency} · 待派 {tonight}</span>
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(false)}
            title="不再派出新卡片；執行中的卡片繼續跑完，並產生晨報"
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground outline-none transition-colors motion-reduce:transition-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : <Square className="size-3" />}
            停止派工
          </button>
        </>
      ) : (
        <button
          type="button"
          disabled={busy || tonight === 0}
          onClick={() => void run(true)}
          title={tonight === 0
            ? '還沒有排進今晚的卡片：在卡片選單按「排進今晚」，或把卡片標成「準備開工」'
            : `依序派出 ${tonight} 張準備開工的卡片，同時最多 ${concurrency} 張；早上按「停止派工」產生晨報`}
          className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-foreground outline-none transition-colors motion-reduce:transition-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:text-muted-foreground disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-3 animate-spin" /> : <Moon className="size-3" />}
          下班派工 <span className="tabular-nums">（{tonight}）</span>
        </button>
      )}
      <button
        type="button"
        onClick={onOpenReports}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground outline-none transition-colors motion-reduce:transition-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <FileText className="size-3" />
        晨報
      </button>
      {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 改方向重派
// ---------------------------------------------------------------------------

/** Mark a running card to go out again with the next 下班派工, with the correction it should start from. */
export function RedoDialog({ task, onClose }: { task: Task | null; onClose: () => void }) {
  return (
    <AnimatePresence>
      {task && <RedoDialogBody key={task.id} task={task} onClose={onClose} />}
    </AnimatePresence>
  )
}

function RedoDialogBody({ task, onClose }: { task: Task; onClose: () => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    if (!text.trim()) return
    setBusy(true)
    setError(null)
    try {
      await setTaskStatus(task.id, 'ready', text.trim())
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <DialogShell title="改方向重派" showHeader onClose={onClose} contentClassName="max-w-[560px]">
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          「{task.title}」會排進今晚。下次下班派工時，它在同一個分支上換新 session 接續，先讀你寫的修正方向。
        </p>
        <textarea
          aria-label="修正方向"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void save()
          }}
          placeholder="哪裡方向錯了、要改成怎麼做…"
          className={cn(fieldClass, 'min-h-32 w-full resize-y text-sm leading-6')}
        />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy} className="rounded-full">取消</Button>
          <Button size="sm" onClick={() => void save()} disabled={busy || !text.trim()} className="rounded-full">
            {busy && <Loader2 className="animate-spin" />}
            排進今晚
          </Button>
        </div>
      </div>
    </DialogShell>
  )
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export function ReportsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open && <ReportsDialogBody key="reports" onClose={onClose} />}
    </AnimatePresence>
  )
}

function ReportsDialogBody({ onClose }: { onClose: () => void }) {
  const [reports, setReports] = useState<ReportEntry[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [markdown, setMarkdown] = useState<string | null>(null)
  useEffect(() => {
    void listReports().then(setReports)
  }, [])
  useEffect(() => {
    if (!openId) return
    setMarkdown(null)
    void readReport(openId).then((r) => setMarkdown(r?.markdown ?? '找不到這份報告。'))
  }, [openId])
  return (
    <DialogShell title="晨報" showHeader onClose={onClose} contentClassName="max-w-[880px]">
      <div className="flex min-h-[320px] gap-4">
        <ul className="w-56 shrink-0 space-y-1" aria-label="報告列表">
          {reports === null && <li className="text-sm text-muted-foreground">讀取中…</li>}
          {reports?.length === 0 && <li className="text-sm text-muted-foreground">還沒有晨報。按「停止派工」結束夜班時會產生一份。</li>}
          {reports?.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setOpenId(r.id)}
                className={cn(
                  'w-full rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors motion-reduce:transition-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  openId === r.id && 'bg-accent'
                )}
              >
                <span className="block truncate">{r.title}</span>
                <span className="block text-xs text-muted-foreground">
                  {new Date(r.createdAt).toLocaleString()}
                  {r.status === 'pending' ? ' · 待補寫' : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="min-w-0 flex-1 overflow-y-auto">
          {openId ? (
            markdown === null ? <p className="text-sm text-muted-foreground">讀取中…</p> : <MarkdownContent source={markdown} />
          ) : (
            <p className="text-sm text-muted-foreground">選一份報告閱讀。</p>
          )}
        </div>
      </div>
    </DialogShell>
  )
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function AutonomousSettingsSection() {
  const [value, setValue] = useState<Partial<AutonomousSettings> | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => {
    void loadState().then((state) => {
      setValue(state?.settings.autonomous ?? {})
    })
  }, [])
  if (!value) return null
  const num = (key: 'concurrency' | 'heartbeatMinutes' | 'reportKeep', fallback: number) => (
    <input
      type="number"
      min={1}
      aria-label={key}
      value={value[key] ?? fallback}
      onChange={(e) => setValue({ ...value, [key]: Number.parseInt(e.target.value, 10) || fallback })}
      className={cn(fieldClass, 'w-24 text-sm')}
    />
  )
  const save = async () => {
    setSaving(true)
    setMessage(null)
    try {
      await setSettings({ autonomous: value })
      setMessage('已儲存')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }
  return (
    <section className="space-y-3" aria-label="下班派工與晨報">
      <h3 className="text-base font-medium">下班派工與晨報</h3>
      <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-sm">
        <label>並行上限</label>
        {num('concurrency', 2)}
        <label>額度探測間隔（分鐘）</label>
        {num('heartbeatMinutes', 5)}
        <label>報告保留份數</label>
        {num('reportKeep', 10)}
        <label>報告 agent</label>
        <select
          aria-label="報告 agent"
          value={value.reportAgent ?? 'claude'}
          onChange={(e) => setValue({ ...value, reportAgent: e.target.value as AutonomousSettings['reportAgent'] })}
          className={cn(fieldClass, 'w-40 text-sm')}
        >
          <option value="claude">Claude</option>
          <option value="codex">Codex</option>
        </select>
        <label>報告 model</label>
        <input
          aria-label="報告 model"
          value={value.reportModel ?? ''}
          placeholder="haiku"
          onChange={(e) => setValue({ ...value, reportModel: e.target.value })}
          className={cn(fieldClass, 'w-40 text-sm')}
        />
        <label>報告 effort</label>
        <select
          aria-label="報告 effort"
          value={value.reportEffort ?? 'low'}
          onChange={(e) => setValue({ ...value, reportEffort: e.target.value as AutonomousSettings['reportEffort'] })}
          className={cn(fieldClass, 'w-40 text-sm')}
        >
          {['low', 'medium', 'high', 'xhigh', 'max'].map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-3">
        <Button size="sm" variant="outline" disabled={saving} onClick={() => void save()}>儲存派工與晨報設定</Button>
        {message && <span className="text-sm text-muted-foreground" role="status">{message}</span>}
      </div>
    </section>
  )
}
