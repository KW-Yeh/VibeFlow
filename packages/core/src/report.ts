import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import type { JsonStore } from './json-store'
import {
  COLUMN_IDS,
  normalizeBoard,
  type BoardState,
  type ColumnId,
  type ReleaseBatch,
  type ReportEntry,
  type StatusEvent,
  type Task,
  type VibeFlowState,
} from './store'
import { taskStatus, type StatusKey } from './status-keys'
import { COLUMN_LABELS } from './column-labels'
import { STATUS_DEFS } from './status-tags'
import { formatTokens, totalTokens, type TokenUsage } from './progress'
import type { HeartbeatClock } from './heartbeat'

/**
 * A closed release batch's report. The table is facts only and is written by
 * the program straight away; an agent then adds the narrative. When the
 * agent cannot (a usage limit, a crash) the report stays `pending` with the
 * table alone and the narrative is tried again later.
 */

export const REPORTS_DIR = 'reports'
const NARRATIVE_HEADING = '## 敘述'
const PENDING_TEXT = '（待補寫：產生報告時 agent 無法完成，額度恢復後會自動補上。）'
const MAX_REPORT_ID = /^[a-z0-9-]{1,40}$/

export function isReportId(value: unknown): value is string {
  return typeof value === 'string' && MAX_REPORT_ID.test(value)
}

export function reportsDir(storeDir: string): string {
  return path.join(storeDir, REPORTS_DIR)
}

export function reportPath(storeDir: string, id: string): string {
  return path.join(reportsDir(storeDir), `${id}.md`)
}

function statusLabel(status: StatusKey | null | undefined): string {
  return status ? STATUS_DEFS[status].name : '—'
}

function time(ms: number | undefined): string {
  return ms === undefined ? '—' : new Date(ms).toISOString().replace('T', ' ').slice(0, 16)
}

