import test from 'node:test'
import assert from 'node:assert/strict'
import { createNotifier } from '../packages/core/src/notifier.ts'

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

test('a card that fails to start reaches its master, again if it fails again', async () => {
  const { notifier, delivered } = setup()
  notifier.launchFailed('s1', 'no such branch')
  await tick()
  notifier.launchFailed('s1', 'still no branch')
  await tick()
  assert.equal(delivered.length, 2)
  assert.ok(delivered[0].text.includes('s1') && delivered[0].text.includes('no such branch'))
  assert.ok(delivered.every((d) => d.masterId === 'm1'))
})

test('all cards Done is told once for the same set of cards', async () => {
  const { notifier, delivered } = setup()
  notifier.allDone('m1', ['s1', 's2'])
  notifier.allDone('m1', ['s2', 's1'])
  await tick()
  assert.equal(delivered.length, 1)
  assert.ok(delivered[0].text.includes('都已完成'))
  notifier.allDone('m1', ['s1', 's2', 's3'])
  await tick()
  assert.equal(delivered.length, 2, 'a card added later makes a new set')
  notifier.allDone('m1', [])
  await tick()
  assert.equal(delivered.length, 2)
})

test('news waits while the master cannot take it, then arrives as one message', async () => {
  const { notifier, delivered, master } = setup()
  master.can = 'later'
  notifier.launchFailed('s1', 'a')
  notifier.launchFailed('s2', 'b')
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
  notifier.launchFailed('s1', 'a')
  await tick()
  master.can = 'yes'
  notifier.retry('m1')
  await tick()
  assert.equal(delivered.length, 0)
})

test('a card without a master is never reported', async () => {
  const { notifier, delivered } = setup()
  notifier.launchFailed('x1', 'a')
  await tick()
  assert.equal(delivered.length, 0)
})
