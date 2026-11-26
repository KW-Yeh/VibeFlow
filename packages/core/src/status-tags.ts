import type { JsonStore } from './json-store'
import { normalizeBoard, writeBoard, type ColumnId, type StatusEvent, type TagDef, type Task, type VibeFlowState } from './store'
import { findTag, setTaskTags, type SetTaskTagsInput } from './tags'
import type { TagColor } from './tag-colors'
import { STATUS_KEYS, isStatusKey, statusKeyOfTag, statusTagId, taskStatus, type StatusKey } from './status-keys'

export { STATUS_KEYS, statusTagId, statusKeyOfTag, taskStatus, isStatusKey, type StatusKey }

export const STATUS_DEFS: Record<StatusKey, { name: string; color: TagColor }> = {
  ready: { name: '準備開工', color: 'green' },
  running: { name: '執行中', color: 'teal' },
  quota_wait: { name: '等待額度', color: 'orange' },
  needs_review: { name: '待你確認', color: 'purple' },
  stuck: { name: '卡住', color: 'red' },
  pr_opened: { name: '已開 PR', color: 'gray' },
}

function statusError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code })
}

export function isStatusTagId(tagId: string): boolean {
  return statusKeyOfTag(tagId) !== null
}

/**
 * Put back any reserved status tag that is missing. A tag the user renamed or
 * recoloured is left as it is: the program reads the id, not the name. A
 * user tag that already took the default name pushes the status tag to a
 * suffixed one, so names stay unique.
 */
export function ensureStatusTags(store: JsonStore<VibeFlowState>): TagDef[] {
  const tags = store.get('tags') ?? []
  const missing = STATUS_KEYS.filter((key) => !tags.some((t) => t.id === statusTagId(key)))
  if (!missing.length) return tags
  const next = [...tags]
  for (const key of missing) {
    const def = STATUS_DEFS[key]
    const taken = next.some((t) => t.name.toLowerCase() === def.name.toLowerCase())
    next.push({ id: statusTagId(key), name: taken ? `${def.name}（狀態）` : def.name, color: def.color })
  }
  store.set('tags', next)
  return next
}

/** A status named by its key (`ready`), its tag id (`status:ready`) or its tag's current name (`準備開工`). */
export function resolveStatus(tags: TagDef[], ref: string): StatusKey | null {
  const value = ref.trim()
  if (isStatusKey(value)) return value
  const tag = findTag(tags.filter((t) => isStatusTagId(t.id)), value)
  return tag ? statusKeyOfTag(tag.id) : null
}

/** `key（名稱）` for every status, for an error that lists what is allowed. */
export function statusChoices(tags: TagDef[]): string {
  return STATUS_KEYS.map((key) => `${key}（${tags.find((t) => t.id === statusTagId(key))?.name ?? STATUS_DEFS[key].name}）`).join(', ')
}

function columnOf(board: Record<ColumnId, Task[]>, taskId: string): ColumnId | undefined {
  return (Object.keys(board) as ColumnId[]).find((c) => board[c].some((t) => t.id === taskId))
}

/**
 * Append one status event to the open release batch, when the card is in it.
 * Events are what a report is built from: tags are cleared on Done, the
 * history is not.
 */
export function recordStatusEvent(store: JsonStore<VibeFlowState>, event: StatusEvent): void {
  const release = store.get('release')
  if (!release?.enabled || !release.batchId) return
  const batches = store.get('batches') ?? []
  const batch = batches.find((b) => b.id === release.batchId)
  if (!batch || !batch.taskIds.includes(event.taskId)) return
  store.set('batches', batches.map((b) => (b.id === batch.id ? { ...b, events: [...b.events, event] } : b)))
}

export interface SetTaskStatusInput {
  taskId: string
  /** Key, tag id or tag name; null clears the status. */
  status: string | null
  reason?: string
  source: StatusEvent['source']
  now?: number
}

