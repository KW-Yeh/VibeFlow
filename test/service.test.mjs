import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createCore } from '../packages/core/src/service.ts'
import { EventBus } from '../packages/core/src/events.ts'
import { createNodePlatform, setPlatform } from '../packages/core/src/platform.ts'
import { getStore } from '../packages/core/src/store.ts'
import { makeRepo } from './support/repo.mjs'

/** A SessionBackend that records what core asked of it. */
function fakeSessions() {
  const alive = new Set()
  return {
    kind: 'pty',
    starts: [],
    writes: [],
    killed: [],
    alive,
    async start(key, opts) {
      this.starts.push({ key, ...opts })
      alive.add(key)
      return { pid: 1, scrollback: null }
    },
    write(key, data) {
      this.writes.push({ key, data })
    },
    resize() {},
    async kill(key) {
      this.killed.push(key)
      alive.delete(key)
    },
    async isAlive(key) {
      return alive.has(key)
    },
    scrollback: () => null,
    async list() {
      return Array.from(alive)
    },
    shutdown() {},
  }
}

/**
 * One store for the whole file: core reads it through the platform, which is
 * process-wide. Its workstation root is a throwaway directory.
 */
const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-service-'))
const workstation = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-service-ws-'))
setPlatform(createNodePlatform({ userDataDir: storeDir }))
getStore().set('settings', { autoMode: true, workstationPath: workstation })

test.after(() =>
  Promise.all([
    fs.rm(storeDir, { recursive: true, force: true }),
    fs.rm(workstation, { recursive: true, force: true }),
  ])
)

async function coreWithTask(t) {
  const { projectPath, cleanup } = await makeRepo({ withRemote: false })
  t.after(cleanup)
  const sessions = fakeSessions()
  const bus = new EventBus()
  const core = createCore({ sessions, bus, version: '9.9.9' })
  // pty:start watches the worktree for sub-agent files; stop it with the test.
  t.after(() => core.shutdown())
  const { task } = await core.handlers['vibeflow:createTask']({
    title: 'Service card',
    description: 'check the launch',
    projectPath,
    baseBranch: null,
    agentCli: 'claude',
  })
  return { core, sessions, bus, task }
}

test('an agent launch is built by core from the task, not sent by the frontend', async (t) => {
  const { core, sessions, task } = await coreWithTask(t)
  await core.handlers['pty:start']({
    taskId: task.id,
    launch: {},
    // Anything a client tries to smuggle in is ignored.
    cwd: '/etc',
    command: 'rm -rf /',
  })
  const [start] = sessions.starts
  assert.equal(start.key, task.id)
  assert.equal(start.cwd, task.worktreePath)
  assert.match(start.command, /^export VIBEFLOW_TASK_ID=/)
  assert.match(start.command, /claude --session-id [0-9a-f-]{36} /)
  assert.ok(!start.command.includes('rm -rf'))
  assert.ok(!start.command.endsWith('\r'), 'the typing CR is stripped for -c')
})

test('a shell start has no command', async (t) => {
  const { core, sessions, task } = await coreWithTask(t)
  await core.handlers['pty:start']({ taskId: task.id })
  assert.equal(sessions.starts[0].command, undefined)
})

test('resuming a session that is still running re-attaches instead of relaunching', async (t) => {
  const { core, sessions, task } = await coreWithTask(t)
  sessions.alive.add(task.id)
  await core.handlers['pty:start']({ taskId: task.id, launch: { resume: true } })
  assert.equal(sessions.starts[0].command, undefined)
  assert.equal(sessions.starts[0].fresh, false)
})

test('unknown tasks and foreign session keys are refused', async (t) => {
  const { core, sessions, task } = await coreWithTask(t)
  await assert.rejects(core.handlers['pty:start']({ taskId: 'nope1234' }), { code: 'INVALID_REQUEST' })
  await assert.rejects(
    core.handlers['pty:start']({ taskId: task.id, sessionKey: 'other123:tab' }),
    { code: 'INVALID_REQUEST' }
  )
  assert.throws(() => core.handlers['pty:input']({ sessionKey: 'nope1234', data: 'x' }), {
    code: 'INVALID_REQUEST',
  })
  core.handlers['pty:input']({ sessionKey: `${task.id}:2`, data: 'ls\r' })
  assert.deepEqual(sessions.writes, [{ key: `${task.id}:2`, data: 'ls\r' }])
})

test('a board write can move cards but not add them or rewrite their worktree', async (t) => {
  const { core, task } = await coreWithTask(t)
  const state = core.handlers['vibeflow:setBoard']({
    backlog: [],
    in_progress: [{ ...task, worktreePath: '/tmp/elsewhere', launchedAt: 123 }],
    done: [{ id: 'forged01', title: 'forged', branch: 'x' }],
  })
  const moved = state.board.in_progress.find((t2) => t2.id === task.id)
  assert.equal(moved.worktreePath, task.worktreePath)
  assert.equal(moved.launchedAt, 123)
  assert.equal(state.board.done.some((t2) => t2.id === 'forged01'), false)
})

test('agents:listModels validates the agent and serves the builtin claude aliases', async (t) => {
  const { core } = await coreWithTask(t)
  const list = await core.handlers['agents:listModels']({ agentId: 'claude' })
  assert.equal(list.source, 'builtin')
  assert.ok(list.models.some((m) => m.id === 'sonnet'))
  assert.throws(() => core.handlers['agents:listModels']({ agentId: 'gemini' }), { code: 'INVALID_REQUEST' })
  assert.throws(() => core.handlers['agents:listModels']('claude'), { code: 'INVALID_REQUEST' })
})

test('the API-key connection channels are gone', async (t) => {
  const { core } = await coreWithTask(t)
  assert.equal(core.handlers['settings:connectAgent'], undefined)
  assert.equal(core.handlers['settings:refreshAgentModels'], undefined)
})

test('only http(s) links can be opened on the host', async (t) => {
  const { core } = await coreWithTask(t)
  assert.throws(() => core.handlers['shell:openExternal']('file:///etc/passwd'), { code: 'INVALID_REQUEST' })
  assert.throws(() => core.handlers['shell:openExternal']('javascript:alert(1)'), { code: 'INVALID_REQUEST' })
})

test('deleting a task tears down every terminal it has', async (t) => {
  const { core, sessions, task } = await coreWithTask(t)
  sessions.alive.add(task.id)
  sessions.alive.add(`${task.id}:2`)
  sessions.alive.add('someone-else')
  await core.handlers['vibeflow:deleteTask'](task.id)
  assert.deepEqual(sessions.killed.sort(), [task.id, `${task.id}:2`].sort())
  assert.equal(
    core.handlers['vibeflow:getState']().board.backlog.some((t2) => t2.id === task.id),
    false
  )
})

test('events reach every bus listener', async (t) => {
  const { bus } = await coreWithTask(t)
  const seen = []
  const off = bus.on((channel, payload) => seen.push([channel, payload]))
  bus.emit('pty:data', { sessionKey: 'k', data: 'x' })
  off()
  bus.emit('pty:data', { sessionKey: 'k', data: 'y' })
  assert.deepEqual(seen, [['pty:data', { sessionKey: 'k', data: 'x' }]])
})
