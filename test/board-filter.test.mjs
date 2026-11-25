import test from 'node:test'
import assert from 'node:assert/strict'

import {
  EMPTY_BOARD_FILTERS,
  UNTAGGED,
  boardFilterOptions,
  hasBoardFilters,
  liveBoardFilters,
  masterMatch,
  matchesBoardFilters,
  projectLabel,
} from '../renderer/lib/board-filter.ts'

const card = (id, { project = 'alpha', tags, role, projectPath } = {}) => ({
  id,
  title: id,
  projectName: projectPath ? undefined : project,
  projectPath: projectPath ?? `/repos/${project}`,
  ...(tags ? { tags } : {}),
  ...(role ? { role } : {}),
})

const tagDefs = [
  { id: 't-review', name: '等待 review', color: 'amber' },
  { id: 't-ci', name: '等 CI', color: 'blue' },
]

test('projectLabel: master, projectName, then the path tail', () => {
  assert.equal(projectLabel(card('m', { role: 'master' })), 'Master')
  assert.equal(projectLabel(card('a', { project: 'alpha' })), 'alpha')
  assert.equal(projectLabel(card('b', { projectPath: 'C:\\work\\beta' })), 'beta')
})

test('no filter lets every card through', () => {
  assert.equal(hasBoardFilters(EMPTY_BOARD_FILTERS), false)
  assert.equal(matchesBoardFilters(card('a'), EMPTY_BOARD_FILTERS), true)
})

test('OR within a filter, AND across filters', () => {
  const filters = { projects: ['alpha', 'beta'], tags: ['t-review'] }
  assert.equal(matchesBoardFilters(card('a', { project: 'alpha', tags: ['t-review'] }), filters), true)
  assert.equal(matchesBoardFilters(card('b', { project: 'beta', tags: ['t-ci', 't-review'] }), filters), true)
  assert.equal(matchesBoardFilters(card('c', { project: 'gamma', tags: ['t-review'] }), filters), false)
  assert.equal(matchesBoardFilters(card('d', { project: 'alpha', tags: ['t-ci'] }), filters), false)
  assert.equal(matchesBoardFilters(card('e', { project: 'alpha' }), filters), false)
})

test('untagged matches only cards without tags', () => {
  const filters = { projects: [], tags: [UNTAGGED] }
  assert.equal(matchesBoardFilters(card('a'), filters), true)
  assert.equal(matchesBoardFilters(card('b', { tags: [] }), filters), true)
  assert.equal(matchesBoardFilters(card('c', { tags: ['t-ci'] }), filters), false)
  const either = { projects: [], tags: [UNTAGGED, 't-ci'] }
  assert.equal(matchesBoardFilters(card('c', { tags: ['t-ci'] }), either), true)
})

test('a master that matches itself keeps every card under it', () => {
  const master = card('m', { role: 'master' })
  const slaves = [{ task: card('a', { project: 'alpha' }) }, { task: card('b', { project: 'beta' }) }]
  const result = masterMatch(master, slaves, { projects: ['Master'], tags: [] })
  assert.deepEqual(result, { visible: true, slaves })
})

test('a master shown for its cards lists only the matching ones', () => {
  const master = card('m', { role: 'master' })
  const a = { task: card('a', { project: 'alpha' }) }
  const b = { task: card('b', { project: 'beta' }) }
  assert.deepEqual(masterMatch(master, [a, b], { projects: ['beta'], tags: [] }), { visible: true, slaves: [b] })
  assert.deepEqual(masterMatch(master, [a, b], { projects: ['gamma'], tags: [] }), { visible: false, slaves: [] })
  assert.deepEqual(masterMatch(master, [a, b], EMPTY_BOARD_FILTERS), { visible: true, slaves: [a, b] })
})

test('options: sorted projects incl. ticked-but-gone ones, every tag plus untagged', () => {
  const tasks = [card('a', { project: 'beta' }), card('b', { project: 'alpha' }), card('c', { project: 'alpha' })]
  const options = boardFilterOptions(tasks, tagDefs, { projects: ['zeta'], tags: [] })
  assert.deepEqual(options.projects, ['alpha', 'beta', 'zeta'])
  assert.deepEqual(options.tags, ['t-review', 't-ci', UNTAGGED])
})

test('a deleted tag drops out of the active filter', () => {
  const live = liveBoardFilters({ projects: ['alpha'], tags: ['t-gone', 't-ci', UNTAGGED] }, tagDefs)
  assert.deepEqual(live, { projects: ['alpha'], tags: ['t-ci', UNTAGGED] })
})
