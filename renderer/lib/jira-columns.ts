import type { JiraStatusCategory, JiraTicket } from './types'

export interface JiraStatusColumn {
  name: string
  category: JiraStatusCategory
  tickets: JiraTicket[]
}

const categoryOrder: Record<JiraStatusCategory, number> = { new: 0, indeterminate: 1, done: 2 }

function keyNumber(key: string): number { return Number(key.split('-').at(-1)) || 0 }

function byDueDateAndKey(a: JiraTicket, b: JiraTicket): number {
  if (!a.dueDate) return b.dueDate ? 1 : keyNumber(b.key) - keyNumber(a.key)
  if (!b.dueDate) return -1
  return a.dueDate.localeCompare(b.dueDate) || keyNumber(b.key) - keyNumber(a.key)
}

/** One column per status present in this inbox, with its own due-date order. */
export function jiraStatusColumns(tickets: JiraTicket[]): JiraStatusColumn[] {
  const columns = new Map<string, JiraStatusColumn>()
  for (const ticket of tickets) {
    const name = ticket.status.name
    let column = columns.get(name)
    if (!column) {
      column = { name, category: ticket.status.category, tickets: [] }
      columns.set(name, column)
    }
    column.tickets.push(ticket)
  }
  return [...columns.values()]
    .sort((a, b) => categoryOrder[a.category] - categoryOrder[b.category] || a.name.localeCompare(b.name))
    .map((column) => ({ ...column, tickets: column.tickets.sort(byDueDateAndKey) }))
}
