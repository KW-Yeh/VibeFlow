import { randomUUID } from 'crypto'
import type { JsonStore } from './json-store'
import { writeBoard, type BoardState, type ColumnId, type TagDef, type Task, type VibeFlowState } from './store'
import { TAG_COLORS, isTagColor, type TagColor } from './tag-colors'
import { STATUS_TAG_PREFIX } from './status-keys'

function tagError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code })
}

export function listTags(store: JsonStore<VibeFlowState>): TagDef[] {
  return store.get('tags') ?? []
}

/** A tag is named by its id or, ignoring case, by its name. */
export function findTag(tags: TagDef[], ref: string): TagDef | undefined {
  const key = ref.trim().toLowerCase()
  return tags.find((t) => t.id === ref) ?? tags.find((t) => t.name.toLowerCase() === key)
}

function requireTag(tags: TagDef[], ref: string): TagDef {
  const tag = findTag(tags, ref)
  if (!tag) throw tagError(`找不到標籤：${ref}`, 'UNKNOWN_TAG')
  return tag
}

function tagName(name: unknown): string {
  const value = typeof name === 'string' ? name.trim() : ''
  if (!value) throw tagError('標籤名稱不可空白', 'INVALID_TAG_NAME')
  return value
}

function tagColor(color: unknown): TagColor {
  if (!isTagColor(color)) throw tagError(`標籤顏色必須是 ${TAG_COLORS.join(' | ')}`, 'INVALID_TAG_COLOR')
  return color
}

function assertNameFree(tags: TagDef[], name: string, exceptId?: string): void {
  const taken = tags.find((t) => t.id !== exceptId && t.name.toLowerCase() === name.toLowerCase())
  if (taken) throw tagError(`標籤「${taken.name}」已存在`, 'TAG_EXISTS')
}

/** The palette colour fewest tags use, so new tags stay apart without the user picking. */
function nextColor(tags: TagDef[]): TagColor {
  const uses = (c: TagColor) => tags.filter((t) => t.color === c).length
  return TAG_COLORS.reduce((best, c) => (uses(c) < uses(best) ? c : best), TAG_COLORS[0])
}

function newTag(tags: TagDef[], name: string, color?: unknown): TagDef {
  assertNameFree(tags, name)
  return {
    id: `tag_${randomUUID().slice(0, 8)}`,
    name,
    color: color === undefined ? nextColor(tags) : tagColor(color),
  }
}

export function createTag(store: JsonStore<VibeFlowState>, input: { name: unknown; color?: unknown }): TagDef {
  const tags = listTags(store)
  const tag = newTag(tags, tagName(input.name), input.color)
  store.set('tags', [...tags, tag])
  return tag
}

export function updateTag(
  store: JsonStore<VibeFlowState>,
  ref: string,
  patch: { name?: unknown; color?: unknown }
): TagDef {
  const tags = listTags(store)
  const current = requireTag(tags, ref)
  const next: TagDef = { ...current }
  if (patch.name !== undefined) {
    next.name = tagName(patch.name)
    assertNameFree(tags, next.name, current.id)
  }
  if (patch.color !== undefined) next.color = tagColor(patch.color)
  store.set('tags', tags.map((t) => (t.id === current.id ? next : t)))
  return next
}

function mapTasks(board: BoardState, fn: (task: Task) => Task): BoardState {
  const next = { ...board }
  for (const col of Object.keys(board) as ColumnId[]) next[col] = board[col].map(fn)
  return next
}

function withTags(task: Task, ids: string[]): Task {
  if (ids.length) return { ...task, tags: ids }
  const { tags: _removed, ...rest } = task
  return rest
}

/** Removes the tag from the board and from every card that carries it. */
export function deleteTag(store: JsonStore<VibeFlowState>, ref: string): TagDef {
  const tags = listTags(store)
  const tag = requireTag(tags, ref)
  if (tag.id.startsWith(STATUS_TAG_PREFIX)) throw tagError(`「${tag.name}」是保留的狀態標籤，不能刪除`, 'RESERVED_TAG')
  writeBoard(store, mapTasks(store.get('board'), (t) =>
    t.tags?.includes(tag.id) ? withTags(t, t.tags.filter((id) => id !== tag.id)) : t))
  store.set('tags', tags.filter((t) => t.id !== tag.id))
  return tag
}

export interface SetTaskTagsInput {
  taskId: string
  /** Tag ids or names; a name no tag has yet becomes a new tag. */
  add?: string[]
  remove?: string[]
  /** Colour for tags `add` creates. */
  color?: unknown
}

/** Add and remove tags on one card. Done cards carry no tags, so they are refused. */
export function setTaskTags(store: JsonStore<VibeFlowState>, input: SetTaskTagsInput): { task: Task; tags: TagDef[] } {
  const board = store.get('board')
  const col = (Object.keys(board) as ColumnId[]).find((c) => board[c].some((t) => t.id === input.taskId))
  if (!col) throw tagError(`找不到卡片：${input.taskId}`, 'TASK_NOT_FOUND')
  if (col === 'done' && input.add?.length) throw tagError('已完成的卡片不能加標籤', 'TASK_DONE')
  if (input.color !== undefined) tagColor(input.color)

  let tags = listTags(store)
  const removing = new Set((input.remove ?? []).map((ref) => requireTag(tags, ref).id))
  const adding: string[] = []
  for (const ref of input.add ?? []) {
    let tag = findTag(tags, ref)
    if (!tag) {
      tag = newTag(tags, tagName(ref), input.color)
      tags = [...tags, tag]
    }
    adding.push(tag.id)
  }

  const task = board[col].find((t) => t.id === input.taskId)!
  const ids = [...(task.tags ?? []), ...adding]
    .filter((id, i, all) => all.indexOf(id) === i)
    .filter((id) => !removing.has(id))
  const next = withTags(task, ids)
  store.set('tags', tags)
  writeBoard(store, { ...board, [col]: board[col].map((t) => (t.id === task.id ? next : t)) })
  return { task: next, tags }
}