export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes} 分`
  const hours = Math.floor(minutes / 60)
  return `${hours} 小時 ${minutes % 60} 分`
}

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim() || '—'

/** One released card as the report sees it. */
export interface ReportRow {
  taskId: string
  title: string
  /** Done, or the column it is still in; absent = no longer on the board. */
  column?: ColumnId
  status: StatusKey | null
  reason?: string
  usage?: TokenUsage
  /** First event to last event, or to the batch's end while it still runs. */
  durationMs?: number
  pr?: string
  /** Not finished when the batch closed. */
  inProgress: boolean
  events: StatusEvent[]
}

function findOnBoard(board: BoardState, id: string): { task: Task; column: ColumnId } | null {
  for (const column of COLUMN_IDS) {
    const task = board[column].find((t) => t.id === id)
    if (task) return { task, column }
  }
  return null
}

const URL_IN = /https?:\/\/\S+/

/**
 * What the report says about each card. Status and reason come from the
 * batch's events: a Done card has lost its tags by now, the history has not.
 */
export function reportRows(batch: ReleaseBatch, board: BoardState, usageOf: (task: Task) => TokenUsage | undefined, now: number): ReportRow[] {
  return batch.taskIds.map((taskId) => {
    const events = batch.events.filter((e) => e.taskId === taskId)
    const last = events.at(-1)
    const found = findOnBoard(board, taskId)
    const task = found?.task
    const status = found && found.column !== 'done' ? taskStatus(found.task) ?? last?.status ?? null : last?.status ?? null
    const reasonEvent = [...events].reverse().find((e) => e.reason)
    const prEvent = [...events].reverse().find((e) => e.status === 'pr_opened' && e.reason && URL_IN.test(e.reason))
    const pr = task?.outcome?.pr?.url ?? prEvent?.reason?.match(URL_IN)?.[0]
    const done = found?.column === 'done'
    const finished = done || (status !== null && ['needs_review', 'stuck', 'pr_opened'].includes(status))
    const start = events[0]?.at
    const end = finished ? last?.at : batch.endedAt ?? now
    return {
      taskId,
      title: task?.title ?? batch.titles?.[taskId] ?? taskId,
      ...(found ? { column: found.column } : {}),
      status,
      ...(reasonEvent?.reason ? { reason: reasonEvent.reason } : task?.statusNote?.reason ? { reason: task.statusNote.reason } : {}),
      ...(task ? { usage: usageOf(task) } : {}),
      ...(start !== undefined && end !== undefined ? { durationMs: end - start } : {}),
      ...(pr ? { pr } : {}),
      inProgress: Boolean(found) && !finished,
      events,
    }
  })
}

const COLUMN_LABEL = COLUMN_LABELS

/** The facts-only part of a report, in markdown. */
export function reportTable(batch: ReleaseBatch, rows: ReportRow[]): string {
  const lines = [
    `# 放行批次報告 ${batch.id}`,
    '',
    `- 開始：${time(batch.startedAt)}（UTC）`,
    `- 結束：${time(batch.endedAt)}（UTC）`,
    `- 放行卡片：${rows.length} 張；進行中 ${rows.filter((r) => r.inProgress).length} 張`,
    '',
    '## 卡片',
    '',
    '| 卡片 | 欄位 | 最後狀態 | 原因 | Token | 耗時 | PR |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ]
  for (const r of rows) {
    const state = r.column === 'done' ? `已完成（${statusLabel(r.status)}）` : r.inProgress ? `進行中（${statusLabel(r.status)}）` : statusLabel(r.status)
    lines.push(`| ${cell(`${r.taskId} ${r.title}`)} | ${r.column ? COLUMN_LABEL[r.column] : '已刪除'} | ${cell(state)} | ${cell(r.reason ?? '')} | ${r.usage ? formatTokens(totalTokens(r.usage)) : '—'} | ${r.durationMs !== undefined ? formatDuration(r.durationMs) : '—'} | ${cell(r.pr ?? '')} |`)
  }
  lines.push('', '## 狀態時間軸', '')
  for (const r of rows) {
    lines.push(`### ${r.taskId} ${r.title}`, '')
    if (!r.events.length) lines.push('- （沒有狀態事件）')
    for (const e of r.events) {
      const who = e.source === 'user' ? '使用者' : e.source === 'cli' ? 'agent/CLI' : 'VibeFlow'
      lines.push(`- ${time(e.at)} ${statusLabel(e.status)}（${who}）${e.reason ? `：${e.reason.replace(/\r?\n/g, ' ')}` : ''}`)
    }
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}

/** What the narrative agent is asked. It reads the table only; it runs no tools. */
export function narrativePrompt(table: string): string {
  return [
    '以下是 VibeFlow 一個放行批次的事實表格。請用繁體中文寫一段給人看的敘述，三到八個短段落或條列：',
    '- 完成了什麼（哪些卡開了 PR、進了已完成）',
    '- 卡在哪個環節（待你確認、卡住、等待額度，以及原因）',
    '- 哪些卡片比其他卡片花更多時間或 token',
    '只根據表格內容，不要編造表格沒有的事實。不要重複整張表格。直接輸出敘述本身，不要加標題。',
    '',
    table,
  ].join('\n')
}

export function composeReport(table: string, narrative: string | null): string {
  return `${table}\n\n${NARRATIVE_HEADING}\n\n${narrative?.trim() || PENDING_TEXT}\n`
}

/** Delete the oldest reports past the keep limit; the index is newest first. */
export function pruneReports(entries: ReportEntry[], keep: number, storeDir: string): ReportEntry[] {
  const kept = entries.slice(0, keep)
  for (const old of entries.slice(keep)) {
    fs.rmSync(reportPath(storeDir, old.id), { force: true })
  }
  return kept
}

export interface ReporterOptions {
  store: () => JsonStore<VibeFlowState>
  storeDir: () => string
  /** Writes the narrative; rejects when it cannot (a usage limit included). */
  narrate: (prompt: string) => Promise<string>
  usageOf: (task: Task) => TokenUsage | undefined
  keep: () => number
  retryMs: () => number
  clock?: HeartbeatClock
  onChange?: () => void
}

