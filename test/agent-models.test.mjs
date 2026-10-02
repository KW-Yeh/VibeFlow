import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { listAgentModels, parseCodexCatalog } from '../packages/core/src/agent-models.ts'
import { AGENT_CLIS } from '../packages/core/src/agents.ts'
import { getStoreAtPath } from '../packages/core/src/store.ts'

const builtin = (id) => AGENT_CLIS.find((a) => a.id === id).models

function codexHome(t, contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-codex-home-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  if (contents !== undefined) fs.writeFileSync(path.join(dir, 'models_cache.json'), contents)
  return dir
}

const catalog = JSON.stringify({
  fetched_at: '2026-10-02T00:00:00Z',
  models: [
    { slug: 'gpt-6-astra', display_name: 'GPT-6-Astra', visibility: 'list' },
    { slug: 'gpt-reserve', display_name: 'Reserve', visibility: 'hide' },
    { slug: 'gpt-5.5', visibility: 'list' },
    { slug: 'gpt-5.5', visibility: 'list' },
  ],
})

test('claude always offers its builtin aliases, even when asked to refresh', async () => {
  const runCodexModels = () => assert.fail('claude must not spawn codex')
  assert.deepEqual(await listAgentModels('claude', { refresh: true, runCodexModels }), {
    models: builtin('claude'),
    source: 'builtin',
  })
})

test('codex reads its own model cache, dropping hidden and duplicate entries', async (t) => {
  const list = await listAgentModels('codex', { codexHome: codexHome(t, catalog) })
  assert.equal(list.source, 'codex-cache')
  assert.deepEqual(list.models, [
    { id: 'gpt-6-astra', label: 'GPT-6-Astra' },
    { id: 'gpt-5.5', label: 'gpt-5.5' },
  ])
})

test('a missing codex cache falls back to the builtin list without an error', async (t) => {
  const list = await listAgentModels('codex', { codexHome: codexHome(t) })
  assert.deepEqual(list, { models: builtin('codex'), source: 'builtin' })
})

test('an unreadable codex cache falls back to the builtin list and says why', async (t) => {
  for (const contents of ['not json', '{"models": "nope"}', '{"models": [{"slug": "x", "visibility": "hide"}]}']) {
    const list = await listAgentModels('codex', { codexHome: codexHome(t, contents) })
    assert.equal(list.source, 'builtin')
    assert.deepEqual(list.models, builtin('codex'))
    assert.ok(list.error, `expected an error for ${contents}`)
  }
})

test('refresh asks the codex CLI instead of reading the cache', async (t) => {
  const list = await listAgentModels('codex', {
    refresh: true,
    codexHome: codexHome(t, JSON.stringify({ models: [{ slug: 'stale' }] })),
    runCodexModels: async () => catalog,
  })
  assert.equal(list.source, 'codex-cli')
  assert.deepEqual(list.models.map((m) => m.id), ['gpt-6-astra', 'gpt-5.5'])
})

test('a failing codex CLI falls back to the builtin list and says why', async () => {
  const list = await listAgentModels('codex', {
    refresh: true,
    runCodexModels: async () => {
      throw new Error('codex: command not found')
    },
  })
  assert.deepEqual(list, { models: builtin('codex'), source: 'builtin', error: 'codex: command not found' })
})

test('parseCodexCatalog skips entries without a usable slug', () => {
  const models = parseCodexCatalog(JSON.stringify({ models: [null, { slug: '  ' }, { slug: 7 }, { slug: ' ok ' }] }))
  assert.deepEqual(models, [{ id: 'ok', label: 'ok' }])
})

test('stored provider API keys are removed when the store is opened', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-store-keys-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'vibeflow-state.json')
  fs.writeFileSync(file, JSON.stringify({
    version: 4,
    projectPath: null,
    board: { backlog: [], in_progress: [], done: [] },
    recentProjects: [],
    settings: {
      autoMode: true,
      systemPrompt: 'keep me',
      agentConnections: { claude: { connected: true, apiKey: 'sk-ant-secret', models: ['x'] } },
    },
  }))

  const store = getStoreAtPath(dir)
  assert.deepEqual(store.get('settings'), { autoMode: true, systemPrompt: 'keep me' })
  assert.equal(fs.readFileSync(file, 'utf8').includes('sk-ant-secret'), false)
})
