import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

// The user's own Codex home, as the host process sees it. Set before any core
// module builds its (memoized) exec environment.
const USER_CODEX_HOME = path.join(os.tmpdir(), 'vf-user-codex-home')
process.env.CODEX_HOME = USER_CODEX_HOME

const { createModelCatalog, parseCodexCatalog } = await import('../packages/core/src/agent-models.ts')
const { AGENT_CLIS } = await import('../packages/core/src/agents.ts')
const { fetchClaudeModels, parseClaudeInitialize } = await import('../packages/core/src/claude-models.ts')
const {
  CodexLoginRequiredError,
  codexAppServerCommand,
  fetchCodexModels,
  parseCodexModelPage,
} = await import('../packages/core/src/codex-models.ts')
const { spawnJsonLines } = await import('../packages/core/src/json-lines-process.ts')
const { getStoreAtPath } = await import('../packages/core/src/store.ts')

const fixture = (name) => new URL(`./fixtures/agent-models/${name}`, import.meta.url)
const claudeInitialize = JSON.parse(fs.readFileSync(fixture('claude-initialize.jsonl'), 'utf8'))
const codexPages = JSON.parse(fs.readFileSync(fixture('codex-model-list.json'), 'utf8')).pages
const codexAccount = JSON.parse(fs.readFileSync(fixture('codex-account.json'), 'utf8'))

const builtin = (id) => AGENT_CLIS.find((a) => a.id === id).models

function codexHome(t, contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-codex-home-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))
  if (contents !== undefined) fs.writeFileSync(path.join(dir, 'models_cache.json'), contents)
  return dir
}

const codexCache = JSON.stringify({
  fetched_at: '2026-10-02T00:00:00Z',
  models: [
    { slug: 'gpt-6-astra', display_name: 'GPT-6-Astra', visibility: 'list' },
    { slug: 'gpt-reserve', display_name: 'Reserve', visibility: 'hide' },
    { slug: 'gpt-5.5', visibility: 'list' },
    { slug: 'gpt-5.5', visibility: 'list' },
  ],
})

/**
 * In-memory stand-in for a CLI process. `respond(message)` returns the
 * messages the "CLI" answers with; they arrive asynchronously, like real I/O.
 */
function fakeChannel(respond) {
  const sent = []
  const inbox = []
  const waiters = []
  const state = { closed: false }
  const deliver = (message) => {
    const i = waiters.findIndex((w) => w.match(message))
    if (i === -1) inbox.push(message)
    else waiters.splice(i, 1)[0].resolve(message)
  }
  const channel = {
    send(message) {
      sent.push(message)
      for (const reply of respond(message) ?? []) setTimeout(() => deliver(reply), 1)
    },
    next(match) {
      const i = inbox.findIndex(match)
      if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0])
      if (state.closed) return Promise.reject(new Error('closed'))
      return new Promise((resolve, reject) => waiters.push({ match, resolve, reject }))
    },
    close() {
      state.closed = true
      for (const w of waiters.splice(0)) w.reject(new Error('closed'))
    },
  }
  return { sent, state, open: () => channel }
}

/** A Claude CLI that answers the handshake from the captured fixture. */
const claudeResponder = (message) =>
  message.type === 'control_request'
    ? [{ ...claudeInitialize, response: { ...claudeInitialize.response, request_id: message.request_id } }]
    : []

/** A signed-in codex app-server serving the captured catalog over two pages. */
function codexResponder({ account = codexAccount.signedIn } = {}) {
  return (message) => {
    if (message.method === 'initialize') return [{ id: message.id, result: { userAgent: 'codex' } }]
    if (message.method === 'account/read') return [{ id: message.id, result: account }]
    if (message.method === 'model/list') {
      const page = message.params.cursor === 'page-2' ? codexPages[1] : codexPages[0]
      return [{ id: message.id, result: page }]
    }
    return []
  }
}

// ── Claude handshake ─────────────────────────────────────────────────────────

test('claude: the handshake lists the account\'s models without the default entry', async () => {
  const fake = fakeChannel(claudeResponder)
  const models = await fetchClaudeModels(fake.open)
  assert.deepEqual(fake.sent.map((m) => m.request?.subtype), ['initialize'])
  assert.ok(fake.state.closed, 'the CLI must be closed after it answered')
  const ids = models.map((m) => m.id)
  assert.ok(ids.includes('fable'))
  assert.ok(!ids.includes('default'))
  assert.equal(models.find((m) => m.id === 'opus').label, 'Opus 5.5')
})

