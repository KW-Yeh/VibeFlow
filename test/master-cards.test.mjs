import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createCore } from '../packages/core/src/service.ts'
import { EventBus } from '../packages/core/src/events.ts'
import { createNodePlatform, setPlatform } from '../packages/core/src/platform.ts'
import { getStore } from '../packages/core/src/store.ts'
import { createTaskFromInput, updateTaskFromInput } from '../packages/core/src/tasks.ts'
import { buildAgentCommand, masterSystemPrompt, slaveSystemPrompt } from '../packages/core/src/launch.ts'
import { exists, makeRepo, writeFile } from './support/repo.mjs'

function fakeSessions() {
  const alive = new Set()
  return {
    kind: 'pty',
    starts: [],
    writes: [],
    alive,
    async start(key, opts) {
      this.starts.push({ key, ...opts })
      alive.add(key)
      return { pid: 1, scrollback: null }
    },
    write(key, data) { this.writes.push({ key, data }) },
    resize() {},
    async kill(key) { alive.delete(key) },
    async isAlive(key) { return alive.has(key) },
    scrollback: () => null,
    discardScrollback() {},
    async list() { return Array.from(alive) },
    shutdown() {},
  }
}

const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-master-'))
const workstation = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-master-ws-'))
setPlatform(createNodePlatform({ userDataDir: storeDir }))
getStore().set('settings', { autoMode: true, workstationPath: workstation })

test.after(() =>
  Promise.all([
    fs.rm(storeDir, { recursive: true, force: true }),
    fs.rm(workstation, { recursive: true, force: true }),
  ])
)

function setup(t) {
  const sessions = fakeSessions()
  const core = createCore({ sessions, bus: new EventBus(), version: '9.9.9' })
  t.after(() => core.shutdown())
  return { core, sessions }
}

const findCard = (core, id) => {
  const board = core.handlers['vibeflow:getState']().board
  for (const column of ['backlog', 'in_progress', 'done']) {
    const task = board[column].find((t) => t.id === id)
    if (task) return { column, task }
  }
  return null
}

async function slaveRepo(t) {
  const { projectPath, cleanup } = await makeRepo({ withRemote: false })
  t.after(cleanup)
  return projectPath
}

test('a master needs no project and gets a folder of its own only when it runs', async (t) => {
  const { core, sessions } = setup(t)
  const { task } = await core.handlers['vibeflow:createTask']({ role: 'master', title: 'Ship login', description: 'plan it' })
  assert.equal(task.role, 'master')
  assert.equal(task.branch, '')
  assert.equal(task.projectPath, undefined)
  assert.equal(task.workspacePath, path.join(storeDir, 'masters', task.id))
  assert.equal(task.worktreePath, undefined)

  await core.handlers['pty:start']({ taskId: task.id, launch: {} })
  const { task: running } = findCard(core, task.id)
  assert.equal(running.worktreePath, path.join(task.workspacePath, 'work'))
  assert.equal(sessions.starts[0].cwd, running.worktreePath)
  assert.equal(await exists(path.join(running.worktreePath, '.git')), false)
  assert.deepEqual(await core.handlers['git:getDiffEntries'](task.id, { fetch: false }), [])
  assert.deepEqual(await core.handlers['git:getDiff'](task.id), [])
  assert.deepEqual(await core.handlers['task:getSpecs'](task.id), [])
  assert.equal(await core.handlers['git:getPrStatus'](task.id), null)
})

test('a master can run in any existing folder, git or not', async (t) => {
  const { core, sessions } = setup(t)
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-master-dir-'))
  t.after(() => fs.rm(folder, { recursive: true, force: true }))
  const { task } = await core.handlers['vibeflow:createTask']({ role: 'master', title: 'Own folder', workDir: folder })
  await core.handlers['pty:start']({ taskId: task.id, launch: {} })
  assert.equal(sessions.starts[0].cwd, folder)

  await assert.rejects(
    core.handlers['vibeflow:createTask']({ role: 'master', title: 'Missing', workDir: path.join(folder, 'nope') }),
    /找不到資料夾/
  )
})

