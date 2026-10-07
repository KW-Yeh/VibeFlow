import test from 'node:test'
import assert from 'node:assert/strict'
import { jiraEntries, jiraStatusOptions } from '../renderer/lib/jira-filter.ts'

const ticket = (key, name, category, dueDate = null) => ({ key, status: { name, category }, dueDate })
const tickets = [ticket('WR-2', 'Done', 'done'), ticket('WR-10', 'Architecture Review', 'indeterminate', '2026-10-10'), ticket('WR-3', 'To Do', 'new', '2026-10-09')]

test('Jira statuses follow category order and retain selected missing values', () => {
  assert.deepEqual(jiraStatusOptions(tickets, { statuses: ['Removed'] }), ['To Do', 'Architecture Review', 'Done', 'Removed'])
})

test('Jira filter matches selected statuses and sorts by due date then key', () => {
  assert.deepEqual(jiraEntries(tickets, { statuses: [] }).map((t) => t.key), ['WR-3', 'WR-10', 'WR-2'])
  assert.deepEqual(jiraEntries(tickets, { statuses: ['Done', 'To Do'] }).map((t) => t.key), ['WR-3', 'WR-2'])
})
