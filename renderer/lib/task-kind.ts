import type { Task, TaskKind } from '@/lib/types'

export const TASK_KIND_LABELS: Record<TaskKind, string> = {
  feature: 'Feature',
  ebug: 'eBug',
}

export const TASK_KIND_OPTIONS: { value: TaskKind; label: string }[] = [
  { value: 'feature', label: TASK_KIND_LABELS.feature },
  { value: 'ebug', label: TASK_KIND_LABELS.ebug },
]

export function taskKind(task: Pick<Task, 'kind'>): TaskKind {
  return task.kind === 'ebug' ? 'ebug' : 'feature'
}