test('a card belongs to at most one master, and only to a master', async (t) => {
  const { core } = setup(t)
  const projectPath = await slaveRepo(t)
  const { task: master } = await core.handlers['vibeflow:createTask']({ role: 'master', title: 'M' })
  const { task: slave } = await core.handlers['vibeflow:createTask']({ projectPath, title: 'S', masterId: master.id })
  assert.equal(slave.masterId, master.id)

  await assert.rejects(
    core.handlers['vibeflow:createTask']({ projectPath, title: 'S2', masterId: 'deadbeef' }),
    (err) => err.code === 'MASTER_NOT_FOUND'
  )
  await assert.rejects(
    core.handlers['vibeflow:createTask']({ projectPath, title: 'S3', masterId: slave.id }),
    (err) => err.code === 'NOT_A_MASTER'
  )
  await assert.rejects(
    core.handlers['vibeflow:createTask']({ role: 'master', title: 'M2', masterId: master.id }),
    (err) => err.code === 'NOT_A_MASTER'
  )

  await core.handlers['vibeflow:updateTask']({ taskId: slave.id, title: 'S', masterId: null })
  assert.equal(findCard(core, slave.id).task.masterId, undefined)
  await core.handlers['vibeflow:updateTask']({ taskId: slave.id, title: 'S', masterId: master.id })
  assert.equal(findCard(core, slave.id).task.masterId, master.id)
  await assert.rejects(core.handlers['vibeflow:updateTask']({ taskId: master.id, title: 'M', masterId: master.id }))
})

test('the CLI path validates masters the same way', async (t) => {
  const projectPath = await slaveRepo(t)
  const { task: master } = await createTaskFromInput({ role: 'master', title: 'CLI master', storePath: storeDir })
  const { task: slave } = await createTaskFromInput({ projectPath, title: 'CLI slave', storePath: storeDir })
  const { task } = updateTaskFromInput({ taskId: slave.id, masterId: master.id, storePath: storeDir })
  assert.equal(task.masterId, master.id)
  assert.throws(() => updateTaskFromInput({ taskId: master.id, masterId: master.id, storePath: storeDir }), /不能再隸屬/)
  assert.equal(updateTaskFromInput({ taskId: slave.id, masterId: null, storePath: storeDir }).task.masterId, undefined)
})

test('startTask moves a Backlog card to In Progress and starts its agent on the host', async (t) => {
  const { core, sessions } = setup(t)
  const projectPath = await slaveRepo(t)
  const { task } = await core.handlers['vibeflow:createTask']({ projectPath, title: 'Headless start', agentCli: 'claude' })
  await core.handlers['vibeflow:startTask'](task.id)

  const { column, task: started } = findCard(core, task.id)
  assert.equal(column, 'in_progress')
  assert.ok(started.launchedAt)
  assert.ok(started.worktreePath, 'starting provisions the worktree')
  assert.equal(sessions.starts.length, 1)
  assert.equal(sessions.starts[0].key, task.id)
  assert.match(sessions.starts[0].command, /claude --session-id/)

  await assert.rejects(core.handlers['vibeflow:startTask'](task.id), /只有 Backlog/)
})

test('summaries list a master’s cards with where they are and whether they run', async (t) => {
  const { core } = setup(t)
  const projectPath = await slaveRepo(t)
  const { task: master } = await core.handlers['vibeflow:createTask']({ role: 'master', title: 'Summary master' })
  const { task: a } = await core.handlers['vibeflow:createTask']({ projectPath, title: 'A', masterId: master.id })
  const { task: b } = await core.handlers['vibeflow:createTask']({ projectPath, title: 'B', masterId: master.id })
  await core.handlers['vibeflow:createTask']({ projectPath, title: 'Unrelated' })
  await core.handlers['vibeflow:startTask'](a.id)

  const summaries = await core.handlers['task:summaries']({ masterId: master.id })
  assert.deepEqual(summaries.map((s) => s.id).sort(), [a.id, b.id].sort())
  const byId = Object.fromEntries(summaries.map((s) => [s.id, s]))
  assert.equal(byId[a.id].column, 'in_progress')
  assert.equal(byId[a.id].running, true)
  assert.equal(byId[b.id].column, 'backlog')
  assert.equal(byId[b.id].running, false)
  assert.equal(byId[a.id].masterId, master.id)
})

