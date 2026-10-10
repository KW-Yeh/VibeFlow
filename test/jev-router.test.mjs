import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { runAgentPrint } from '../packages/core/src/agent-print.ts'
import { createJevRouter, routeCandidates } from '../packages/core/src/jev-router.ts'

const task = {
  id: 'abc12345', title: 'Improve login', description: 'Clarify the API and implement refresh token rotation',
  agentCli: 'claude', worktreePath: '/tmp/worktree',
}
const models = [
  { id: 'opus', label: 'Opus' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'haiku', label: 'Haiku' },
]

test('Jev prepares a complex task, then chooses an exact available model', async () => {
  const requests = []
  const plans = []
  const router = createJevRouter({
    apiKey: 'test-key',
    async fetcher(_url, init) {
      const body = JSON.parse(init.body)
      requests.push(body)
      return {
        ok: true,
        async json() { return { answers: requests.length === 1
          ? { complexity: { type: 'choice', choice: 'complex' }, preparation: { type: 'choice', choice: 'plan' } }
          : { model: { type: 'choice', choice: 'sonnet' } } } },
      }
    },
    async planner(agent, model, prompt, cwd) {
      plans.push({ agent, model, prompt, cwd })
      return 'Check the API contract, then update the code and tests.'
    },
  })
  const result = await router.route(task, models)
  assert.equal(result.status, 'routed')
  assert.equal(result.model, 'sonnet')
  assert.equal(result.plannerModel, 'opus')
  assert.equal(plans.length, 1)
  assert.match(plans[0].prompt, /Do not edit files/)
  assert.equal(requests.length, 2)
  assert.equal(requests[1].state.plan, result.plan)
  assert.deepEqual(Object.keys(requests[1].questions.model.criteria), ['haiku', 'sonnet', 'opus'])
})

test('a direct task skips planning, and missing credentials fall back without calling the API', async () => {
  let calls = 0
  const direct = createJevRouter({
    apiKey: 'test-key',
    async fetcher() {
      calls += 1
      return { ok: true, async json() { return { answers: calls === 1
        ? { complexity: { type: 'choice', choice: 'simple' }, preparation: { type: 'choice', choice: 'direct' } }
        : { model: { type: 'choice', choice: 'haiku' } } } } }
    },
    async planner() { throw new Error('planner must not run') },
  })
  assert.deepEqual(await direct.route(task, models), { status: 'routed', model: 'haiku' })
  assert.equal(calls, 2)
  const absent = createJevRouter({ apiKey: '', fetcher: async () => { throw new Error('API must not run') } })
  assert.match((await absent.route(task, models)).reason, /TYPESAFE_API_KEY/)
})

test('a malformed Jev model choice cannot inject an unlisted CLI model', async () => {
  let calls = 0
  const router = createJevRouter({
    apiKey: 'test-key',
    async fetcher() {
      calls += 1
      return { ok: true, async json() { return { answers: calls === 1
        ? { complexity: { type: 'choice', choice: 'simple' }, preparation: { type: 'choice', choice: 'direct' } }
        : { model: { type: 'choice', choice: 'opus; echo bad' } } } } }
    },
  })
  const result = await router.route(task, models)
  assert.equal(result.status, 'fallback')
  assert.equal(result.model, undefined)
  assert.deepEqual(routeCandidates('claude', [...models, { id: 'bad;echo', label: 'Bad' }]), [models[2], models[1], models[0]])
})

test('a router sees a key saved after the host started', async () => {
  let key
  let calls = 0
  const router = createJevRouter({
    getApiKey: () => key,
    async fetcher(_url, init) {
      calls += 1
      assert.equal(init.headers.Authorization, 'Bearer saved-key')
      return { ok: true, async json() { return { answers: calls === 1
        ? { complexity: { type: 'choice', choice: 'simple' }, preparation: { type: 'choice', choice: 'direct' } }
        : { model: { type: 'choice', choice: 'haiku' } } } } }
    },
  })
  assert.equal(router.enabled, false)
  key = 'saved-key'
  assert.equal(router.enabled, true)
  assert.equal((await router.route(task, models)).model, 'haiku')
})

test('POSIX planning starts each agent in a worktree with spaces and passes the prompt on stdin',
  { skip: process.platform === 'win32' }, async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-jev-mac-'))
    t.after(() => fs.rm(root, { recursive: true, force: true }))
    const binDir = path.join(root, 'CLI tools')
    const worktree = path.join(root, 'Project With Spaces', '.vibeflow', 'vf-abc12345')
    await fs.mkdir(binDir, { recursive: true })
    await fs.mkdir(worktree, { recursive: true })
    const script = '#!/bin/sh\nprintf "%s\\n" "$@" > "$VIBEFLOW_JEV_ARGS"\npwd > "$VIBEFLOW_JEV_CWD"\ncat > "$VIBEFLOW_JEV_PROMPT"\nprintf "Inspect, implement, verify.\\n"\n'
    for (const name of ['claude', 'codex']) {
      await fs.writeFile(path.join(binDir, name), script, { mode: 0o755 })
    }
    const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
    const env = {
      ...process.env,
      [pathKey]: `${binDir}${path.delimiter}${process.env[pathKey] ?? ''}`,
      VIBEFLOW_JEV_ARGS: path.join(root, 'args.txt'),
      VIBEFLOW_JEV_CWD: path.join(root, 'cwd.txt'),
      VIBEFLOW_JEV_PROMPT: path.join(root, 'prompt.txt'),
    }
    delete env.NODE_OPTIONS

    for (const agent of ['claude', 'codex']) {
      let calls = 0
      const catalog = agent === 'claude' ? models : [
        { id: 'gpt-5.5', label: 'GPT 5.5' },
        { id: 'gpt-5.5-mini', label: 'GPT 5.5 mini' },
      ]
      const router = createJevRouter({
        apiKey: 'test-key',
        printAgent: (bin, args, input, options) => runAgentPrint(bin, args, input, { ...options, env }),
        async fetcher() {
          calls += 1
          return { ok: true, async json() { return { answers: calls === 1
            ? { complexity: { type: 'choice', choice: 'complex' }, preparation: { type: 'choice', choice: 'plan' } }
            : { model: { type: 'choice', choice: catalog[0].id } } } } }
        },
      })
      const result = await router.route({
        ...task, agentCli: agent, worktreePath: worktree,
        description: `Check the user's \"quoted\" request.\n保持中文內容 & symbols.`,
      }, catalog)
      assert.equal(result.status, 'routed', result.reason)
      assert.equal(result.plan, 'Inspect, implement, verify.')
      assert.equal((await fs.readFile(env.VIBEFLOW_JEV_CWD, 'utf8')).trim(), worktree)
      assert.match(await fs.readFile(env.VIBEFLOW_JEV_PROMPT, 'utf8'), /保持中文內容 & symbols/)
      assert.deepEqual((await fs.readFile(env.VIBEFLOW_JEV_ARGS, 'utf8')).trim().split('\n'),
        agent === 'claude'
          ? ['-p', '--model', 'opus', '--permission-mode', 'plan']
          : ['exec', '--model', 'gpt-5.5', '--sandbox', 'read-only', '--skip-git-repo-check', '-'])
    }
  })
