import { useEffect, useRef, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { FileText, GitBranch, Layers, Loader2, Paperclip, Play, RotateCcw } from 'lucide-react'

import { MarkdownContent } from '@/components/markdown-content'
import { PropertyGroup, PropertyNote, TaskFormDialog } from '@/components/task-form-layout'
import { useTags } from '@/components/task-tags'
import { Button } from '@/components/ui/button'
import { DialogShell } from '@/components/ui/dialog-shell'
import { fieldClass } from '@/components/ui/field'
import { SECTION_LABEL } from '@/components/ui/section-label'
import {
  loadState,
  listReports,
  readInventoryDocs,
  readReport,
  rerunInventory,
  setInventoryContext,
  setRelease,
  setSettings,
} from '@/lib/api'
import { filesToAttachmentInputs } from '@/lib/file-attachments'
import { cn } from '@/lib/utils'
import { taskStatus } from '@/lib/status'
import type { AutonomousSettings, BoardState, ReleaseState, ReportEntry, Task } from '@/lib/types'

/*
 * The autonomous run's minimal UI: the inventory panel, the release switch,
 * the reports list and its settings. Visual design is still to come (spec:
 * docs/features/autonomous-run/), so these only carry the elements and the
 * behaviour the spec asks for.
 */

const SLOT_FREEING = ['needs_review', 'stuck', 'pr_opened']

function occupied(board: BoardState): number {
  return board.in_progress.filter((t) => {
    if (t.role === 'master') return false
    const status = taskStatus(t)
    return !status || !SLOT_FREEING.includes(status)
  }).length
}

function useStatusName() {
  const { tags } = useTags()
  return (task: Task) => {
    const key = taskStatus(task)
    return key ? tags.find((t) => t.id === `status:${key}`)?.name ?? key : null
  }
}

// ---------------------------------------------------------------------------
// Release switch
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
  const enabled = release?.enabled === true
  const ready = board.inventory.filter((t) => taskStatus(t) === 'ready').length
  const toggle = async () => {
    setBusy(true)
    setError(null)
    try {
      await setRelease(!enabled)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex items-center gap-2 text-sm">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="放行"
        disabled={busy}
        onClick={() => void toggle()}
        title={enabled ? '關閉放行：不再放行新卡片，執行中的卡片繼續跑完，並產生這一批的報告' : '打開放行：依盤點欄順序放行準備開工的卡片'}
        className={cn(
          'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs outline-none transition-colors motion-reduce:transition-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50',
          enabled ? 'border-success/50 bg-success/15 text-success' : 'border-border text-muted-foreground hover:bg-accent'
        )}
      >
        {busy ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
        放行 {enabled ? '開' : '關'}
      </button>
      <span className="text-xs tabular-nums text-muted-foreground" title="執行中名額 / 並行上限 · 準備開工">
        {occupied(board)}/{concurrency} · 準備 {ready}
      </span>
      <button
        type="button"
        onClick={onOpenReports}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground outline-none transition-colors motion-reduce:transition-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <FileText className="size-3" />
        報告
      </button>
      {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
    </div>
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
    <DialogShell title="放行報告" showHeader onClose={onClose} contentClassName="max-w-[880px]">
      <div className="flex min-h-[320px] gap-4">
        <ul className="w-56 shrink-0 space-y-1" aria-label="報告列表">
          {reports === null && <li className="text-sm text-muted-foreground">讀取中…</li>}
          {reports?.length === 0 && <li className="text-sm text-muted-foreground">還沒有報告。關閉放行開關時會產生一份。</li>}
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
// Inventory panel
// ---------------------------------------------------------------------------

export function InventorySheet({
  task,
  onStart,
  onClose,
}: {
  task: Task | null
  onStart: (task: Task) => void
  onClose: () => void
}) {
  return (
    <AnimatePresence>
      {task && <InventorySheetBody key={task.id} task={task} onStart={onStart} onClose={onClose} />}
    </AnimatePresence>
  )
}

function InventorySheetBody({ task, onStart, onClose }: { task: Task; onStart: (task: Task) => void; onClose: () => void }) {
  const view = useInventoryView(task, onStart)
  return (
    <TaskFormDialog
      title="盤點"
      header={<span className="text-sm text-muted-foreground">任務詳情 · 盤點{view.statusLabel ? ` · ${view.statusLabel}` : ''}</span>}
      saving={false}
      onClose={onClose}
      content={view.content}
      sidebar={view.sidebar}
      actions={view.actions}
    />
  )
}

/** An inventory card on the 任務詳情 page: the sheet's content, with room to read the plan. */
export function InventoryWorkspacePanel({ task, onStart }: { task: Task; onStart: (task: Task) => void }) {
  const view = useInventoryView(task, onStart)
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col md:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">盤點{view.statusLabel ? ` · ${view.statusLabel}` : ''}</span>
          <span className="flex-1" />
          <div className="flex flex-wrap gap-2">{view.actions}</div>
        </div>
        {view.content}
      </div>
      <aside className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto border-t border-border/70 bg-muted/20 px-3 py-4 md:w-[300px] md:border-l md:border-t-0">
        {view.sidebar}
      </aside>
    </div>
  )
}

function useInventoryView(task: Task, onStart: (task: Task) => void) {
  const statusName = useStatusName()
  const status = taskStatus(task)
  const running = Boolean(task.inventory?.runningSince)
  const [docs, setDocs] = useState<{ path: string; content: string }[]>([])
  const [context, setContext] = useState(task.inventory?.context ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const finishedAt = task.inventory?.finishedAt

  useEffect(() => {
    void readInventoryDocs(task.id).then(setDocs)
  }, [task.id, finishedAt])

  const act = async (fn: () => Promise<unknown>) => {
    setSaving(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const saveAndRerun = () => act(async () => {
    await setInventoryContext({ taskId: task.id, context })
    await rerunInventory(task.id)
  })

  const attach = (files: FileList | null) => {
    if (!files?.length) return
    void act(async () => {
      await setInventoryContext({ taskId: task.id, attachments: await filesToAttachmentInputs(files) })
    })
  }

  const plan = docs.find((d) => d.path.endsWith('plan.md'))
  const spec = docs.find((d) => d.path.endsWith('spec.md'))

  const content = (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <h2 className="break-words text-2xl font-semibold tracking-tight">{task.title}</h2>
      <section aria-label="盤點結果" className="space-y-2">
        <h3 className={SECTION_LABEL}>盤點結果</h3>
        {running && (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-3.5 animate-spin" />
            盤點中（headless，沒有終端機）
          </p>
        )}
        {task.inventory?.error && <PropertyNote tone="danger">{task.inventory.error}</PropertyNote>}
        {task.inventory?.lastSummary ? (
          <MarkdownContent source={task.inventory.lastSummary} />
        ) : (
          !running && <p className="text-sm text-muted-foreground">還沒有盤點摘要。</p>
        )}
      </section>
      {plan && (
        <section aria-label="plan.md" className="space-y-2">
          <h3 className={SECTION_LABEL}>{plan.path}</h3>
          <MarkdownContent source={plan.content} />
        </section>
      )}
      {spec && (
        <details className="space-y-2">
          <summary className={cn(SECTION_LABEL, 'cursor-pointer')}>{spec.path}</summary>
          <MarkdownContent source={spec.content} />
        </details>
      )}
      <section aria-label="額外 context" className="space-y-2">
        <h3 className={SECTION_LABEL}>補充 context</h3>
        <p className="text-sm text-muted-foreground">回答待回答的問題、補上缺少的資訊。存成這張卡的額外 context，不會改動原本的描述；重新盤點時會一起交給 agent。</p>
        <textarea
          aria-label="額外 context"
          value={context}
          onChange={(e) => setContext(e.target.value)}
          rows={5}
          className={cn(fieldClass, 'text-sm')}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" disabled={saving} onClick={() => fileInput.current?.click()}>
            <Paperclip className="size-3.5" />
            附加檔案
          </Button>
        </div>
        {task.inventory?.attachments?.length ? (
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {task.inventory.attachments.map((a) => (
              <li key={a} className="truncate font-mono">{a}</li>
            ))}
          </ul>
        ) : null}
        <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => attach(e.target.files)} />
      </section>
      {error && <PropertyNote tone="danger">{error}</PropertyNote>}
    </div>
  )

  const sidebar = (
    <>
      <PropertyGroup label="狀態">
        <p className="px-1 text-sm">{statusName(task) ?? '—'}</p>
        {task.statusNote?.reason && <p className="px-1 text-xs text-muted-foreground">{task.statusNote.reason}</p>}
        {task.quotaWait && (
          <p className="px-1 text-xs text-muted-foreground">
            {task.quotaWait.resetsAt ? `額度重置：${new Date(task.quotaWait.resetsAt).toLocaleString()}` : '額度重置時間未知'}
          </p>
        )}
      </PropertyGroup>
      <PropertyGroup label="位置">
        <div className="space-y-1.5 px-1 text-sm text-muted-foreground">
          {task.projectName && (
            <div className="flex items-center gap-2">
              <Layers className="size-3.5 shrink-0" />
              <span className="min-w-0 truncate">{task.projectName}</span>
            </div>
          )}
          <div className="flex items-start gap-2">
            <GitBranch className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0 break-all">{task.branch || '（無分支）'}</span>
          </div>
        </div>
      </PropertyGroup>
      <PropertyNote>盤點欄的卡片不能直接編輯描述；補充內容請寫在「補充 context」。已盤點 {task.inventory?.passes ?? 0} 次。</PropertyNote>
    </>
  )

  const actions = (
    <>
      <Button variant="outline" size="sm" disabled={saving || running} onClick={() => void saveAndRerun()}>
        <RotateCcw className="size-3.5" />
        儲存並重新盤點
      </Button>
      <Button size="sm" disabled={saving || running} onClick={() => onStart(task)} title="移到進行中，用新的 session 依 spec 與 plan 執行">
        <Play className="size-3.5" />
        開始執行
      </Button>
    </>
  )

  return { content, sidebar, actions, statusLabel: status ? statusName(task) : null }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function AutonomousSettingsSection() {
  const [value, setValue] = useState<Partial<AutonomousSettings> | null>(null)
  const [commands, setCommands] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => {
    void loadState().then((state) => {
      const a = state?.settings.autonomous ?? {}
      setValue(a)
      setCommands((a.inventoryCommands ?? []).join('\n'))
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
      await setSettings({
        autonomous: {
          ...value,
          inventoryCommands: commands.split('\n').map((c) => c.trim()).filter(Boolean),
        },
      })
      setMessage('已儲存')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }
  return (
    <section className="space-y-3" aria-label="盤點與放行">
      <h3 className="text-base font-medium">盤點與放行</h3>
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
      <div className="space-y-1">
        <label className="text-sm" htmlFor="inventory-commands">盤點可執行的額外指令（每行一個指令開頭，只對 Claude 生效）</label>
        <textarea
          id="inventory-commands"
          value={commands}
          rows={3}
          placeholder="jf rt ping"
          onChange={(e) => setCommands(e.target.value)}
          className={cn(fieldClass, 'font-mono text-sm')}
        />
      </div>
      <div className="flex items-center gap-3">
        <Button size="sm" variant="outline" disabled={saving} onClick={() => void save()}>儲存盤點與放行設定</Button>
        {message && <span className="text-sm text-muted-foreground" role="status">{message}</span>}
      </div>
    </section>
  )
}
