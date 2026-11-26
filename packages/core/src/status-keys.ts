/**
 * The reserved status a card can be in during an autonomous run. Each has a
 * fixed tag id `status:<key>`, so a user renaming or recolouring the tag does
 * not change what the program reads. No imports: the renderer may use it.
 */
export const STATUS_KEYS = [
  'ready',
  'running',
  'quota_wait',
  'needs_review',
  'stuck',
  'pr_opened',
] as const

export type StatusKey = (typeof STATUS_KEYS)[number]

export const STATUS_TAG_PREFIX = 'status:'

export function statusTagId(key: StatusKey): string {
  return `${STATUS_TAG_PREFIX}${key}`
}

export function statusKeyOfTag(tagId: string): StatusKey | null {
  if (!tagId.startsWith(STATUS_TAG_PREFIX)) return null
  const key = tagId.slice(STATUS_TAG_PREFIX.length)
  return (STATUS_KEYS as readonly string[]).includes(key) ? (key as StatusKey) : null
}

export function isStatusKey(value: unknown): value is StatusKey {
  return typeof value === 'string' && (STATUS_KEYS as readonly string[]).includes(value)
}

/** The card's status tag, if it has one. */
export function taskStatus(task: { tags?: string[] }): StatusKey | null {
  for (const id of task.tags ?? []) {
    const key = statusKeyOfTag(id)
    if (key) return key
  }
  return null
}
