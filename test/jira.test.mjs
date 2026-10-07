import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSearchArgs, createJiraService, isJiraRef, JIRA_INBOX_JQL, toTicket } from '../packages/core/src/jira.ts'
import { parseAuthStatus } from '../packages/core/src/jira-auth.ts'

const site = 'example.atlassian.net'
const raw = {
  key: 'WR-5729',
  fields: {
    summary: 'Fix login', status: { name: 'Architecture Review', statusCategory: { key: 'indeterminate' } },
    issuetype: { name: 'Story' }, priority: { name: 'High' }, duedate: '2026-10-29',
    project: { key: 'WR' }, customfield_10033: 8, customfield_10016: null,
    customfield_10020: [{ name: 'Old', state: 'closed' }, { name: 'Active sprint', state: 'active' }],
    parent: { key: 'WR-100' }, description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Details' }] }] },
    created: '2026-10-01T00:00:00Z', updated: '2026-10-02T00:00:00Z',
  },
}

test('Jira search uses the assigned active-sprint JQL and requested fields', () => {
  const args = buildSearchArgs(['customfield_12345'])
  assert.ok(args.includes(JIRA_INBOX_JQL))
  assert.match(args[args.indexOf('--fields') + 1], /customfield_12345/)
  assert.deepEqual(args.slice(-4), ['--json', '--paginate', '--limit', '200'])
})

test('Jira ticket conversion reads points, sprint, category and ADF', () => {
  const ticket = toTicket(raw, site)
  assert.equal(ticket?.storyPoints, 8)
  assert.equal(ticket?.sprint, 'Active sprint')
  assert.equal(ticket?.status.category, 'indeterminate')
  assert.equal(ticket?.description, 'Details')
  assert.equal(ticket?.dueDate, '2026-10-29')
  assert.equal(toTicket(raw, site, ['customfield_10016'])?.storyPoints, null)
})

test('Jira refs accept only the matching Atlassian browse URL', () => {
  const ref = { key: 'WR-5729', site, url: `https://${site}/browse/WR-5729` }
  assert.equal(isJiraRef(ref), true)
  assert.equal(isJiraRef({ ...ref, url: 'https://evil.example/browse/WR-5729' }), false)
  assert.equal(isJiraRef({ ...ref, key: 'bad' }), false)
})

test('auth status parses site and email without ANSI text', () => {
  assert.deepEqual(parseAuthStatus('\x1b[32mSite: example.atlassian.net\nEmail: user@example.com\x1b[0m'), {
    installed: true, authenticated: true, site, email: 'user@example.com',
  })
  assert.equal(parseAuthStatus('Not logged in').authenticated, false)
})

test('Jira inbox caches search for five minutes and force refreshes', async () => {
  let time = 1_000
  let calls = 0
  const service = createJiraService({
    now: () => time,
    authStatus: async () => ({ installed: true, authenticated: true, site }),
    run: async () => { calls++; return JSON.stringify({ issues: [raw] }) },
  })
  assert.equal((await service.inbox()).tickets[0].key, 'WR-5729')
  await service.inbox()
  assert.equal(calls, 1)
  await service.inbox({ force: true })
  assert.equal(calls, 2)
  time += 300_001
  await service.inbox()
  assert.equal(calls, 3)
})

test('Jira inbox handles missing CLI and unauthenticated account', async () => {
  const missing = createJiraService({ authStatus: async () => ({ installed: false, authenticated: false }) })
  assert.equal((await missing.inbox()).status, 'acli-missing')
  const loggedOut = createJiraService({ authStatus: async () => ({ installed: true, authenticated: false }) })
  assert.equal((await loggedOut.inbox()).status, 'unauthenticated')
})
