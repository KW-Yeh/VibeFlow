import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSearchArgs, buildViewArgs, createJiraService, isJiraRef, JIRA_INBOX_JQL, toTicket } from '../packages/core/src/jira.ts'
import { hasSingleSitePrompt, parseAuthStatus } from '../packages/core/src/jira-auth.ts'

const site = 'example.atlassian.net'
const raw = {
  key: 'WR-5729',
  fields: {
    summary: 'Fix login', status: { name: 'Architecture Review', statusCategory: { key: 'indeterminate' } },
    issuetype: { name: 'Story' }, priority: { name: 'High' }, duedate: '2026-10-29',
    project: { key: 'WR' }, customfield_10033: 8, customfield_10016: null,
    customfield_10020: [{ name: 'Old', state: 'closed' }, { name: 'Active sprint', state: 'active' }],
    parent: { key: 'WR-100' }, attachment: [
      { id: '12345', filename: 'design.pdf', size: 2048, content: 'https://evil.example/file' },
      { id: '../bad', filename: 'unsafe.pdf', size: 1 },
      { id: '67890', filename: '', size: 1 },
    ], description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Details' }] }] },
    created: '2026-10-01T00:00:00Z', updated: '2026-10-02T00:00:00Z',
  },
}

test('Jira search requests CLI-supported fields and view requests detail fields', () => {
  const args = buildSearchArgs()
  assert.ok(args.includes(JIRA_INBOX_JQL))
  assert.equal(args[args.indexOf('--fields') + 1], 'key,summary,status,issuetype,priority,description')
  assert.deepEqual(args.slice(-4), ['--json', '--paginate', '--limit', '200'])
  const view = buildViewArgs('WR-5729', ['customfield_12345'])
  assert.deepEqual(view.slice(0, 4), ['jira', 'workitem', 'view', 'WR-5729'])
  assert.match(view[view.indexOf('--fields') + 1], /customfield_12345/)
  assert.match(view[view.indexOf('--fields') + 1], /attachment/)
})

test('Jira ticket conversion reads points, sprint, category and ADF', () => {
  const ticket = toTicket(raw, site)
  assert.equal(ticket?.storyPoints, 8)
  assert.equal(ticket?.sprint, 'Active sprint')
  assert.equal(ticket?.status.category, 'indeterminate')
  assert.equal(ticket?.description, 'Details')
  assert.equal(ticket?.dueDate, '2026-10-29')
  assert.deepEqual(ticket?.attachments, [{ id: '12345', filename: 'design.pdf', size: 2048,
    url: 'https://example.atlassian.net/rest/api/3/attachment/content/12345' }])
  assert.deepEqual(toTicket({ ...raw, fields: { ...raw.fields, attachment: null } }, site)?.attachments, [])
  assert.deepEqual(toTicket(raw, 'evil.example')?.attachments, [])
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

test('Jira login selects only a complete single-site prompt automatically', () => {
  const prompt = 'Select the site to login\r\n> https://example.atlassian.net\r\n↑ up • ↓ down • / filter • enter submit'
  assert.equal(hasSingleSitePrompt(`\x1b[32m${prompt}\x1b[0m`), true)
  assert.equal(hasSingleSitePrompt(prompt.replace('enter submit', '')), false)
  assert.equal(hasSingleSitePrompt(prompt.replace('enter submit', '  https://other.atlassian.net\nenter submit')), false)
})

test('Jira inbox caches search for five minutes and force refreshes', async () => {
  let time = 1_000
  let calls = 0
  const service = createJiraService({
    now: () => time,
    authStatus: async () => ({ installed: true, authenticated: true, site }),
    run: async (args) => { calls++; return JSON.stringify(args[2] === 'search' ? { issues: [raw] } : raw) },
  })
  assert.equal((await service.inbox()).tickets[0].key, 'WR-5729')
  await service.inbox()
  assert.equal(calls, 2)
  await service.inbox({ force: true })
  assert.equal(calls, 4)
  time += 300_001
  await service.inbox()
  assert.equal(calls, 6)
})

test('Jira inbox merges individual work item details into search results', async () => {
  const calls = []
  const service = createJiraService({
    authStatus: async () => ({ installed: true, authenticated: true, site }),
    run: async (args) => {
      calls.push(args)
      return JSON.stringify(args[2] === 'search'
        ? [{ key: raw.key, fields: { summary: raw.fields.summary, status: raw.fields.status } }]
        : { key: raw.key, fields: raw.fields })
    },
  })
  const inbox = await service.inbox()
  assert.equal(inbox.tickets[0].storyPoints, 8)
  assert.equal(inbox.tickets[0].dueDate, '2026-10-29')
  assert.equal(calls[1][2], 'view')
})

test('Jira inbox keeps search results and reports failed detail requests', async () => {
  const service = createJiraService({
    authStatus: async () => ({ installed: true, authenticated: true, site }),
    run: async (args) => {
      if (args[2] === 'view') throw new Error('detail unavailable')
      return JSON.stringify([raw])
    },
  })
  const inbox = await service.inbox()
  assert.equal(inbox.tickets[0].key, raw.key)
  assert.match(inbox.error, /1 張 Jira ticket/)
})

test('Jira inbox handles missing CLI and unauthenticated account', async () => {
  const missing = createJiraService({ authStatus: async () => ({ installed: false, authenticated: false }) })
  assert.equal((await missing.inbox()).status, 'acli-missing')
  const loggedOut = createJiraService({ authStatus: async () => ({ installed: true, authenticated: false }) })
  assert.equal((await loggedOut.inbox()).status, 'unauthenticated')
})
