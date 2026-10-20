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

test('the CLI default model determines which effort levels Jev can choose', async () => {
  const router = createJevRouter({
    apiKey: 'test-key',
    async fetcher(_url, init) {
      const body = JSON.parse(init.body)
      assert.equal(body.state.currentModel, 'opus')
      assert.ok(!('xhigh' in body.questions.effort.criteria))
      return { ok: true, async json() { return { answers: { effort: { type: 'choice', choice: 'max' } } } } }
    },
  })
  assert.equal((await router.route({ ...task, model: undefined }, [{ ...models[0], isDefault: true }])).effort, 'max')
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
