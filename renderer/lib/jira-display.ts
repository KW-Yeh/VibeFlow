import type { JiraTicket, Task } from './types'

export const JIRA_CATEGORY_CLASS = {
  new: 'bg-accent text-muted-foreground',
  indeterminate: 'bg-primary/15 text-primary',
  done: 'bg-success/15 text-success',
}

export function dueInfo(dueDate: string | null, now = Date.now()) {
  if (!dueDate) return { text: '無期限', tone: 'none' as const, title: '' }
  const day = new Date(`${dueDate.slice(0, 10)}T00:00:00`).getTime()
  if (!Number.isFinite(day)) return { text: '無期限', tone: 'none' as const, title: '' }
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const days = Math.round((day - today.getTime()) / 86400000)
  if (days < 0) return { text: `已逾期 ${-days} 天`, tone: 'overdue' as const, title: dueDate }
  if (days === 0) return { text: '今天到期', tone: 'today' as const, title: dueDate }
  if (days <= 3) return { text: `剩 ${days} 天`, tone: 'soon' as const, title: dueDate }
  return { text: `截止 ${new Date(day).getMonth() + 1}/${new Date(day).getDate()}`, tone: 'normal' as const, title: dueDate }
}

export function boardJiraCards(tasks: Task[]): Map<string, string> {
  const cards = new Map<string, string>()
  for (const task of tasks) if (task.jira && !cards.has(task.jira.key)) cards.set(task.jira.key, task.id)
  return cards
}

export function draftFromTicket(ticket: JiraTicket) {
  return {
    title: `${ticket.key} ${ticket.summary}`,
    description: [ticket.url, ticket.description].filter(Boolean).join('\n\n'),
    jira: { key: ticket.key, url: ticket.url, site: new URL(ticket.url).host },
  }
}