export interface Reporter {
  /** Write a closed batch's report: the table now, the narrative when the agent manages. */
  create(batchId: string): Promise<ReportEntry | null>
  /** Schedule the narrative of every pending report again (host start). */
  resumePending(): void
  stop(): void
}

export function createReporter(options: ReporterOptions): Reporter {
  const clock = options.clock ?? {
    now: () => Date.now(),
    setTimer: (fn: () => void, ms: number) => {
      const t = setTimeout(fn, ms)
      t.unref?.()
      return t
    },
    clearTimer: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
  }
  const timers = new Map<string, unknown>()
  let stopped = false

  function entries(): ReportEntry[] {
    return options.store().get('reports') ?? []
  }

  function saveEntry(entry: ReportEntry): void {
    options.store().set('reports', entries().map((e) => (e.id === entry.id ? entry : e)))
    options.onChange?.()
  }

  function schedule(entry: ReportEntry): void {
    if (stopped || timers.has(entry.id)) return
    const at = entry.retryAt ?? clock.now()
    timers.set(entry.id, clock.setTimer(() => {
      timers.delete(entry.id)
      void narrate(entry.id)
    }, Math.max(0, at - clock.now())))
  }

  /** Add the narrative to a pending report, or schedule another try. */
  async function narrate(id: string): Promise<void> {
    const entry = entries().find((e) => e.id === id)
    if (!entry || entry.status !== 'pending') return
    const file = reportPath(options.storeDir(), id)
    let text: string
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch {
      return
    }
    const table = text.split(`\n\n${NARRATIVE_HEADING}\n`)[0]
    try {
      const narrative = (await options.narrate(narrativePrompt(table))).trim()
      if (!narrative) throw new Error('empty narrative')
      fs.writeFileSync(file, composeReport(table, narrative))
      const { retryAt: _done, ...rest } = entry
      saveEntry({ ...rest, status: 'complete' })
    } catch {
      const next = { ...entry, retryAt: clock.now() + options.retryMs() }
      saveEntry(next)
      schedule(next)
    }
  }

  return {
    async create(batchId) {
      const store = options.store()
      const batch = (store.get('batches') ?? []).find((b) => b.id === batchId)
      if (!batch) return null
      const now = clock.now()
      const rows = reportRows(batch, normalizeBoard(store.get('board')), options.usageOf, now)
      const table = reportTable(batch, rows)
      const id = `${new Date(now).toISOString().slice(0, 10)}-${randomUUID().slice(0, 6)}`
      fs.mkdirSync(reportsDir(options.storeDir()), { recursive: true })
      fs.writeFileSync(reportPath(options.storeDir(), id), composeReport(table, null))
      const entry: ReportEntry = {
        id,
        batchId,
        createdAt: now,
        status: 'pending',
        title: `放行批次 ${batch.id}（${rows.length} 張卡）`,
      }
      const kept = pruneReports([entry, ...entries()], options.keep(), options.storeDir())
      store.set('reports', kept)
      // A batch is kept while it is open or its report is.
      const reported = new Set(kept.map((e) => e.batchId))
      const openId = store.get('release')?.batchId
      store.set('batches', (store.get('batches') ?? []).filter((b) => b.id === openId || !b.endedAt || reported.has(b.id)))
      options.onChange?.()
      await narrate(id)
      return entries().find((e) => e.id === id) ?? entry
    },
    resumePending() {
      for (const entry of entries()) if (entry.status === 'pending') schedule(entry)
    },
    stop() {
      stopped = true
      for (const t of timers.values()) clock.clearTimer(t)
      timers.clear()
    },
  }
}

/** A report's index entry and text. */
export function readReport(storeDir: string, entries: ReportEntry[], id: string): { entry: ReportEntry; markdown: string } | null {
  const entry = entries.find((e) => e.id === id)
  if (!entry) return null
  try {
    return { entry, markdown: fs.readFileSync(reportPath(storeDir, id), 'utf8') }
  } catch {
    return null
  }
}