test('deleting a master frees its cards and removes only the folder VibeFlow made', async (t) => {
  const { core } = setup(t)
  const projectPath = await slaveRepo(t)
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-master-keep-'))
  t.after(() => fs.rm(folder, { recursive: true, force: true }))

  const { task: owned } = await core.handlers['vibeflow:createTask']({ role: 'master', title: 'Owned' })
  const { task: slave } = await core.handlers['vibeflow:createTask']({ projectPath, title: 'S', masterId: owned.id })
  await core.handlers['pty:start']({ taskId: owned.id, launch: {} })
  assert.equal(await exists(owned.workspacePath), true)
  await core.handlers['vibeflow:deleteTask'](owned.id)
  assert.equal(await exists(owned.workspacePath), false)
  assert.equal(findCard(core, slave.id).task.masterId, undefined)

  const { task: chosen } = await core.handlers['vibeflow:createTask']({ role: 'master', title: 'Chosen', workDir: folder })
  await core.handlers['pty:start']({ taskId: chosen.id, launch: {} })
  await writeFile(folder, 'notes.md', 'keep me')
  await core.handlers['vibeflow:deleteTask'](chosen.id)
  assert.equal(await exists(path.join(folder, 'notes.md')), true)
})

test('restarting a master keeps the files in its folder', async (t) => {
  const { core } = setup(t)
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-master-reset-'))
  t.after(() => fs.rm(folder, { recursive: true, force: true }))
  const { task } = await core.handlers['vibeflow:createTask']({ role: 'master', title: 'Reset', workDir: folder })
  await core.handlers['pty:start']({ taskId: task.id, launch: {} })
  await writeFile(folder, 'plan.md', 'keep')
  const { task: reset } = await core.handlers['vibeflow:resetTaskRun'](task.id)
  assert.ok(reset.runId)
  assert.equal(await exists(path.join(folder, 'plan.md')), true)
})

test('completing a master captures no git outcome', async (t) => {
  const { core } = setup(t)
  const { task } = await core.handlers['vibeflow:createTask']({ role: 'master', title: 'Done master' })
  await core.handlers['pty:start']({ taskId: task.id, launch: {} })
  await core.handlers['vibeflow:cleanupTask'](task.id)
  const done = findCard(core, task.id).task
  assert.equal(done.outcome, undefined)
  assert.equal(done.worktreePath, undefined)
})

test('only a master launch carries the master instructions', () => {
  const boardCli = { storeDir: '/s', cliPath: '/cli/vibeflow.mjs' }
  const base = { id: 'abcd1234', title: 'T', worktreePath: '/w', branch: '', agentCli: 'claude' }
  const master = buildAgentCommand({ ...base, role: 'master' }, 'house rules', { boardCli, autoMode: true })
  assert.ok(master.includes('Master agent'))
  assert.ok(master.includes('house rules'), "the user's own system prompt stays")
  assert.ok(master.includes('VF task start'))
  const slave = buildAgentCommand(base, 'house rules', { boardCli, autoMode: true })
  assert.ok(!slave.includes('Master agent'))
})

test('the master prompt follows auto mode and degrades without a CLI', () => {
  assert.ok(masterSystemPrompt({ canWrite: true, autoMode: true }).includes('VF task start'))
  const manual = masterSystemPrompt({ canWrite: true, autoMode: false })
  assert.ok(!manual.includes('VF task start'))
  assert.ok(manual.includes('等使用者'))
  const readOnly = masterSystemPrompt({ canWrite: false, autoMode: true })
  assert.ok(!readOnly.includes('VF task create'))
})

test('an extra terminal on a master opens in its folder, whatever its column', async (t) => {
  const { core, sessions } = setup(t)
  const { task } = await core.handlers['vibeflow:createTask']({ role: 'master', title: 'Shell' })
  const key = 'terminal_11111111-2222-4333-8444-555555555555'
  await core.handlers['terminal:start']({ sessionKey: key, taskId: task.id })
  assert.equal(sessions.starts.at(-1).cwd, path.join(task.workspacePath, 'work'))
})

