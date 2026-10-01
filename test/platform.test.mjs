import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import {
  appDataDir,
  createNodePlatform,
  defaultUserDataDir,
  getPlatform,
  setPlatform,
} from '../packages/core/src/platform.ts'

// Runs first: node --test gives each file its own process, so nothing has
// registered a platform yet.
test('using core before a host registers its platform fails loudly', () => {
  assert.throws(() => getPlatform(), /setPlatform/)
})

test('appDataDir matches the former Electron app per OS, so old boards carry over', () => {
  const home = os.homedir()
  const expected = {
    darwin: path.join(home, 'Library', 'Application Support'),
    win32: process.env.APPDATA || path.join(home, 'AppData', 'Roaming'),
  }[process.platform] ?? (process.env.XDG_CONFIG_HOME || path.join(home, '.config'))
  assert.equal(appDataDir(), expected)
})

test('the dev profile is the former Electron dev app\'s " (development)" userData', () => {
  assert.equal(defaultUserDataDir('prod'), path.join(appDataDir(), 'vibeflow'))
  assert.equal(defaultUserDataDir('dev'), path.join(appDataDir(), 'vibeflow (development)'))
})

test('the Node platform has no source root unless told', () => {
  setPlatform(createNodePlatform({ userDataDir: '/tmp/vf' }))
  assert.equal(getPlatform().userDataDir(), '/tmp/vf')
  assert.equal(getPlatform().sourceRoot(), null)
})
