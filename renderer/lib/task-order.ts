import type { Task } from '@/lib/types'

export function compareTasksByNewestFirst(
  a: Pick<Task, 'createdAt'>,
  b: Pick<Task, 'createdAt'>
): number {
  if (a.createdAt === b.createdAt) return 0
  if (a.createdAt === undefined) return 1
  if (b.createdAt === undefined) return -1
  return b.createdAt - a.createdAt
}
