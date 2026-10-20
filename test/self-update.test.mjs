import test from 'node:test'
import assert from 'node:assert/strict'
import {
  HOST_TOKEN_ENV, PROBE_RETRY_MS, relaunchArgs, takeHandedOverToken, watchInstalledVersion,
} from '../packages/cli/src/self-update.ts'

function watcher(versions, probeAnswers) {
  const installed = []
  const probes = []
  let clock = 0
  const w = watchInstalledVersion({
    packageRoot: '/pkg', cliEntry: '/pkg/dist/vibeflow.mjs', currentVersion: '4.11.1',
    onInstalled: (version) => installed.push(version),
    readVersion: () => versions.shift() ?? null,
    probe: async (entry) => { probes.push(entry); return probeAnswers.shift() ?? null },
    now: () => clock,
  })
  return { w, installed, probes, advance: (ms) => { clock += ms } }
}

test('a newer version counts as installed after two identical reads and a CLI that reports it', async () => {
  const { w, installed, probes } = watcher(['4.11.1', '4.12.0', '4.12.0', '4.12.0'], ['4.12.0'])
  await w.tick()
  await w.tick()
  assert.deepEqual(installed, [], 'one read of a new version is not enough')
  await w.tick()
  assert.deepEqual(installed, ['4.12.0'])
  await w.tick()
  assert.deepEqual(installed, ['4.12.0', '4.12.0'], 'repeats so a blocked restart can happen later')
  assert.deepEqual(probes, ['/pkg/dist/vibeflow.mjs'], 'the CLI is run once per version')
})

test('older, equal or unreadable versions never count', async () => {
  const { w, installed, probes } = watcher(['4.11.1', '4.11.1', '4.10.0', '4.10.0', null, null], [])
  for (let i = 0; i < 6; i++) await w.tick()
  assert.deepEqual(installed, [])
  assert.deepEqual(probes, [])
})

test('a CLI that does not run yet is probed again later', async () => {
  const { w, installed, probes, advance } = watcher(Array(5).fill('4.12.0'), [null, '4.12.0'])
  await w.tick()
  await w.tick()
  await w.tick()
  assert.deepEqual(installed, [])
  assert.equal(probes.length, 1, 'no new probe inside the retry window')
  advance(PROBE_RETRY_MS)
  await w.tick()
  assert.deepEqual(installed, ['4.12.0'])
})

test('the replacement host keeps the store, port and session backend', () => {
  assert.deepEqual(relaunchArgs('/pkg/dist/vibeflow.mjs', { userDataDir: '/data', port: 47820, backend: 'tmux' }), [
    '/pkg/dist/vibeflow.mjs', 'web', '--no-open', '--store-path', '/data', '--port', '47820', '--backend', 'tmux',
  ])
})

test('a handed-over token is taken out of the environment and must look like a host token', () => {
  const token = 'a'.repeat(43)
  const env = { [HOST_TOKEN_ENV]: token, OTHER: '1' }
  assert.equal(takeHandedOverToken(env), token)
  assert.deepEqual(env, { OTHER: '1' })
  assert.equal(takeHandedOverToken({ [HOST_TOKEN_ENV]: 'short' }), undefined)
  assert.equal(takeHandedOverToken({}), undefined)
})
