import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { jevKeyStatus, readJevApiKey, removeJevApiKey, saveJevApiKey } from '../packages/core/src/jev-credentials.ts'

test('Jev key stays in a separate host file and a saved key overrides the environment', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-jev-key-'))
  const dir = path.join(root, 'Library', 'Application Support', 'vibeflow (development)')
  const previous = process.env.TYPESAFE_API_KEY
  process.env.TYPESAFE_API_KEY = 'env-key'
  t.after(() => {
    if (previous === undefined) delete process.env.TYPESAFE_API_KEY
    else process.env.TYPESAFE_API_KEY = previous
    fs.rmSync(root, { recursive: true, force: true })
  })
  assert.deepEqual(jevKeyStatus(dir), { configured: true, source: 'environment' })
  assert.deepEqual(saveJevApiKey('saved-key', dir), { configured: true, source: 'saved' })
  assert.equal(readJevApiKey(dir), 'saved-key')
  assert.equal(fs.readFileSync(path.join(dir, 'jev-api-key'), 'utf8'), 'saved-key')
  saveJevApiKey('replacement-key', dir)
  assert.equal(readJevApiKey(dir), 'replacement-key')
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'jev-api-key')).mode & 0o777, 0o600)
  assert.deepEqual(removeJevApiKey(dir), { configured: true, source: 'environment' })
  assert.equal(readJevApiKey(dir), 'env-key')
  assert.throws(() => saveJevApiKey('bad\nkey', dir), /格式無效/)
})