async function masterWithCards(t) {
  process.env.VIBEFLOW_QUIET_MS = '0'
  t.after(() => { delete process.env.VIBEFLOW_QUIET_MS })
  const { core, sessions } = setup(t)
  const projectPath = await slaveRepo(t)
  const create = (input) => core.handlers['vibeflow:createTask'](input).then((r) => r.task)
  const master = await create({ role: 'master', title: 'Lead' })
  const other = await create({ role: 'master', title: 'Other lead' })
  const dev = await create({ projectPath, title: 'Dev', masterId: master.id })
  const qa = await create({ projectPath, title: 'QA', masterId: master.id })
  const stray = await create({ projectPath, title: 'Stray', masterId: other.id })
  for (const card of [master, other, dev, qa, stray]) sessions.alive.add(card.id)
  const send = (from, to, text = 'hello') => core.handlers['vibeflow:sendMessage']({ from: from.id, to: to.id, text })
  return { core, sessions, master, other, dev, qa, stray, send }
}

test('a master and its own cards message each other, tagged with the sender', async (t) => {
  const { sessions, master, dev, send } = await masterWithCards(t)
  assert.deepEqual(await send(master, dev, 'fix the login test').then((r) => r.delivered), true)
  await send(dev, master, 'done: PR #12')
  const [toDev, enter, toMaster] = sessions.writes
  assert.equal(toDev.key, dev.id)
  assert.ok(toDev.data.startsWith(`\x1b[200~<vibeflow from="${master.id} Lead">\n`))
  assert.ok(toDev.data.includes('fix the login test'))
  assert.deepEqual(enter, { key: dev.id, data: '\r' })
  assert.equal(toMaster.key, master.id)
  assert.ok(toMaster.data.includes(`from="${dev.id} Dev"`))
})

test('cards outside one master relationship cannot message each other', async (t) => {
  const { core, sessions, master, other, dev, qa, stray, send } = await masterWithCards(t)
  const refusedWith = (code) => (err) => err.code === code
  await assert.rejects(send(dev, qa), refusedWith('NOT_RELATED'), 'two cards of one master go through it')
  await assert.rejects(send(stray, master), refusedWith('NOT_RELATED'), "another master's card")
  await assert.rejects(send(master, stray), refusedWith('NOT_RELATED'))
  await assert.rejects(send(master, other), refusedWith('NOT_RELATED'), 'masters do not talk to each other')
  await assert.rejects(
    core.handlers['vibeflow:sendMessage']({ from: master.id, to: 'deadbeef', text: 'x' }),
    refusedWith('UNKNOWN_TASK')
  )
  sessions.alive.delete(dev.id)
  await assert.rejects(send(master, dev), refusedWith('NOT_RUNNING'))
  await assert.rejects(send(master, qa, '   '), refusedWith('INVALID_REQUEST'))
  assert.equal(sessions.writes.length, 0)
})

test("a person's keys reach the agent untagged", async (t) => {
  const { core, sessions, dev } = await masterWithCards(t)
  core.handlers['pty:input']({ sessionKey: dev.id, data: 'y' })
  assert.deepEqual(sessions.writes, [{ key: dev.id, data: 'y' }])
})

test("a master's card knows its master and how to report; any other card launches as before", () => {
  const boardCli = { storeDir: '/s', cliPath: '/cli/vibeflow.mjs' }
  const base = { id: 'abcd1234', title: 'T', worktreePath: '/w', branch: 'vf-abcd1234', projectPath: '/p', agentCli: 'claude' }
  const slave = buildAgentCommand({ ...base, masterId: 'feed0001' }, 'house rules', { boardCli, autoMode: true })
  assert.ok(slave.includes("VIBEFLOW_MASTER_ID='feed0001'"))
  assert.ok(slave.includes('VF task send'))
  assert.ok(slave.includes('house rules'))
  assert.ok(!slave.includes('VF task start'), 'the master instructions stay with masters')
  for (const agentCli of ['claude', 'codex']) {
    const plain = buildAgentCommand({ ...base, agentCli }, 'house rules', { boardCli, autoMode: true })
    assert.ok(!plain.includes('VIBEFLOW_MASTER_ID'))
    assert.ok(!plain.includes('VF task send'))
    assert.ok(!plain.includes('master'))
  }
  assert.ok(!slaveSystemPrompt({ canWrite: false }).includes('VF task send'), 'no CLI, no command it cannot run')
})
