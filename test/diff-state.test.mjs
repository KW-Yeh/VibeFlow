import test from 'node:test'
import assert from 'node:assert/strict'

import {
  retainExistingDiffContents,
  sameDiffFile,
  stabilizeDiffEntries,
} from '../renderer/lib/diff-state.ts'

function entry(overrides = {}) {
  return {
    path: 'renderer/example.tsx',
    status: 'M',
    additions: 2,
    deletions: 1,
    revision: '100:20',
    ...overrides,
  }
}

test('stabilizeDiffEntries preserves references for an unchanged poll', () => {
  const currentEntry = entry()
  const current = [currentEntry]
  const result = stabilizeDiffEntries(current, [entry()])

  assert.equal(result, current)
  assert.equal(result[0], currentEntry)
})

test('stabilizeDiffEntries replaces only entries whose revision changed', () => {
  const first = entry()
  const second = entry({ path: 'main/main.ts', revision: '200:40' })
  const nextSecond = entry({ path: 'main/main.ts', revision: '201:40' })
  const result = stabilizeDiffEntries([first, second], [entry(), nextSecond])

  assert.equal(result[0], first)
  assert.equal(result[1], nextSecond)
})

test('retainExistingDiffContents keeps stale bodies while files remain visible', () => {
  const body = {
    ...entry(),
    oldValue: 'before',
    newValue: 'after',
    truncated: false,
  }
  const current = { [body.path]: body }

  assert.equal(
    retainExistingDiffContents(current, [entry({ revision: 'changed' })]),
    current
  )
  assert.deepEqual(retainExistingDiffContents(current, []), {})
})

test('sameDiffFile detects unchanged content snapshots', () => {
  const body = {
    ...entry(),
    oldValue: 'before',
    newValue: 'after',
    truncated: false,
  }

  assert.equal(sameDiffFile(body, { ...body }), true)
  assert.equal(sameDiffFile(body, { ...body, revision: 'timestamp-only' }), true)
  assert.equal(sameDiffFile(body, { ...body, newValue: 'newer' }), false)
})
