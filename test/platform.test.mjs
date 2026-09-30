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

test('appDataDir mirrors Electron per OS', () => {
  const home = os.homedir()
  const expected = {
    darwin: path.join(home, 'Library', 'Application Support'),
    win32: process.env.APPDATA || path.join(home, 'AppData', 'Roaming'),
  }[process.platform] ?? (process.env.XDG_CONFIG_HOME || path.join(home, '.config'))
  assert.equal(appDataDir(), expected)
})

test('the dev profile is the " (development)" userData main.ts redirects to', () => {
  assert.equal(defaultUserDataDir('prod'), path.join(appDataDir(), 'vibeflow'))
  assert.equal(defaultUserDataDir('dev'), path.join(appDataDir(), 'vibeflow (development)'))
})

test('the Node platform has no picker and no source root unless told', async () => {
  setPlatform(createNodePlatform({ userDataDir: '/tmp/vf' }))
  assert.equal(getPlatform().userDataDir(), '/tmp/vf')
  assert.equal(getPlatform().sourceRoot(), null)
  assert.equal(await getPlatform().pickPath({ title: 't', kind: 'directory' }), null)
})
