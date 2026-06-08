import test from 'node:test'
import assert from 'node:assert/strict'

// Control PATH BEFORE the first buildEnv() call so the memoised result is
// deterministic. buildEnv reads process.env lazily (inside the function), not
// at import time, so setting it here governs what the first call sees.
process.env.PATH = '/opt/homebrew/bin:/custom/tool/bin'

const { buildEnv } = await import('../main/helpers/env.ts')

test('buildEnv — preserves existing PATH entries in order', () => {
  const parts = buildEnv().PATH.split(':')
  assert.equal(parts[0], '/opt/homebrew/bin')
  assert.equal(parts[1], '/custom/tool/bin')
})

test('buildEnv — appends the standard CLI bin locations', () => {
  const parts = buildEnv().PATH.split(':')
  assert.ok(parts.includes('/usr/local/bin'))
  assert.ok(parts.includes('/usr/bin'))
  assert.ok(parts.includes('/opt/homebrew/sbin'))
})

test('buildEnv — never duplicates an entry already on PATH', () => {
  const parts = buildEnv().PATH.split(':')
  const homebrew = parts.filter((p) => p === '/opt/homebrew/bin')
  assert.equal(homebrew.length, 1, '/opt/homebrew/bin must appear exactly once')
})

test('buildEnv — copies through other env vars', () => {
  process.env.VF_PROBE_VAR = 'present'
  // Cached: the value captured at first call. We set PATH before first call,
  // but VF_PROBE_VAR may post-date the cache — assert on PATH-independent keys
  // that existed at import: HOME is always present in the copied env.
  assert.equal(typeof buildEnv().HOME, 'string')
})

test('buildEnv — is memoised (returns the same reference)', () => {
  assert.equal(buildEnv(), buildEnv())
})