test('claude: effort levels come from the catalog; a model without effort support takes none', () => {
  const models = parseClaudeInitialize(claudeInitialize)
  assert.deepEqual(models.find((m) => m.id === 'claude-opus-4-6').efforts, ['low', 'medium', 'high', 'max'])
  assert.deepEqual(models.find((m) => m.id === 'haiku').efforts, [])
  assert.deepEqual(models.find((m) => m.id === 'opus').efforts, ['low', 'medium', 'high', 'xhigh', 'max'])
})

test('claude: account details in the handshake never reach the result', () => {
  const output = JSON.stringify(parseClaudeInitialize(claudeInitialize))
  assert.ok(!output.includes('someone@example.com'))
  assert.ok(!output.includes('Example Org'))
  for (const model of parseClaudeInitialize(claudeInitialize)) {
    assert.deepEqual(Object.keys(model).filter((k) => !['id', 'label', 'description', 'efforts', 'isDefault'].includes(k)), [])
  }
})

test('claude: the model the default entry resolves to is marked as the default', () => {
  const models = parseClaudeInitialize(claudeInitialize)
  assert.deepEqual(models.filter((m) => m.isDefault).map((m) => m.id), ['opus'])
})

test('claude: no default entry, no default marked', () => {
  const models = parseClaudeInitialize({ response: { response: { models: [{ value: 'opus', resolvedModel: 'claude-opus-5-5' }] } } })
  assert.equal(models[0].isDefault, undefined)
})

test('claude: an unexpected handshake shape is rejected', () => {
  for (const message of [{}, { response: { response: { models: 'nope' } } }, { response: { response: { models: [{ value: 'default' }] } } }]) {
    assert.throws(() => parseClaudeInitialize(message))
  }
})

test('claude: unknown effort levels are dropped', () => {
  const models = parseClaudeInitialize({
    response: { response: { models: [{ value: 'x', supportsEffort: true, supportedEffortLevels: ['low', 'minimal', 'max'] }] } },
  })
  assert.deepEqual(models[0].efforts, ['low', 'max'])
})

// ── codex app-server ─────────────────────────────────────────────────────────

test('codex: nothing but initialize is sent before initialize succeeds', async () => {
  let initialized = false
  const order = []
  const fake = fakeChannel((message) => {
    order.push({ method: message.method, afterInit: initialized })
    if (message.method === 'initialize') {
      setTimeout(() => { initialized = true }, 0)
    }
    return codexResponder()(message)
  })
  await fetchCodexModels('1.2.3', fake.open)
  assert.deepEqual(order[0], { method: 'initialize', afterInit: false })
  assert.ok(order.slice(1).every((o) => o.afterInit), JSON.stringify(order))
  assert.deepEqual(order.map((o) => o.method), ['initialize', 'initialized', 'account/read', 'model/list', 'model/list'])
  assert.equal(fake.sent[0].params.clientInfo.version, '1.2.3')
})