/**
 * The one way a status is written: it replaces whatever status tag the card
 * had, keeps the reason on the card, and logs an event in the open batch.
 * An unknown status fails and never creates a tag.
 */
export function setTaskStatus(store: JsonStore<VibeFlowState>, input: SetTaskStatusInput): { task: Task; status: StatusKey | null } {
  const tags = ensureStatusTags(store)
  const key = input.status === null ? null : resolveStatus(tags, input.status)
  if (input.status !== null && !key) {
    throw statusError(`未知的狀態：${input.status}。可用的狀態：${statusChoices(tags)}`, 'UNKNOWN_STATUS')
  }
  const board = normalizeBoard(store.get('board'))
  const col = columnOf(board, input.taskId)
  if (!col) throw statusError(`找不到卡片：${input.taskId}`, 'TASK_NOT_FOUND')
  if (col === 'done' && key) throw statusError('已完成的卡片沒有狀態標籤', 'TASK_DONE')
  const now = input.now ?? Date.now()
  const reason = input.reason?.trim() || undefined
  const current = board[col].find((t) => t.id === input.taskId)!
  const kept = (current.tags ?? []).filter((id) => !isStatusTagId(id))
  const ids = key ? [...kept, statusTagId(key)] : kept
  const next: Task = { ...current }
  if (ids.length) next.tags = ids
  else delete next.tags
  if (key) next.statusNote = { status: key, ...(reason ? { reason } : {}), at: now }
  else delete next.statusNote
  writeBoard(store, { ...board, [col]: board[col].map((t) => (t.id === current.id ? next : t)) })
  recordStatusEvent(store, { at: now, taskId: current.id, status: key, ...(reason ? { reason } : {}), source: input.source })
  return { task: next, status: key }
}

/**
 * A tag edit from the UI or `task tag`. Status tags in it stay one per card:
 * adding one replaces the other, and a change of status is logged as the
 * user overriding it.
 */
export function setTaskTagsWithStatus(
  store: JsonStore<VibeFlowState>,
  input: SetTaskTagsInput,
  source: StatusEvent['source'] = 'user',
  now = Date.now()
): ReturnType<typeof setTaskTags> {
  const tags = store.get('tags') ?? []
  const before = normalizeBoard(store.get('board'))
  const col = columnOf(before, input.taskId)
  const prior = col ? taskStatus(before[col].find((t) => t.id === input.taskId)!) : null
  const addedStatus = [...(input.add ?? [])].reverse()
    .map((ref) => findTag(tags, ref))
    .find((t) => t && isStatusTagId(t.id))
  const remove = [...(input.remove ?? [])]
  if (addedStatus) {
    for (const key of STATUS_KEYS) {
      const id = statusTagId(key)
      if (id !== addedStatus.id) remove.push(id)
    }
  }
  const add = (input.add ?? []).filter((ref) => {
    const tag = findTag(tags, ref)
    return !tag || !isStatusTagId(tag.id) || tag.id === addedStatus?.id
  })
  const present = new Set(col ? before[col].find((t) => t.id === input.taskId)?.tags ?? [] : [])
  const result = setTaskTags(store, { ...input, add, remove: remove.filter((ref) => {
    const tag = findTag(tags, ref)
    return !tag || present.has(tag.id) || !isStatusTagId(tag.id)
  }) })
  const after = taskStatus(result.task)
  if (after !== prior) {
    const board = normalizeBoard(store.get('board'))
    const column = columnOf(board, input.taskId)!
    writeBoard(store, {
      ...board,
      [column]: board[column].map((t) => {
        if (t.id !== input.taskId) return t
        const next = { ...t }
        if (after) next.statusNote = { status: after, at: now }
        else delete next.statusNote
        return next
      }),
    })
    recordStatusEvent(store, { at: now, taskId: input.taskId, status: after, source })
    result.task = normalizeBoard(store.get('board'))[column].find((t) => t.id === input.taskId)!
  }
  return result
}
