import test from 'node:test'
import assert from 'node:assert/strict'
import { checkForUpdate, createUpdateMonitor, isNewerVersion, UPDATE_CHECK_INTERVAL_MS } from '../packages/cli/src/update-check.ts'

test('update checks are scheduled two hours apart', () => {
  assert.equal(UPDATE_CHECK_INTERVAL_MS, 2 * 60 * 60 * 1000)
})

test('compares stable versions and does not suggest an older or invalid release', () => {
  assert.equal(isNewerVersion('4.12.0', '4.11.1'), true)
  assert.equal(isNewerVersion('5.0.0', '4.99.99'), true)
  assert.equal(isNewerVersion('4.11.1', '4.11.1'), false)
  assert.equal(isNewerVersion('4.10.9', '4.11.1'), false)
  assert.equal(isNewerVersion('broken', '4.11.1'), false)
  assert.equal(isNewerVersion('4.11.1', '4.11.1-beta.1'), true)
})

test('uses the published latest tag and only reports a newer release', async () => {
  const names = []
  const query = async (name) => { names.push(name); return '"4.12.0"' }
  assert.deepEqual(await checkForUpdate('@kw-yeh/vibeflow', '4.11.1', query), {
    currentVersion: '4.11.1', latestVersion: '4.12.0',
  })
  assert.deepEqual(names, ['@kw-yeh/vibeflow'])
  assert.equal(await checkForUpdate('@kw-yeh/vibeflow', '4.12.0', query), null)
  await assert.rejects(checkForUpdate('@kw-yeh/vibeflow', '4.11.1', async () => { throw new Error('offline') }), /offline/)
})

test('the monitor answers manual checks, broadcasts only changes and keeps the last answer on failure', async () => {
  const emitted = []
  let latest = '4.12.0'
  const monitor = createUpdateMonitor({
    packageName: '@kw-yeh/vibeflow', currentVersion: '4.11.1',
    onChange: (update) => emitted.push(update),
    check: (name, version) => checkForUpdate(name, version, async () => {
      if (latest === 'offline') throw new Error('offline')
      return JSON.stringify(latest)
    }),
  })
  assert.equal(monitor.supported, true)
  assert.equal(monitor.status(), null)
  assert.deepEqual(await monitor.refresh(), { status: 'available', currentVersion: '4.11.1', latestVersion: '4.12.0' })
  await monitor.refresh()
  assert.equal(emitted.length, 1, 'the same release is not broadcast twice')
  latest = 'offline'
  await assert.rejects(monitor.refresh(), /offline/)
  assert.deepEqual(monitor.status(), { currentVersion: '4.11.1', latestVersion: '4.12.0' })
  latest = '4.11.1'
  assert.deepEqual(await monitor.refresh(), { status: 'current', currentVersion: '4.11.1' })
  assert.equal(monitor.status(), null)
  assert.deepEqual(emitted.at(-1), null)
})

test('the monitor never queries npm outside a global npm install', async () => {
  const monitor = createUpdateMonitor({
    packageName: null, currentVersion: '4.11.1', onChange: () => assert.fail('no broadcast'),
    check: async () => assert.fail('no npm query'),
  })
  assert.equal(monitor.supported, false)
  assert.deepEqual(await monitor.refresh(), { status: 'unsupported', currentVersion: '4.11.1' })
})
