import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { JsonStore } from '../packages/core/src/json-store.ts'
import { getStoreAtPath } from '../packages/core/src/store.ts'
import { createNodePlatform, setPlatform } from '../packages/core/src/platform.ts'
import {
  appendMessage,
  clearConversation,
  loadConversation,
} from '../packages/core/src/chat-store.ts'

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vf-json-store-'))
}

test('reads a state file written by electron-store as-is', () => {
  const dir = tempDir()
  // Tab-indented and nested, exactly as conf serialised it.
  const legacy = {
    version: 4,
    projectPath: null,
    board: { backlog: [{ id: 'abc12345', title: 'Old card', branch: 'vf-abc12345' }], in_progress: [], done: [] },
    settings: { autoMode: false },
    recentProjects: [],
  }
  fs.writeFileSync(path.join(dir, 'vibeflow-state.json'), JSON.stringify(legacy, null, '\t'))

  const store = getStoreAtPath(dir)
  assert.equal(store.get('board').backlog[0].title, 'Old card')
  assert.equal(store.get('settings').autoMode, false)
  assert.equal(store.path, path.join(dir, 'vibeflow-state.json'))
})

test('missing defaults are persisted at construction; present keys are kept', () => {
  const dir = tempDir()
  fs.writeFileSync(path.join(dir, 's.json'), JSON.stringify({ a: 'mine' }))
  new JsonStore({ name: 's', cwd: dir, defaults: { a: 'default', b: 2 } })
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 's.json'), 'utf8')), { a: 'mine', b: 2 })
})

test('get falls back to the given default only when the key is absent', () => {
  const store = new JsonStore({ name: 's', cwd: tempDir(), defaults: {} })
  assert.equal(store.get('x', 5), 5)
  store.set('x', 0)
  assert.equal(store.get('x', 5), 0)
})

test('has / delete work on top-level keys', () => {
  const store = new JsonStore({ name: 's', cwd: tempDir(), defaults: {} })
  assert.equal(store.has('k'), false)
  store.set('k', 'v')
  assert.equal(store.has('k'), true)
  store.delete('k')
  assert.equal(store.has('k'), false)
})

test('every read goes to disk, so another writer (the CLI) is seen', () => {
  const dir = tempDir()
  const app = new JsonStore({ name: 's', cwd: dir, defaults: { n: 0 } })
  const cli = new JsonStore({ name: 's', cwd: dir, defaults: { n: 0 } })
  cli.set('n', 7)
  assert.equal(app.get('n'), 7)
})

test('a write leaves no temp file behind and creates the directory', () => {
  const dir = path.join(tempDir(), 'nested', 'profile')
  const store = new JsonStore({ name: 's', cwd: dir, defaults: {} })
  store.set('k', 1)
  assert.deepEqual(fs.readdirSync(dir), ['s.json'])
})

test('a corrupt file throws instead of reading as empty', () => {
  const dir = tempDir()
  fs.writeFileSync(path.join(dir, 's.json'), '{"board": ')
  assert.throws(() => new JsonStore({ name: 's', cwd: dir, defaults: {} }), SyntaxError)
  // The user's (corrupt) file must still be there to recover by hand.
  assert.equal(fs.readFileSync(path.join(dir, 's.json'), 'utf8'), '{"board": ')
})

test('chat-store round-trips through the platform userData dir', () => {
  const dir = tempDir()
  // Nested per-task keys, as electron-store's dot-path set() stored them.
  fs.writeFileSync(
    path.join(dir, 'vibeflow-chats.json'),
    JSON.stringify({ conversations: { old: { taskId: 'old', messages: [], updatedAt: 1 } } })
  )
  setPlatform(createNodePlatform({ userDataDir: dir }))

  assert.equal(loadConversation('old').updatedAt, 1)
  appendMessage('t1', { id: 'm1', role: 'user', text: 'hi', ts: 1 })
  assert.equal(loadConversation('t1').messages[0].text, 'hi')
  clearConversation('t1')
  assert.equal(loadConversation('t1'), null)
  assert.ok(loadConversation('old'), 'clearing one task keeps the others')
})
