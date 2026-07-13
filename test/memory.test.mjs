import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import readline from 'node:readline'
import {
  getCheckpointsFromDb,
  getRelatedTasksFromDb,
  getTaskLinksFromDb,
} from '../main/helpers/memory.ts'

const SERVER = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'main',
  'memory',
  'mcp-server.mjs'
)

/** Minimal stdio JSON-RPC client that drives the memory MCP server. */
function startServer(dbPath) {
  const child = spawn('node', [SERVER, '--db', dbPath])
  const rl = readline.createInterface({ input: child.stdout })
  const pending = new Map()
  rl.on('line', (line) => {
    const t = line.trim()
    if (!t) return
    const msg = JSON.parse(t)
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  })
  let nextId = 1
  function request(method, params) {
    const id = nextId++
    return new Promise((resolve) => {
      pending.set(id, resolve)
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  }
  function notify(method, params) {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
  }
  return { request, notify, stop: () => child.kill() }
}

/** tools/call → parse the JSON body out of the text content. */
async function call(srv, name, args) {
  const res = await srv.request('tools/call', { name, arguments: args })
  assert.ok(!res.result?.isError, `tool ${name} errored: ${res.result?.content?.[0]?.text}`)
  return JSON.parse(res.result.content[0].text)
}

test('memory MCP server — handshake + save→find→detail→artifact→link round-trip', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-mem-'))
  const dbPath = path.join(dir, 'agent_memory.db')
  const srv = startServer(dbPath)
  t.after(async () => {
    srv.stop()
    await fs.rm(dir, { recursive: true, force: true })
  })

  // initialize — server echoes the client protocolVersion.
  const init = await srv.request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '0' },
  })
  assert.equal(init.result.protocolVersion, '2025-06-18')
  assert.equal(init.result.serverInfo.name, 'agent_memory')
  srv.notify('notifications/initialized', {})

  // tools/list — all five memory tools present.
  const list = await srv.request('tools/list', {})
  const names = list.result.tools.map((x) => x.name).sort()
  assert.deepEqual(names, [
    'memory_find_related_tasks',
    'memory_get_artifact',
    'memory_get_task_detail',
    'memory_link_tasks',
    'memory_save_checkpoint',
  ])

  // save_checkpoint — lazily creates the db, returns seq 1.
  const saved = await call(srv, 'memory_save_checkpoint', {
    task_id: 'feature/built-in-agent-memory',
    title: 'Built-in agent memory',
    summary: 'Wiring the MCP server into VibeFlow',
    outcome: 'Phase 2 server scaffolded',
    decisions: [{ choice: 'sqlite3 CLI', reason: 'no native dep' }],
    open_items: ['wire launch command'],
    artifacts: [{ description: 'design note', content: 'the full design body' }],
    tags: ['memory', 'mcp'],
  })
  assert.equal(saved.seq, 1)
  assert.equal(saved.compressed, false)
  assert.match(saved.checkpoint_id, /^cp-/)

  // a second checkpoint increments seq.
  const saved2 = await call(srv, 'memory_save_checkpoint', {
    task_id: 'feature/built-in-agent-memory',
    title: 'Built-in agent memory',
    summary: 'Phase 2 in progress',
    outcome: 'server tested',
  })
  assert.equal(saved2.seq, 2)

  // find_related_tasks — FTS surfaces the task by summary text.
  const found = await call(srv, 'memory_find_related_tasks', { query: 'agent memory MCP' })
  assert.equal(found.results.length, 1)
  assert.equal(found.results[0].id, 'feature/built-in-agent-memory')
  assert.deepEqual(found.results[0].tags.sort(), ['mcp', 'memory'])

  // find by tag overlap only.
  const byTag = await call(srv, 'memory_find_related_tasks', { tags: ['mcp'] })
  assert.equal(byTag.results.length, 1)

  // get_task_detail — checkpoints + artifact pointers, no artifact bodies.
  const detail = await call(srv, 'memory_get_task_detail', {
    task_id: 'feature/built-in-agent-memory',
  })
  assert.equal(detail.checkpoints.length, 2)
  assert.deepEqual(detail.checkpoints[0].decisions, [
    { choice: 'sqlite3 CLI', reason: 'no native dep' },
  ])
  assert.deepEqual(detail.checkpoints[0].open_items, ['wire launch command'])
  const artPointer = detail.checkpoints[0].artifacts[0]
  assert.equal(artPointer.description, 'design note')
  assert.equal(artPointer.content, undefined) // pointer only

  // get_artifact — the only path that returns the heavy body.
  const art = await call(srv, 'memory_get_artifact', { artifact_id: artPointer.id })
  assert.equal(art.content, 'the full design body')

  // link_tasks — save the other side first (FK), then link + read back.
  await call(srv, 'memory_save_checkpoint', {
    task_id: 'feature/plan',
    title: 'Plan feature',
    summary: 'earlier agent memory done-panel work',
    outcome: 'done',
  })
  const linked = await call(srv, 'memory_link_tasks', {
    from_task: 'feature/built-in-agent-memory',
    to_task: 'feature/plan',
    relation: 'derived_from',
    note: 'extends the done-panel memory work',
  })
  assert.equal(linked.relation, 'derived_from')
  const detail2 = await call(srv, 'memory_get_task_detail', {
    task_id: 'feature/built-in-agent-memory',
  })
  assert.deepEqual(detail2.links, [
    { to_task: 'feature/plan', relation: 'derived_from', note: 'extends the done-panel memory work' },
  ])

  // unknown task / artifact degrade to error objects, not crashes.
  const missing = await call(srv, 'memory_get_task_detail', { task_id: 'nope' })
  assert.match(missing.error, /no task/)

  // The app's read-side helpers (memory.ts *FromDb variants) read the same
  // store the server just wrote.
  const cps = await getCheckpointsFromDb(dbPath, 'feature/built-in-agent-memory')
  assert.equal(cps.length, 2)
  assert.equal(cps[0].seq, 1)
  assert.equal(cps[0].artifacts[0].description, 'design note')

  // getRelatedTasks: seeded from this task's own title/summary, excludes self,
  // surfaces the other task (shared "memory" vocabulary via FTS).
  const rel = await getRelatedTasksFromDb(dbPath, 'feature/built-in-agent-memory')
  assert.ok(rel.every((r) => r.id !== 'feature/built-in-agent-memory'))
  assert.ok(rel.some((r) => r.id === 'feature/plan'))

  // getTaskLinks: outgoing edge from this task, neighbour title resolved.
  const outLinks = await getTaskLinksFromDb(dbPath, 'feature/built-in-agent-memory')
  assert.deepEqual(outLinks, [
    {
      otherId: 'feature/plan',
      otherTitle: 'Plan feature',
      relation: 'derived_from',
      note: 'extends the done-panel memory work',
      direction: 'outgoing',
    },
  ])
  // and the incoming view from the other side.
  const inLinks = await getTaskLinksFromDb(dbPath, 'feature/plan')
  assert.equal(inLinks.length, 1)
  assert.equal(inLinks[0].direction, 'incoming')
  assert.equal(inLinks[0].otherId, 'feature/built-in-agent-memory')
})
