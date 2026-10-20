import type { JiraTicket } from './types'

export interface JiraStatusColumn {
  name: 'To Do' | 'In Progress' | 'To be Released' | 'Done'
  tickets: JiraTicket[]
}

function keyNumber(key: string): number { return Number(key.split('-').at(-1)) || 0 }

function byDueDateAndKey(a: JiraTicket, b: JiraTicket): number {
  if (!a.dueDate) return b.dueDate ? 1 : keyNumber(b.key) - keyNumber(a.key)
  if (!b.dueDate) return -1
  return a.dueDate.localeCompare(b.dueDate) || keyNumber(b.key) - keyNumber(a.key)
}

/** Keep a stable four-column board while preserving each ticket's actual Jira status. */
export function jiraStatusColumns(tickets: JiraTicket[]): JiraStatusColumn[] {
  const columns: JiraStatusColumn[] = [
    { name: 'To Do', tickets: [] },
    { name: 'In Progress', tickets: [] },
    { name: 'To be Released', tickets: [] },
    { name: 'Done', tickets: [] },
  ]
  for (const ticket of tickets) {
    const status = ticket.status.name.toLowerCase()
    const index = status === 'to be released' ? 2
      : ticket.status.category === 'done' ? 3
      : ticket.status.category === 'new' ? 0 : 1
    columns[index].tickets.push(ticket)
  }
  return columns.map((column) => ({ ...column, tickets: column.tickets.sort(byDueDateAndKey) }))
}
