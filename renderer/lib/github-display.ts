import type { GithubItem, GithubPrState, GithubRef, Task } from '@/lib/types'

/** Text colour per state: open reads as live, draft as quiet, merged as done, closed as stopped. */
export const GITHUB_STATE_CLASS: Record<GithubPrState, string> = {
  open: 'text-success',
  draft: 'text-muted-foreground',
  merged: 'text-primary',
  closed: 'text-destructive',
}

export const GITHUB_STATE_LABEL: Record<GithubPrState, string> = {
  open: 'Open',
  draft: 'Draft',
  merged: 'Merged',
  closed: 'Closed',
}

export const REVIEW_LABEL: Record<string, string> = {
  APPROVED: '已核准',
  CHANGES_REQUESTED: '要求修改',
  REVIEW_REQUIRED: '待 review',
}

export function githubItemKey(item: { repo: string; number: number }): string {
  return `${item.repo}#${item.number}`
}

/** Cards already converted from an Issue/PR, by `repo#number`. */
export function boardGithubCards(tasks: Task[]): Map<string, string> {
  const byKey = new Map<string, string>()
  for (const task of tasks) if (task.github) byKey.set(githubItemKey(task.github), task.id)
  return byKey
}

export function githubRefOf(item: GithubItem): GithubRef {
  return { kind: item.kind, repo: item.repo, number: item.number, url: item.url }
}

export function relativeTime(iso: string, now = Date.now()): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const minutes = Math.max(0, Math.floor((now - then) / 60_000))
  if (minutes < 1) return '剛剛'
  if (minutes < 60) return `${minutes} 分鐘前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小時前`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} 天前`
  if (days < 30) return `${Math.floor(days / 7)} 週前`
  if (days < 365) return `${Math.floor(days / 30)} 個月前`
  return `${Math.floor(days / 365)} 年前`
}

export function absoluteTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function initials(login: string): string {
  return login.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?'
}

/** The card a converted Issue/PR becomes; the user still reviews it in the new-task form. */
export function draftFromItem(item: GithubItem) {
  const description = [item.url, item.body.trim()].filter(Boolean).join('\n\n')
  return {
    title: item.title,
    description,
    ...(item.kind === 'pr' ? { branch: item.headRefName, baseBranch: item.baseRefName } : {}),
    github: githubRefOf(item),
  }
}
