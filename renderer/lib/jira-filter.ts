import type { JiraTicket } from './types'

export interface JiraFilters { statuses: string[] }
export const EMPTY_JIRA_FILTERS: JiraFilters = { statuses: [] }
const order = { new: 0, indeterminate: 1, done: 2 }

export function jiraStatusOptions(tickets: JiraTicket[], filters: JiraFilters): string[] {
  const categories = new Map(tickets.map((ticket) => [ticket.status.name, order[ticket.status.category]]))
  return Array.from(new Set([...categories.keys(), ...filters.statuses]))
    .sort((a, b) => (categories.get(a) ?? 3) - (categories.get(b) ?? 3) || a.localeCompare(b))
}

export function jiraEntries(tickets: JiraTicket[], filters: JiraFilters): JiraTicket[] {
  return tickets.filter((ticket) => !filters.statuses.length || filters.statuses.includes(ticket.status.name))
    .sort((a, b) => {
      if (!a.dueDate) return b.dueDate ? 1 : keyNumber(b.key) - keyNumber(a.key)
      if (!b.dueDate) return -1
      return a.dueDate.localeCompare(b.dueDate) || keyNumber(b.key) - keyNumber(a.key)
    })
}

function keyNumber(key: string): number { return Number(key.split('-').at(-1)) || 0 }