test('codex: model/list is paged until nextCursor is null', async () => {
  const fake = fakeChannel(codexResponder())
  const models = await fetchCodexModels('1.0.0', fake.open)
  const lists = fake.sent.filter((m) => m.method === 'model/list')
  assert.equal(lists[0].params.cursor, undefined)
  assert.equal(lists[1].params.cursor, 'page-2')
  assert.equal(lists[0].params.includeHidden, false)
  assert.deepEqual(models.map((m) => m.id), ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'])
  assert.ok(fake.state.closed)
})

test('codex: reasoning efforts map onto the shared levels, ultra included', async () => {
  const models = await fetchCodexModels('1.0.0', fakeChannel(codexResponder()).open)
  assert.deepEqual(models[0].efforts, ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'])
  assert.deepEqual(models.find((m) => m.id === 'gpt-5.6-luna').efforts, ['low', 'medium', 'high', 'xhigh', 'max'])
  assert.equal(models[0].label, 'GPT-6-Astra')
})

test('codex: the catalog\'s default model is marked', async () => {
  const models = await fetchCodexModels('1.0.0', fakeChannel(codexResponder()).open)
  assert.deepEqual(models.filter((m) => m.isDefault).map((m) => m.id), ['gpt-6-astra'])
})

test('catalog: findModel without a model id is the CLI\'s default', async (t) => {
  const catalog = createModelCatalog({
    version: '1.0.0',
    codexHome: codexHome(t),
    fetchClaude: neverCalled('claude'),
    fetchCodex: () => fetchCodexModels('1.0.0', fakeChannel(codexResponder()).open),
  })
  await catalog.refresh('codex')
  assert.equal(catalog.findModel('codex', undefined).id, 'gpt-6-astra')
  assert.equal(catalog.findModel('codex', 'gpt-5.6-luna').id, 'gpt-5.6-luna')
})

test('codex: a signed-out CLI is reported as such and its catalog is not used', async () => {
  const fake = fakeChannel(codexResponder({ account: codexAccount.signedOut }))
  await assert.rejects(fetchCodexModels('1.0.0', fake.open), CodexLoginRequiredError)
  assert.ok(!fake.sent.some((m) => m.method === 'model/list'))
  assert.ok(fake.state.closed)
})

test('codex: account details never reach the result', async () => {
  const models = await fetchCodexModels('1.0.0', fakeChannel(codexResponder()).open)
  assert.ok(!JSON.stringify(models).includes('someone@example.com'))
})

test('codex: an initialize error stops the exchange', async () => {
  const fake = fakeChannel((m) => (m.method === 'initialize' ? [{ id: m.id, error: { code: -1, message: 'nope' } }] : []))
  await assert.rejects(fetchCodexModels('1.0.0', fake.open), /initialize: nope/)
  assert.deepEqual(fake.sent.map((m) => m.method), ['initialize'])
})

test('codex: hidden entries and entries without an id are skipped', () => {
  const { models, nextCursor } = parseCodexModelPage({
    data: [null, { id: ' ' }, { id: 'shown', displayName: 'Shown' }, { id: 'secret', hidden: true }],
    nextCursor: null,
  })
  assert.deepEqual(models, [{ id: 'shown', label: 'Shown' }])
  assert.equal(nextCursor, null)
})

test('codex: app-server runs with the user\'s own CODEX_HOME, not the library\'s', () => {
  const command = codexAppServerCommand()
  assert.equal(command.env.CODEX_HOME, USER_CODEX_HOME)
  assert.deepEqual(command.args, ['app-server', '--listen', 'stdio://'])
})

// ── child process lifecycle ──────────────────────────────────────────────────

function nodeScript(t, source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-json-lines-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))
  const file = path.join(dir, 'cli.cjs')
  fs.writeFileSync(file, source)
  return { dir, file }
}

// The harness hands its TS loader to children through NODE_OPTIONS; these
// stand-in CLIs are plain CommonJS and must not inherit it.
const plainEnv = { ...process.env, NODE_OPTIONS: '' }

function exitWatcher() {
  let resolve
  const exited = new Promise((r) => { resolve = r })
  return { exited, onExit: () => resolve() }
}

test('process: a real CLI answering the handshake is closed afterwards', async (t) => {
  const { dir, file } = nodeScript(t, `
    const fixture = ${JSON.stringify(claudeInitialize)}
    require('readline').createInterface({ input: process.stdin }).on('line', (line) => {
      const m = JSON.parse(line)
      console.log('not json — a banner')
      console.log(JSON.stringify({ ...fixture, response: { ...fixture.response, request_id: m.request_id } }))
    })
  `)
  const watch = exitWatcher()
  const open = () => spawnJsonLines(process.execPath, [file], { cwd: dir, env: plainEnv, timeoutMs: 10_000, onExit: watch.onExit })
  const models = await fetchClaudeModels(open)
  assert.ok(models.some((m) => m.id === 'fable'))
  await watch.exited
})

test('process: a CLI that never answers is killed at the timeout', async (t) => {
  const { dir, file } = nodeScript(t, 'process.stdin.resume(); setInterval(() => {}, 1000)')
  const watch = exitWatcher()
  const open = () => spawnJsonLines(process.execPath, [file], { cwd: dir, env: plainEnv, timeoutMs: 200, onExit: watch.onExit })
  await assert.rejects(fetchClaudeModels(open), /did not answer within 200ms/)
  await watch.exited
})

test('process: a CLI that ignores a closed stdin is killed after the grace period', async (t) => {
  const { dir, file } = nodeScript(t, `
    process.stdin.on('end', () => {})
    require('readline').createInterface({ input: process.stdin }).on('line', (line) => {
      const m = JSON.parse(line)
      const fixture = ${JSON.stringify(claudeInitialize)}
      console.log(JSON.stringify({ ...fixture, response: { ...fixture.response, request_id: m.request_id } }))
    })
    setInterval(() => {}, 1000)
  `)
  const watch = exitWatcher()
  const open = () => spawnJsonLines(process.execPath, [file], { cwd: dir, env: plainEnv, timeoutMs: 10_000, exitGraceMs: 100, onExit: watch.onExit })
  await fetchClaudeModels(open)
  await watch.exited
})

test('process: a missing binary fails without hanging', async (t) => {
  const watch = exitWatcher()
  const open = () => spawnJsonLines('vibeflow-no-such-cli', [], { cwd: os.tmpdir(), timeoutMs: 10_000, onExit: watch.onExit })
  await assert.rejects(fetchClaudeModels(open))
  await watch.exited
})

