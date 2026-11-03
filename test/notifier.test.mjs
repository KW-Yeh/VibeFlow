import test from 'node:test'
import assert from 'node:assert/strict'
import { createNotifier } from '../packages/core/src/notifier.ts'

const working = { state: 'working' }
const idle = { state: 'waiting', waitingFor: 'input' }
const dialog = { state: 'waiting', waitingFor: 'permission' }
const tick = () => new Promise((r) => setTimeout(r, 5))

function setup() {
  const delivered = []
  const master = { can: 'yes' }
  const notifier = createNotifier({
    cardOf: (id) => (id.startsWith('s') ? { title: `card ${id}`, masterId: 'm1' } : null),
    canReceive: async () => master.can,
    deliver: async (masterId, text) => { delivered.push({ masterId, text }) },
  })
  return { notifier, delivered, master }
}

test('each thing a card cannot say itself reaches its master once', async () => {
  const { notifier, delivered } = setup()
  notifier.activity('s1', working)
  notifier.activity('s1', dialog)
  notifier.activity('s1', dialog)
  await tick()
  notifier.launchFailed('s2', 'no such branch')
  await tick()
  notifier.exited('s3')
  notifier.exited('s3')
  await tick()
  assert.equal(delivered.length, 3)
  assert.ok(delivered[0].text.includes('s1') && delivered[0].text.includes('權限'))
  assert.ok(delivered[1].text.includes('no such branch'))
  assert.ok(delivered[2].text.includes('session 已結束'))
  assert.ok(delivered.every((d) => d.masterId === 'm1'))
})

test('a turn that ends without a report is told; one that reported is not', async () => {
  const { notifier, delivered } = setup()
  notifier.activity('s1', working)
  notifier.activity('s1', idle)
  await tick()
  assert.equal(delivered.length, 1)
  assert.ok(delivered[0].text.includes('沒有回報'))

  notifier.activity('s1', working)
  notifier.reported('s1')
  notifier.activity('s1', idle)
  await tick()
  assert.equal(delivered.length, 1)
})

test('a report made before a permission dialog still counts for that turn', async () => {
  const { notifier, delivered } = setup()
  notifier.activity('s1', working)
  notifier.reported('s1')
  notifier.activity('s1', dialog)
  notifier.activity('s1', working)
  notifier.activity('s1', dialog)
  notifier.activity('s1', working)
  notifier.activity('s1', idle)
  await tick()
  assert.equal(delivered.length, 1, 'one batch')
  assert.equal(delivered[0].text.split('\n').length, 2, 'blocked twice in one turn, no unreported note')
})

test('an idle card the host never saw start says nothing (a resumed session)', async () => {
  const { notifier, delivered } = setup()
  notifier.activity('s1', idle)
  notifier.activity('s1', { state: 'unknown' })
  notifier.activity('s1', idle)
  await tick()
  assert.equal(delivered.length, 0)
})

test('news waits while the master cannot take it, then arrives as one message', async () => {
  const { notifier, delivered, master } = setup()
  master.can = 'later'
  notifier.exited('s1')
  notifier.exited('s2')
  await tick()
  assert.equal(delivered.length, 0)
  master.can = 'yes'
  notifier.retry('m1')
  await tick()
  assert.equal(delivered.length, 1)
  assert.equal(delivered[0].text.split('\n').length, 2)
})

test('a master that is gone or done drops its news for good', async () => {
  const { notifier, delivered, master } = setup()
  master.can = 'never'
  notifier.exited('s1')
  await tick()
  master.can = 'yes'
  notifier.retry('m1')
  await tick()
  assert.equal(delivered.length, 0)
})

test('a card without a master is never reported', async () => {
  const { notifier, delivered } = setup()
  notifier.activity('x1', working)
  notifier.activity('x1', idle)
  notifier.exited('x1')
  await tick()
  assert.equal(delivered.length, 0)
})
