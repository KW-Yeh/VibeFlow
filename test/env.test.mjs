import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'

const delimiter = path.delimiter
const envPathKey =
  Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ??
  (process.platform === 'win32' ? 'Path' : 'PATH')
const duplicateEntry = process.platform === 'win32'
  ? process.env.APPDATA
    ? path.join(process.env.APPDATA, 'npm')
    : path.join(os.homedir(), '.local', 'bin')
  : '/opt/homebrew/bin'
const customEntry = process.platform === 'win32'
  ? path.join(os.homedir(), 'custom-tool-bin')
  : '/custom/tool/bin'

// Control PATH and a probe variable BEFORE the first buildEnv() call so the
// memoised result is deterministic. buildEnv reads process.env lazily.
process.env[envPathKey] = [duplicateEntry, customEntry].join(delimiter)
process.env.VF_ENV_TEST_EXISTING = 'present'

const { buildEnv } = await import('../main/helpers/env.ts')

function pathParts() {
  const env = buildEnv()
  const key = Object.keys(env).find((k) => k.toLowerCase() === 'path')
  assert.ok(key, 'expected a PATH-like env key')
  return env[key].split(delimiter)
}

test('buildEnv preserves existing PATH entries in order', () => {
  const parts = pathParts()
  assert.equal(parts[0], duplicateEntry)
  assert.equal(parts[1], customEntry)
})

test('buildEnv appends the standard CLI bin locations', () => {
  const parts = pathParts()
  if (process.platform === 'win32') {
    if (process.env.APPDATA) {
      assert.ok(parts.includes(path.join(process.env.APPDATA, 'npm')))
    }
    if (process.env.LOCALAPPDATA) {
      assert.ok(
        parts.includes(
          path.join(process.env.LOCALAPPDATA, 'Programs', 'OpenAI', 'Codex', 'bin')
        )
      )
    }
    assert.ok(parts.includes(path.join(os.homedir(), '.local', 'bin')))
  } else {
    assert.ok(parts.includes('/usr/local/bin'))
    assert.ok(parts.includes('/usr/bin'))
    assert.ok(parts.includes('/opt/homebrew/sbin'))
  }
})

test('buildEnv never duplicates an entry already on PATH', () => {
  const parts = pathParts()
  const matches = parts.filter((p) => {
    return process.platform === 'win32'
      ? p.toLowerCase() === duplicateEntry.toLowerCase()
      : p === duplicateEntry
  })
  assert.equal(matches.length, 1, `${duplicateEntry} must appear exactly once`)
})

test('buildEnv copies through other env vars', () => {
  assert.equal(buildEnv().VF_ENV_TEST_EXISTING, 'present')
})

test('buildEnv is memoised (returns the same reference)', () => {
  assert.equal(buildEnv(), buildEnv())
})