// ── catalog ──────────────────────────────────────────────────────────────────

const neverCalled = (name) => () => assert.fail(`${name} must not be asked`)

test('catalog: get() never asks a CLI', async (t) => {
  const catalog = createModelCatalog({
    version: '1.0.0',
    codexHome: codexHome(t),
    fetchClaude: neverCalled('claude'),
    fetchCodex: neverCalled('codex'),
  })
  assert.deepEqual(await catalog.get('claude'), { models: builtin('claude'), source: 'builtin' })
  assert.deepEqual(await catalog.get('codex'), { models: builtin('codex'), source: 'builtin' })
})

test('catalog: warm() asks each CLI once and get() serves the answers', async (t) => {
  const calls = { claude: 0, codex: 0 }
  const catalog = createModelCatalog({
    version: '1.0.0',
    codexHome: codexHome(t),
    fetchClaude: async () => { calls.claude++; return parseClaudeInitialize(claudeInitialize) },
    fetchCodex: async () => { calls.codex++; return fetchCodexModels('1.0.0', fakeChannel(codexResponder()).open) },
  })
  catalog.warm()
  const pending = await catalog.get('claude')
  assert.equal(pending.pending, true)
  assert.equal(pending.source, 'builtin')

  const claude = await catalog.refresh('claude')
  const codex = await catalog.refresh('codex')
  assert.deepEqual(calls, { claude: 1, codex: 1 }, 'a refresh joins the warm-up already running')
  assert.equal(claude.source, 'claude-cli')
  assert.equal(codex.source, 'codex-app-server')
  assert.deepEqual(await catalog.get('claude'), claude)
  assert.deepEqual(catalog.findModel('claude', 'haiku').efforts, [])
})

test('catalog: findModel knows nothing until a CLI answered', async (t) => {
  const catalog = createModelCatalog({ version: '1.0.0', codexHome: codexHome(t), fetchClaude: neverCalled('claude'), fetchCodex: neverCalled('codex') })
  assert.equal(catalog.findModel('claude', 'opus'), undefined)
})

test('catalog: a failing claude falls back to the builtin aliases and says why', async (t) => {
  const catalog = createModelCatalog({
    version: '1.0.0',
    codexHome: codexHome(t),
    fetchClaude: async () => { throw new Error('claude: command not found') },
    fetchCodex: neverCalled('codex'),
  })
  assert.deepEqual(await catalog.refresh('claude'), {
    models: builtin('claude'),
    source: 'builtin',
    error: 'claude: command not found',
  })
})

test('catalog: a failing codex falls back to its model cache, then to the builtin list', async (t) => {
  const failing = async () => { throw new Error('codex: command not found') }
  const withCache = createModelCatalog({ version: '1.0.0', codexHome: codexHome(t, codexCache), fetchClaude: neverCalled('claude'), fetchCodex: failing })
  const cached = await withCache.refresh('codex')
  assert.equal(cached.source, 'codex-cache')
  assert.deepEqual(cached.models.map((m) => m.id), ['gpt-6-astra', 'gpt-5.5'])
  assert.equal(cached.error, 'codex: command not found')

  const without = createModelCatalog({ version: '1.0.0', codexHome: codexHome(t), fetchClaude: neverCalled('claude'), fetchCodex: failing })
  assert.deepEqual(await without.refresh('codex'), { models: builtin('codex'), source: 'builtin', error: 'codex: command not found' })
})

test('catalog: a signed-out codex is flagged for a login hint', async (t) => {
  const catalog = createModelCatalog({
    version: '1.0.0',
    codexHome: codexHome(t),
    fetchClaude: neverCalled('claude'),
    fetchCodex: () => fetchCodexModels('1.0.0', fakeChannel(codexResponder({ account: codexAccount.signedOut })).open),
  })
  const list = await catalog.refresh('codex')
  assert.equal(list.loginRequired, true)
  assert.equal(list.source, 'builtin')
  assert.match(list.error, /codex login/)
})

test('catalog: an unreadable codex cache falls back to the builtin list and says why', async (t) => {
  for (const contents of ['not json', '{"models": "nope"}', '{"models": [{"slug": "x", "visibility": "hide"}]}']) {
    const catalog = createModelCatalog({ version: '1.0.0', codexHome: codexHome(t, contents), fetchClaude: neverCalled('claude'), fetchCodex: neverCalled('codex') })
    const list = await catalog.get('codex')
    assert.equal(list.source, 'builtin')
    assert.deepEqual(list.models, builtin('codex'))
    assert.ok(list.error, `expected an error for ${contents}`)
  }
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
