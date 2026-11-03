import test from 'node:test'
import assert from 'node:assert/strict'
import { createJevRouter } from '../packages/core/src/jev-router.ts'

const task = {
  id: 'abc12345', title: 'Improve login', description: 'Implement refresh token rotation',
  agentCli: 'claude', model: 'opus', effort: 'auto',
}
const models = [
  { id: 'opus', label: 'Opus', efforts: ['low', 'medium', 'high', 'max'] },
  { id: 'haiku', label: 'Haiku', efforts: [] },
]

test('Jev chooses effort supported by the current model without choosing a model', async () => {
  const requests = []
  const router = createJevRouter({
    apiKey: 'test-key',
    async fetcher(_url, init) {
      requests.push(JSON.parse(init.body))
      return { ok: true, async json() { return { answers: { effort: { type: 'choice', choice: 'high' } } } } }
    },
  })
  assert.deepEqual(await router.route(task, models), { status: 'routed', effort: 'high' })
  assert.equal(requests.length, 1)
  assert.equal(requests[0].state.currentModel, 'opus')
  assert.deepEqual(Object.keys(requests[0].questions.effort.criteria), ['low', 'medium', 'high', 'max'])
  assert.equal(requests[0].questions.model, undefined)
})

const catalog = [
  { id: 'default', label: 'Default', efforts: ['low', 'medium', 'high'] },
  { id: 'sonnet', label: 'Sonnet', efforts: ['low', 'medium', 'high'] },
  { id: 'opus', label: 'Opus', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'haiku', label: 'Haiku', efforts: [] },
]
const open = { ...task, model: undefined }
const reply = (answers) => ({ ok: true, async json() { return { answers } } })
const choice = (value) => ({ type: 'choice', choice: value })

test('a card without a model gets a model and effort from one Jev request when the task is clear', async () => {
  const requests = []
  const phases = []
  const router = createJevRouter({
    apiKey: 'test-key',
    async fetcher(_url, init) {
      requests.push(JSON.parse(init.body))
      return reply({ complexity: choice('moderate'), model: choice('sonnet'), effort: choice('medium') })
    },
    scout: async () => { throw new Error('no scout for a clear task') },
  })
  const route = await router.route(open, catalog, { cwd: '/w', onPhase: (p) => phases.push(p) })
  assert.deepEqual(route, { status: 'routed', model: 'sonnet', effort: 'medium', complexity: 'moderate' })
  assert.equal(requests.length, 1)
  assert.deepEqual(Object.keys(requests[0].questions.model.criteria), ['haiku', 'sonnet', 'opus'], 'one model per tier, never the alias')
  assert.ok('unclear' in requests[0].questions.complexity.criteria)
  assert.deepEqual(Object.keys(requests[0].questions.effort.criteria), ['low', 'medium', 'high', 'xhigh', 'max'])
  assert.deepEqual(phases, ['judging'])
})

test('an unclear task is scouted by the strongest model, then Jev decides with the analysis', async () => {
  const requests = []
  const scouts = []
  const router = createJevRouter({
    apiKey: 'test-key',
    async fetcher(_url, init) {
      const body = JSON.parse(init.body)
      requests.push(body)
      return requests.length === 1
        ? reply({ complexity: choice('unclear'), model: choice('haiku'), effort: choice('low') })
        : reply({ complexity: choice('complex'), model: choice('opus'), effort: choice('xhigh') })
    },
    async scout(agent, model, effort, prompt, cwd) {
      scouts.push({ agent, model, effort, cwd })
      assert.match(prompt, /Do not edit/)
      return '  touches auth.ts and session.ts  '
    },
  })
  const phases = []
  const route = await router.route(open, catalog, { cwd: '/w', onPhase: (p) => phases.push(p) })
  assert.deepEqual(scouts, [{ agent: 'claude', model: 'opus', effort: 'high', cwd: '/w' }])
  assert.equal(requests.length, 2)
  assert.equal(requests[1].state.context, 'touches auth.ts and session.ts')
  assert.ok(!('unclear' in requests[1].questions.complexity.criteria))
  assert.deepEqual(route, {
    status: 'routed', model: 'opus', effort: 'xhigh', complexity: 'unclear',
    scoutModel: 'opus', context: 'touches auth.ts and session.ts',
  })
  assert.deepEqual(phases, ['judging', 'scouting', 'selecting'])
})

test('a failed scout launches the strongest model at high effort and says why', async () => {
  const router = createJevRouter({
    apiKey: 'test-key',
    fetcher: async () => reply({ complexity: choice('unclear'), model: choice('haiku'), effort: choice('low') }),
    scout: async () => { throw new Error('timed out') },
  })
  const route = await router.route(open, catalog, { cwd: '/w' })
  assert.equal(route.status, 'fallback')
  assert.equal(route.model, 'opus')
  assert.equal(route.effort, 'high')
  assert.equal(route.reason, 'timed out')
})

