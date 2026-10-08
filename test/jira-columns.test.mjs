import test from 'node:test'
import assert from 'node:assert/strict'
import { jiraStatusColumns } from '../renderer/lib/jira-columns.ts'

const ticket = (key, name, category, dueDate = null) => ({ key, status: { name, category }, dueDate })

test('Jira tickets form dynamic status columns in category and name order', () => {
  const columns = jiraStatusColumns([
    ticket('WR-2', 'Done', 'done'),
    ticket('WR-10', 'Architecture Review', 'indeterminate', '2026-10-10'),
    ticket('WR-3', 'To Do', 'new', '2026-10-09'),
    ticket('WR-4', 'In Progress', 'indeterminate'),
  ])
  assert.deepEqual(columns.map((column) => [column.name, column.tickets.length]), [
    ['To Do', 1], ['Architecture Review', 1], ['In Progress', 1], ['Done', 1],
  ])
  assert.deepEqual(jiraStatusColumns([]), [])
})

test('Jira tickets in each status sort by due date, then descending key number', () => {
  const columns = jiraStatusColumns([
    ticket('WR-2', 'To Do', 'new'),
    ticket('WR-11', 'To Do', 'new', '2026-10-09'),
    ticket('WR-8', 'To Do', 'new', '2026-10-09'),
    ticket('WR-7', 'To Do', 'new'),
    ticket('WR-10', 'Done', 'done', '2026-10-08'),
  ])
  assert.deepEqual(columns.map((column) => column.tickets.map((entry) => entry.key)), [
    ['WR-11', 'WR-8', 'WR-7', 'WR-2'], ['WR-10'],
  ])
})
