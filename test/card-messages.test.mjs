import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createNodePlatform, setPlatform } from '../packages/core/src/platform.ts'
import {
  deleteMessagesFor,
  listCardMessages,
  readPatches,
  recordCardMessage,
  summarizeThreads,
  threadMessages,
  unreadMessagesTo,
  updateCardMessages,
} from '../packages/core/src/card-messages.ts'
import { inboxHas, postMessage, takeMessages } from '../packages/core/src/inbox.ts'

function useTempStore(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-messages-'))
  setPlatform(createNodePlatform({ userDataDir: dir }))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

const master = { kind: 'task', id: 'm1', title: 'Master' }

test('messages are kept in their own file and survive a reload', (t) => {
  const dir = useTempStore(t)
  recordCardMessage({ thread: { from: 'm1', to: 'c1' }, sender: master, to: 'c1', text: 'hi' })
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'vibeflow-messages.json'), 'utf8'))
  assert.equal(onDisk.version, 1)
  assert.equal(onDisk.messages[0].text, 'hi')
  assert.equal(onDisk.messages[0].state, 'unread')
  assert.equal(fs.existsSync(path.join(dir, 'vibeflow-state.json')), false)
})

test('a thread is one source and one recipient, the person writing inside it included', (t) => {
  useTempStore(t)
  recordCardMessage({ thread: { from: 'm1', to: 'c1' }, sender: master, to: 'c1', text: 'a', sentAt: 1 })
  recordCardMessage({ thread: { from: 'm1', to: 'c1' }, sender: { kind: 'person' }, to: 'c1', text: 'b', sentAt: 2 })
  recordCardMessage({ thread: { from: 'm1', to: 'c2' }, sender: master, to: 'c2', text: 'c', sentAt: 3 })
  assert.deepEqual(threadMessages('m1', 'c1').map((m) => m.text), ['a', 'b'])
  const summaries = summarizeThreads(listCardMessages(), (id) => ({ m1: 'Master', c1: 'Card 1' })[id])
  assert.equal(summaries.length, 2)
  const one = summaries.find((s) => s.to === 'c1')
  assert.equal(one.unread, 2)
  assert.equal(one.fromTitle, 'Master')
  assert.equal(one.toTitle, 'Card 1')
  assert.equal(one.last.text, 'b')
  assert.equal(summaries[0].to, 'c2', 'the newest thread comes first')
})

test('a message is read once its inbox file is gone; the host says which it typed', (t) => {
  useTempStore(t)
  const inbox = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vf-inbox-')), '.vibeflow-inbox')
  t.after(() => fs.rmSync(path.dirname(inbox), { recursive: true, force: true }))
  const a = postMessage(inbox, 'a')
  const b = postMessage(inbox, 'b')
  const c = postMessage(inbox, 'c')
  for (const name of [a, b, c]) {
    recordCardMessage({ thread: { from: 'm1', to: 'c1' }, sender: master, to: 'c1', text: name, inboxName: name })
  }
  assert.deepEqual(takeMessages(inbox, b).map((m) => m.name), [a, b], 'upTo stops at the given message')
  fs.renameSync(path.join(inbox, c), path.join(inbox, `.hook-${c}`))
  assert.equal(inboxHas(inbox, c), true, 'a message a hook is mid-way through reading is not read yet')

  const patches = readPatches(unreadMessagesTo('c1'), (n) => inboxHas(inbox, n), new Set([a]), 5)
  updateCardMessages(patches)
  const [ma, mb, mc] = threadMessages('m1', 'c1')
  assert.deepEqual([ma.state, ma.via, ma.readAt], ['read', 'typed', 5])
  assert.deepEqual([mb.state, mb.via], ['read', 'hook'])
  assert.equal(mc.state, 'unread')
})

test('deleting a card drops every thread it is part of', (t) => {
  useTempStore(t)
  recordCardMessage({ thread: { from: 'm1', to: 'c1' }, sender: master, to: 'c1', text: 'a' })
  recordCardMessage({ thread: { from: 'c1', to: 'm1' }, sender: { kind: 'task', id: 'c1', title: 'C' }, to: 'm1', text: 'b' })
  recordCardMessage({ thread: { from: 'm1', to: 'c2' }, sender: master, to: 'c2', text: 'c' })
  assert.deepEqual(deleteMessagesFor('c1').sort(), ['c1', 'm1'])
  assert.deepEqual(listCardMessages().map((m) => m.text), ['c'])
  assert.deepEqual(deleteMessagesFor('nope'), [])
})