test('when Jev runs out of quota after a scout, the CLI keeps its own model and effort, with the analysis', async () => {
  let calls = 0
  const router = createJevRouter({
    apiKey: 'test-key',
    async fetcher() {
      calls += 1
      return calls === 1
        ? reply({ complexity: choice('unclear'), model: choice('haiku'), effort: choice('low') })
        : { ok: false, status: 429, async json() { return {} } }
    },
    scout: async () => 'touches auth.ts',
  })
  const route = await router.route(open, catalog, { cwd: '/w' })
  assert.equal(route.status, 'fallback')
  assert.equal(route.model, undefined)
  assert.equal(route.effort, undefined)
  assert.equal(route.context, 'touches auth.ts')
  assert.match(route.reason, /額度/)
})

test('a Jev out of quota on the first request leaves model and effort to the CLI', async () => {
  const router = createJevRouter({
    apiKey: 'test-key',
    fetcher: async () => ({ ok: false, status: 402, async json() { return {} } }),
    scout: async () => { throw new Error('no scout without a judgement') },
  })
  const route = await router.route(open, catalog, { cwd: '/w' })
  assert.deepEqual({ model: route.model, effort: route.effort, status: route.status }, { model: undefined, effort: undefined, status: 'fallback' })
  assert.match(route.reason, /額度/)
  const effortOnly = await router.route(task, models)
  assert.equal(effortOnly.effort, undefined)
  assert.match(effortOnly.reason, /額度/)
})

test('a master is not scouted: an unclear task goes straight to the strongest model', async () => {
  const router = createJevRouter({
    apiKey: 'test-key',
    fetcher: async () => reply({ complexity: choice('unclear'), model: choice('haiku'), effort: choice('low') }),
    scout: async () => { throw new Error('a master has no repo to read') },
  })
  assert.deepEqual(await router.route(open, catalog, { scout: false }),
    { status: 'routed', model: 'opus', effort: 'high', complexity: 'unclear' })
})

test('with a manual effort Jev picks only the model', async () => {
  let request
  const router = createJevRouter({
    apiKey: 'test-key',
    async fetcher(_url, init) {
      request = JSON.parse(init.body)
      return reply({ complexity: choice('simple'), model: choice('haiku') })
    },
  })
  const route = await router.route({ ...open, effort: 'low' }, catalog, { cwd: '/w' })
  assert.equal(request.questions.effort, undefined)
  assert.deepEqual(route, { status: 'routed', model: 'haiku', complexity: 'simple' })
})

test('the chosen effort is lowered to what the chosen model accepts', async () => {
  const router = createJevRouter({
    apiKey: 'test-key',
    fetcher: async () => reply({ complexity: choice('complex'), model: choice('sonnet'), effort: choice('max') }),
  })
  assert.equal((await router.route(open, catalog, { cwd: '/w' })).effort, 'high')
  const noEffort = createJevRouter({
    apiKey: 'test-key',
    fetcher: async () => reply({ complexity: choice('simple'), model: choice('haiku'), effort: choice('low') }),
  })
  assert.equal((await noEffort.route(open, catalog, { cwd: '/w' })).effort, undefined)
})

test('a model outside the catalog, or no key, leaves the CLI default model', async () => {
  const stranger = createJevRouter({
    apiKey: 'test-key',
    fetcher: async () => reply({ complexity: choice('simple'), model: choice('gpt-x'), effort: choice('low') }),
  })
  const route = await stranger.route(open, catalog, { cwd: '/w' })
  assert.equal(route.status, 'fallback')
  assert.equal(route.model, undefined)
  assert.match(route.reason, /不在模型清單/)
  const absent = createJevRouter({ apiKey: '', fetcher: async () => { throw new Error('unexpected request') } })
  const none = await absent.route(open, catalog, { cwd: '/w' })
  assert.equal(none.model, undefined)
  assert.match(none.reason, /TYPESAFE_API_KEY/)
})

test('Jev rejects an unsupported effort and falls back to the model default', async () => {
  const router = createJevRouter({
    apiKey: 'test-key',
    async fetcher() {
      return { ok: true, async json() { return { answers: { effort: { type: 'choice', choice: 'ultra' } } } } }
    },
  })
  const result = await router.route(task, models)
  assert.equal(result.status, 'fallback')
  assert.equal(result.effort, undefined)
  assert.match(result.reason, /不支援/)
})

test('missing key and a model without effort support do not send a Jev request', async () => {
  const absent = createJevRouter({ apiKey: '', fetcher: async () => { throw new Error('unexpected request') } })
  assert.match((await absent.route(task, models)).reason, /TYPESAFE_API_KEY/)
  const noEffort = createJevRouter({ apiKey: 'test-key', fetcher: async () => { throw new Error('unexpected request') } })
  assert.match((await noEffort.route({ ...task, model: 'haiku' }, models)).reason, /不支援/)
})

test('a router sees a key saved after the host started', async () => {
  let key
  const router = createJevRouter({
    getApiKey: () => key,
    async fetcher(_url, init) {
      assert.equal(init.headers.Authorization, 'Bearer saved-key')
      return { ok: true, async json() { return { answers: { effort: { type: 'choice', choice: 'low' } } } } }
    },
  })
  assert.equal(router.enabled, false)
  key = 'saved-key'
  assert.equal(router.enabled, true)
  assert.equal((await router.route(task, models)).effort, 'low')
})
