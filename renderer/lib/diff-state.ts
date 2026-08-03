import type { DiffEntry, DiffFile } from './types'

/** Whether two metadata snapshots describe the same visible file revision. */
export function sameDiffEntry(a: DiffEntry, b: DiffEntry): boolean {
  return (
    a.path === b.path &&
    a.status === b.status &&
    a.additions === b.additions &&
    a.deletions === b.deletions &&
    a.revision === b.revision
  )
}

/**
 * Keep both the array and entry object identities stable when a poll reports no
 * change. This prevents a metadata-only refresh from repainting an open diff.
 */
export function stabilizeDiffEntries(
  current: DiffEntry[],
  next: DiffEntry[]
): DiffEntry[] {
  if (current.length !== next.length) return next

  let changed = false
  const stable = next.map((entry, index) => {
    const previous = current[index]
    if (sameDiffEntry(previous, entry)) return previous
    changed = true
    return entry
  })
  return changed ? stable : current
}

/** Drop bodies only when their files leave the diff, not while they refresh. */
export function retainExistingDiffContents(
  current: Record<string, DiffFile | null>,
  entries: DiffEntry[]
): Record<string, DiffFile | null> {
  const paths = new Set(entries.map((entry) => entry.path))
  const currentPaths = Object.keys(current)
  if (currentPaths.every((filePath) => paths.has(filePath))) return current

  return Object.fromEntries(
    Object.entries(current).filter(([filePath]) => paths.has(filePath))
  )
}

/** Avoid replacing a cached body when only its filesystem timestamp changed. */
export function sameDiffFile(
  current: DiffFile | null | undefined,
  next: DiffFile | null
): boolean {
  if (current === next) return true
  if (!current || !next) return false
  return (
    current.path === next.path &&
    current.status === next.status &&
    current.additions === next.additions &&
    current.deletions === next.deletions &&
    current.oldValue === next.oldValue &&
    current.newValue === next.newValue &&
    current.truncated === next.truncated
  )
}
