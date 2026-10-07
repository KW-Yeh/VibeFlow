import test from 'node:test'
import assert from 'node:assert/strict'

import {
  EMPTY_GITHUB_FILTERS,
  UNASSIGNED,
  githubEntries,
  githubFilterOptions,
  hasGithubFilters,
  matchesGithubFilters,
  toggleValue,
} from '../renderer/lib/github-filter.ts'

const user = (login) => ({ login })

function item(kind, number, { author = 'me', assignees = [] } = {}) {
  return {
    kind,
    repo: 'acme/demo',
    number,
    title: `${kind} ${number}`,
    url: '',
    body: '',
    author: author === null ? null : user(author),
    assignees: assignees.map(user),
    labels: [],
    milestone: null,
    createdAt: '2026-10-01T00:00:00Z',
  }
}

function repo(projectName, { issues = [], prs = [] } = {}) {
  return { repo: `acme/${projectName}`, projectName, projectPath: `/p/${projectName}`, issues, prs }
}

const filters = (over = {}) => ({ ...EMPTY_GITHUB_FILTERS, ...over })
const numbers = (entries) => entries.map((e) => `${e.projectName}#${e.item.number}`)

const REPOS = [
  repo('VibeFlow', {
    issues: [
      item('issue', 108, { author: 'amy', assignees: ['me'] }),
      item('issue', 112, { author: 'me', assignees: ['me', 'ben'] }),
      item('issue', 90, { author: 'ben' }),
    ],
    prs: [item('pr', 103, { author: 'amy', assignees: ['me'] })],
  }),
  repo('clcom-frontend', {
    issues: [item('issue', 431, { author: 'ben', assignees: ['me'] }), item('issue', 7, { author: null })],
    prs: [item('pr', 440, { author: 'ben' })],
  }),
]

test('no filter shows everything, grouped by project and highest number first', () => {
  assert.deepEqual(numbers(githubEntries(REPOS, 'issues', EMPTY_GITHUB_FILTERS)), [
    'clcom-frontend#431',
    'clcom-frontend#7',
    'VibeFlow#112',
    'VibeFlow#108',
    'VibeFlow#90',
  ])
  assert.deepEqual(numbers(githubEntries(REPOS, 'prs', EMPTY_GITHUB_FILTERS)), [
    'clcom-frontend#440',
    'VibeFlow#103',
  ])
})

test('values ticked in one filter are OR-ed', () => {
  assert.deepEqual(numbers(githubEntries(REPOS, 'issues', filters({ authors: ['amy', 'ben'] }))), [
    'clcom-frontend#431',
    'VibeFlow#108',
    'VibeFlow#90',
  ])
  assert.equal(githubEntries(REPOS, 'issues', filters({ projects: ['VibeFlow', 'clcom-frontend'] })).length, 5)
})

test('filters are AND-ed with each other', () => {
  const shown = githubEntries(REPOS, 'issues', filters({ projects: ['VibeFlow'], authors: ['amy', 'me'], assignees: ['ben'] }))
  assert.deepEqual(numbers(shown), ['VibeFlow#112'])
})

test('an assignee filter matches any of an item’s assignees; UNASSIGNED matches only items with none', () => {
  assert.deepEqual(numbers(githubEntries(REPOS, 'issues', filters({ assignees: ['ben'] }))), ['VibeFlow#112'])
  assert.deepEqual(numbers(githubEntries(REPOS, 'issues', filters({ assignees: [UNASSIGNED] }))), [
    'clcom-frontend#7',
    'VibeFlow#90',
  ])
  assert.deepEqual(numbers(githubEntries(REPOS, 'prs', filters({ assignees: [UNASSIGNED, 'me'] }))), [
    'clcom-frontend#440',
    'VibeFlow#103',
  ])
})

test('an author filter never matches an item without an author', () => {
  const entry = { item: item('issue', 7, { author: null }), projectName: 'x', projectPath: '/x' }
  assert.equal(matchesGithubFilters(entry, filters({ authors: ['me'] })), false)
  assert.equal(matchesGithubFilters(entry, EMPTY_GITHUB_FILTERS), true)
})

test('options are the values in the data, sorted and de-duplicated, with UNASSIGNED first', () => {
  assert.deepEqual(githubFilterOptions(REPOS, EMPTY_GITHUB_FILTERS), {
    projects: ['clcom-frontend', 'VibeFlow'],
    assignees: [UNASSIGNED, 'ben', 'me'],
    authors: ['amy', 'ben', 'me'],
  })
})

test('a ticked value missing from the data stays an option so it can be unticked', () => {
  const options = githubFilterOptions(REPOS, filters({ projects: ['Gone'], assignees: [UNASSIGNED, 'zed'], authors: ['old'] }))
  assert.ok(options.projects.includes('Gone'))
  assert.deepEqual(options.assignees, [UNASSIGNED, 'ben', 'me', 'zed'])
  assert.ok(options.authors.includes('old'))
})

test('hasGithubFilters and toggleValue', () => {
  assert.equal(hasGithubFilters(EMPTY_GITHUB_FILTERS), false)
  assert.equal(hasGithubFilters(filters({ authors: ['me'] })), true)
  assert.deepEqual(toggleValue(['a'], 'b'), ['a', 'b'])
  assert.deepEqual(toggleValue(['a', 'b'], 'a'), ['b'])
})
