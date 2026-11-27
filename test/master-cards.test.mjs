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
import { postMessage } from '../packages/core/src/inbox.ts'
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
  // A continuation brief asks for the card's PR; no test should run the real `gh` in a worktree.
  const core = createCore({ sessions, bus: new EventBus(), version: '9.9.9', prStatus: async () => null })
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

test('a master made from an inbox item keeps its GitHub or Jira link', async (t) => {
  const { core } = setup(t)
  const github = { kind: 'pr', repo: 'acme/web', number: 12, url: 'https://github.com/acme/web/pull/12' }
  const jira = { key: 'WEB-7', url: 'https://acme.atlassian.net/browse/WEB-7', site: 'acme.atlassian.net' }
  const { task: fromPr } = await core.handlers['vibeflow:createTask']({ role: 'master', title: 'Review #12', github })
  const { task: fromTicket } = await core.handlers['vibeflow:createTask']({ role: 'master', title: 'WEB-7', jira })
  assert.deepEqual(findCard(core, fromPr.id).task.github, github)
  assert.deepEqual(findCard(core, fromTicket.id).task.jira, jira)
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

  await assert.rejects(core.handlers['vibeflow:startTask'](task.id), /只有待辦/)
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

test("Jev picks the model for a master's card started from the CLI, and summaries say what it runs on", async (t) => {
  const calls = []
  const jevRouter = { async route(task, _list, opts) {
    calls.push({ id: task.id, scout: opts.scout })
    return { status: 'routed', model: 'sonnet', effort: 'high', complexity: 'moderate' }
  } }
  const sessions = fakeSessions()
  const core = createCore({ sessions, bus: new EventBus(), version: '9.9.9', jevRouter })
  t.after(() => core.shutdown())
  const projectPath = await slaveRepo(t)
  const { task: master } = await core.handlers['vibeflow:createTask']({ role: 'master', title: 'Lead' })
  const { task: dev } = await core.handlers['vibeflow:createTask']({ projectPath, title: 'Dev', masterId: master.id, agentCli: 'claude' })
  await core.handlers['vibeflow:startTask'](master.id)
  await core.handlers['vibeflow:startTask'](dev.id)

  assert.deepEqual(calls, [{ id: master.id, scout: false }, { id: dev.id, scout: true }], 'only cards with a repo are scouted')
  assert.match(sessions.starts.find((s) => s.key === dev.id).command, /--model sonnet --effort high /)
  const [summary] = await core.handlers['task:summaries']({ taskId: dev.id })
  assert.equal(summary.model, 'sonnet')
  assert.equal(summary.effort, 'high')
})

test('summaries without a filter list every card, also when the filter arrives as null over the WebSocket', async (t) => {
  const { core } = setup(t)
  const projectPath = await slaveRepo(t)
  const { task: master } = await core.handlers['vibeflow:createTask']({ role: 'master', title: 'Summary master' })
  const { task: slave } = await core.handlers['vibeflow:createTask']({ projectPath, title: 'S', masterId: master.id })
  const { task: loose } = await core.handlers['vibeflow:createTask']({ projectPath, title: 'Loose' })

  const unfiltered = (await core.handlers['task:summaries']()).map((s) => s.id).sort()
  for (const id of [master.id, slave.id, loose.id]) assert.ok(unfiltered.includes(id))
  assert.deepEqual((await core.handlers['task:summaries'](null)).map((s) => s.id).sort(), unfiltered)
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

test('a message for a card whose session reads its inbox waits there instead of joining the unsent draft', async (t) => {
  const { core, sessions, master, dev, send } = await masterWithCards(t)
  const { task: started } = await core.handlers['vibeflow:startTask'](master.id)
  const inbox = path.join(started.worktreePath, '.vibeflow-inbox')
  assert.equal(await exists(path.join(inbox, '.gitignore')), true, 'launch prepares the inbox, never to be committed')
  assert.equal(await exists(path.join(inbox, '.ready')), false, 'until the session itself says it reads it')
  await fs.writeFile(path.join(inbox, '.ready'), '')
  sessions.writes.length = 0
  core.handlers['pty:input']({ sessionKey: master.id, data: 'half a thou' })
  const result = await send(dev, master, 'done: PR #12')
  assert.equal(result.via, 'queued')
  assert.deepEqual(sessions.writes, [{ key: master.id, data: 'half a thou' }], 'nothing typed on top of the draft')
  const [waiting] = (await fs.readdir(inbox)).filter((n) => !n.startsWith('.'))
  assert.ok((await fs.readFile(path.join(inbox, waiting), 'utf8')).includes(`from="${dev.id} Dev"`))
})

test("a person's keys reach the agent untagged", async (t) => {
  const { core, sessions, dev } = await masterWithCards(t)
  core.handlers['pty:input']({ sessionKey: dev.id, data: 'y' })
  assert.deepEqual(sessions.writes, [{ key: dev.id, data: 'y' }])
})

test("a master's card launches like any card, plus the plan it belongs to", () => {
  const boardCli = { storeDir: '/s', cliPath: '/cli/vibeflow.mjs' }
  const library = { pluginDir: '/lib/plugin', libraryDir: '/lib', codexHome: '/lib/codex-home', promptText: 'library snippet' }
  const base = { id: 'abcd1234', title: 'T', worktreePath: '/w', branch: 'vf-abcd1234', projectPath: '/p', agentCli: 'claude' }
  const masterContext = {
    master: { id: 'feed0001', title: 'Lead' },
    siblings: [{ id: 'beef0002', title: '後端：API', summary: 'add the endpoint' }],
    after: ['beef0002'],
  }
  for (const agentCli of ['claude', 'codex']) {
    const slave = buildAgentCommand(
      { ...base, agentCli, masterId: 'feed0001' },
      'house rules',
      { boardCli, autoMode: true, library, masterContext }
    )
    assert.ok(slave.includes("VIBEFLOW_MASTER_ID='feed0001'"))
    assert.ok(slave.includes('house rules'), `${agentCli}: the custom prompt reaches a master's card too`)
    assert.ok(slave.includes('library snippet'), `${agentCli}: and so do Library snippets`)
    assert.ok(slave.includes('feed0001「Lead」'))
    assert.ok(slave.includes('beef0002「後端：API」：add the endpoint'))
    assert.ok(slave.includes('使用者會直接在這張卡跟你協作'))
    assert.ok(!slave.includes('回報內容'), 'no duty to report')
    assert.ok(!slave.includes('沒有 master 要求就不要開 PR'))
    assert.ok(!slave.includes('VF task start'), 'the master instructions stay with masters')
    const plain = buildAgentCommand({ ...base, agentCli }, 'house rules', { boardCli, autoMode: true })
    assert.ok(plain.includes('house rules'), `${agentCli}: other cards keep the custom prompt`)
    assert.ok(!plain.includes('VIBEFLOW_MASTER_ID'))
    assert.ok(!plain.includes('VF task send'))
    assert.ok(!plain.includes('master'))
  }
  assert.ok(!slaveSystemPrompt({ canWrite: false }).includes('VF task send'), 'no CLI, no command it cannot run')
})

test("a master's related projects are readable folders of its launch, for either agent", () => {
  const base = { id: 'abcd1234', title: 'T', worktreePath: '/w', branch: '', role: 'master', projects: ['/repo/a', '/repo/b'] }
  for (const agentCli of ['claude', 'codex']) {
    const cmd = buildAgentCommand({ ...base, agentCli }, '', { autoMode: false })
    assert.ok(cmd.includes("--add-dir '/repo/a'"), agentCli)
    assert.ok(cmd.includes("--add-dir '/repo/b'"), agentCli)
    assert.ok(cmd.includes('- /repo/a'), `${agentCli}: and the prompt names them`)
  }
  const none = buildAgentCommand({ ...base, projects: undefined, agentCli: 'codex' }, '', { autoMode: false })
  assert.ok(!none.includes('--add-dir'))
  const slave = buildAgentCommand({ ...base, role: undefined, masterId: 'm', agentCli: 'codex' }, '', {})
  assert.ok(!slave.includes('/repo/a'), 'only a master reads its projects')
})

function moveToDone(core, id) {
  const board = core.handlers['vibeflow:getState']().board
  const card = [...board.backlog, ...board.in_progress].find((t) => t.id === id)
  core.handlers['vibeflow:setBoard']({
    backlog: board.backlog.filter((t) => t.id !== id),
    in_progress: board.in_progress.filter((t) => t.id !== id),
    done: [card, ...board.done],
  })
  return core.handlers['vibeflow:cleanupTask'](id)
}

test('a card that waited starts once its cards are Done, and the master hears only when all are', async (t) => {
  process.env.VIBEFLOW_QUIET_MS = '0'
  t.after(() => { delete process.env.VIBEFLOW_QUIET_MS })
  const { core, sessions } = setup(t)
  const projectPath = await slaveRepo(t)
  const { task: master } = await core.handlers['vibeflow:createTask']({ role: 'master', title: 'Lead', autoMode: true })
  const { task: api } = await core.handlers['vibeflow:createTask']({ projectPath, title: 'API', masterId: master.id })
  const { task: ui } = await core.handlers['vibeflow:createTask']({ projectPath, title: 'UI', masterId: master.id, after: [api.id] })
  await core.handlers['vibeflow:startTask'](master.id)
  await core.handlers['vibeflow:startTask'](api.id)
  // Waiting on a dialog or ending a turn is no news for the master any more.
  sessions.starts.find((s) => s.key === api.id).onExit()
  await new Promise((r) => setTimeout(r, 100))
  assert.equal(sessions.writes.filter((w) => w.key === master.id).length, 0)

  await moveToDone(core, api.id)
  assert.equal(findCard(core, ui.id).column, 'in_progress', 'the waiting card started')
  assert.ok(sessions.starts.some((s) => s.key === ui.id))
  await new Promise((r) => setTimeout(r, 100))
  assert.equal(sessions.writes.filter((w) => w.key === master.id).length, 0, 'not all Done yet')

  await moveToDone(core, ui.id)
  await new Promise((r) => setTimeout(r, 400))
  const toMaster = sessions.writes.filter((w) => w.key === master.id)
  assert.ok(toMaster.length > 0)
  assert.ok(toMaster[0].data.includes('都已完成'))
})

test('without auto mode a waiting card stays in Backlog, and deleting what it waits on frees it', async (t) => {
  const { core } = setup(t)
  const projectPath = await slaveRepo(t)
  const { task: master } = await core.handlers['vibeflow:createTask']({ role: 'master', title: 'Lead', autoMode: false })
  const { task: api } = await core.handlers['vibeflow:createTask']({ projectPath, title: 'API', masterId: master.id })
  const { task: docs } = await core.handlers['vibeflow:createTask']({ projectPath, title: 'Docs', masterId: master.id })
  const { task: ui } = await core.handlers['vibeflow:createTask']({ projectPath, title: 'UI', masterId: master.id, after: [api.id, docs.id] })
  await core.handlers['vibeflow:startTask'](master.id)
  await core.handlers['vibeflow:startTask'](api.id)
  await moveToDone(core, api.id)
  assert.equal(findCard(core, ui.id).column, 'backlog')
  await core.handlers['vibeflow:deleteTask'](docs.id)
  assert.deepEqual(findCard(core, ui.id).task.after, [api.id])
  const summary = (await core.handlers['task:summaries']({ taskId: ui.id }))[0]
  assert.deepEqual(summary.after, [api.id])
})

test('news for a master that is not running is dropped, never typed into a shell', async (t) => {
  process.env.VIBEFLOW_QUIET_MS = '0'
  t.after(() => { delete process.env.VIBEFLOW_QUIET_MS })
  const { core, sessions } = setup(t)
  const projectPath = await slaveRepo(t)
  const { task: master } = await core.handlers['vibeflow:createTask']({ role: 'master', title: 'Lead' })
  const { task: dev } = await core.handlers['vibeflow:createTask']({ projectPath, title: 'Dev', masterId: master.id })
  await core.handlers['vibeflow:startTask'](dev.id)
  sessions.alive.add(master.id)
  await moveToDone(core, dev.id)
  await new Promise((r) => setTimeout(r, 400))
  assert.equal(sessions.writes.filter((w) => w.key === master.id).length, 0, 'the master is still in Backlog')
})

test('a master plans, waits for approval unless in auto mode, dispatches and stops', () => {
  const auto = masterSystemPrompt({ canWrite: true, autoMode: true })
  const manual = masterSystemPrompt({ canWrite: true, autoMode: false })
  for (const prompt of [auto, manual]) {
    assert.ok(prompt.includes('$VIBEFLOW_ARTIFACTS_DIR/plan.md'))
    assert.ok(prompt.includes('--after'))
    assert.ok(prompt.includes('不要輪詢'))
    assert.ok(prompt.includes('結束這一回合'))
    assert.ok(prompt.includes('全部都已完成'))
    assert.ok(prompt.includes('不會合併 PR'))
    assert.ok(prompt.includes('不會把卡片移到 Done'))
    assert.ok(prompt.includes('<id>「<標題>」'))
    assert.ok(!prompt.includes('驗收卡'), 'no relay loop')
    assert.ok(!prompt.includes('pr skill'))
  }
  assert.ok(manual.includes('使用者同意之前不要建任何卡'))
  assert.ok(!auto.includes('使用者同意之前不要建任何卡'))
  assert.ok(auto.includes('VibeFlow 會自動啟動'))
})

test('a master leaves model and effort to Jev unless a card needs a specific one', () => {
  const prompt = masterSystemPrompt({ canWrite: true, autoMode: true })
  assert.ok(prompt.includes('預設不要加 --model / --effort'))
  assert.ok(prompt.includes('Jev'))
})

test('a scout analysis follows the card text in the first prompt only', () => {
  const base = { id: 'abcd1234', title: 'T', description: 'D', worktreePath: '/w', agentCli: 'claude' }
  const preface = { model: 'opus', context: '影響 auth.ts' }
  const first = buildAgentCommand(base, '', { preface })
  assert.ok(first.includes('前置分析（opus，僅供參考）'))
  assert.ok(first.indexOf('任務描述') < first.indexOf('前置分析'))
  assert.ok(!buildAgentCommand(base, '', { preface, resume: true }).includes('前置分析'), 'a resume sends no prompt')
})

test('a running agent nobody re-attached since a host restart is attached before it is typed into', async (t) => {
  const { core, sessions, master, dev, send } = await masterWithCards(t)
  await core.handlers['vibeflow:startTask'](dev.id)
  const attached = new Set()
  sessions.isAttached = (key) => attached.has(key)
  const start = sessions.start.bind(sessions)
  sessions.start = async (key, opts) => {
    attached.add(key)
    return start(key, opts)
  }
  sessions.starts.length = 0
  await send(master, dev)
  const reattach = sessions.starts.find((s) => s.key === dev.id)
  assert.ok(reattach, 'the session was re-attached')
  assert.equal(reattach.command, undefined, 're-attached, not relaunched')
  assert.ok(sessions.writes.some((w) => w.key === dev.id && w.data.includes('hello')))
})

test('continuing a master lists its cards instead of git; continuing a card keeps it a master\'s slave', async (t) => {
  const { core, sessions, master, dev, qa, stray } = await masterWithCards(t)
  const started = (card) => core.handlers['vibeflow:startTask'](card.id).then((r) => r.task)
  await started(master)
  await started(dev)

  const startsBefore = sessions.starts.length
  await core.handlers['vibeflow:continueTask']({ taskId: master.id, force: true })
  const { command: masterCommand } = sessions.starts[startsBefore]
  assert.ok(masterCommand.includes('## 底下的卡片'), masterCommand)
  assert.ok(masterCommand.includes(dev.id) && masterCommand.includes(qa.id), 'both of its cards are listed')
  assert.ok(!masterCommand.includes(stray.id), "another master's card is not")
  assert.ok(!masterCommand.includes('## 分支與程式碼'), 'a master has no git to report')
  assert.ok(masterCommand.includes('你是 VibeFlow 的 Master agent'), 'the master instructions come back with the new session')

  await core.handlers['vibeflow:continueTask']({ taskId: dev.id, force: true })
  const { command: slaveCommand } = sessions.starts.at(-1)
  assert.ok(slaveCommand.includes('## 分支與程式碼'), slaveCommand)
  assert.ok(slaveCommand.includes('--append-system-prompt'), slaveCommand)
  assert.ok(slaveCommand.includes(master.id), 'it still reports to its master')
  assert.ok(!slaveCommand.includes('你是 VibeFlow 的 Master agent'), 'a card never gets the master instructions')
  assert.equal(findCard(core, dev.id).task.masterId, master.id)
})

test('a summary counts the messages still waiting in a card\'s inbox', async (t) => {
  const { core } = setup(t)
  const { task } = await core.handlers['vibeflow:createTask']({ role: 'master', title: 'Inbox count' })
  await core.handlers['pty:start']({ taskId: task.id, launch: {} })
  const { task: running } = findCard(core, task.id)
  const [before] = await core.handlers['task:summaries']({ taskId: task.id })
  assert.equal(before.inbox, undefined)
  postMessage(path.join(running.worktreePath, '.vibeflow-inbox'), 'one')
  postMessage(path.join(running.worktreePath, '.vibeflow-inbox'), 'two')
  const [after] = await core.handlers['task:summaries']({ taskId: task.id })
  assert.equal(after.inbox, 2)
})

test('every card message is recorded per conversation and marked read once typed', async (t) => {
  const { core, master, dev, qa, send } = await masterWithCards(t)
  const events = []
  core.bus.on((channel, payload) => { if (channel === 'messages:changed') events.push(payload) })
  await send(master, dev, 'one')
  await send(master, dev, 'two')
  await send(master, qa, 'three')
  const thread = core.handlers['messages:thread']({ from: master.id, to: dev.id })
  assert.deepEqual(thread.map((m) => [m.text, m.state, m.via]), [['one', 'read', 'typed'], ['two', 'read', 'typed']])
  assert.deepEqual(thread[0].sender, { kind: 'task', id: master.id, title: 'Lead' })
  const threads = core.handlers['messages:threads']().filter((s) => s.from === master.id)
  assert.equal(threads.length, 2)
  assert.deepEqual(threads.map((s) => [s.toTitle, s.total, s.unread]).sort(), [['Dev', 2, 0], ['QA', 1, 0]])
  assert.ok(events.some((e) => e.taskIds.includes(dev.id)))
})

test('an inbox message stays unread until its file is gone, and sendNow types it at once', async (t) => {
  const { core, sessions, master, dev, qa, send } = await masterWithCards(t)
  const { task: started } = await core.handlers['vibeflow:startTask'](master.id)
  const inbox = path.join(started.worktreePath, '.vibeflow-inbox')
  await fs.writeFile(path.join(inbox, '.ready'), '')
  core.handlers['pty:input']({ sessionKey: master.id, data: 'draft' })
  await send(dev, master, 'from dev')
  const [waiting] = core.handlers['messages:thread']({ from: dev.id, to: master.id })
  assert.equal(waiting.state, 'unread')
  assert.ok(waiting.inboxName)
  assert.equal(core.handlers['messages:threads']().find((s) => s.from === dev.id).unread, 1)

  await assert.rejects(core.handlers['messages:sendNow']({ to: master.id, messageId: waiting.id }), (err) => err.code === 'DRAFT_PENDING')

  await fs.rm(path.join(inbox, waiting.inboxName))
  await send(qa, master, 'from qa')
  const [read] = core.handlers['messages:thread']({ from: dev.id, to: master.id })
  assert.deepEqual([read.state, read.via], ['read', 'hook'], 'a hook took it')

  const [fromQa] = core.handlers['messages:thread']({ from: qa.id, to: master.id })
  assert.equal(fromQa.state, 'unread')
  core.handlers['pty:input']({ sessionKey: master.id, data: '\x15' })
  sessions.writes.length = 0
  await core.handlers['messages:sendNow']({ to: master.id, messageId: fromQa.id }).catch(() => {})
  await new Promise((r) => setTimeout(r, 300))
  const [typed] = core.handlers['messages:thread']({ from: qa.id, to: master.id })
  assert.deepEqual([typed.state, typed.via], ['read', 'typed'])
  assert.ok(sessions.writes.some((w) => w.key === master.id && w.data.includes('from qa')))
  await assert.rejects(core.handlers['messages:sendNow']({ to: master.id, messageId: typed.id }), (err) => err.code === 'ALREADY_READ')
})

test('the person writes to a card inside a conversation, framed as the person', async (t) => {
  const { core, sessions, master, dev, stray } = await masterWithCards(t)
  const write = (payload) => core.handlers['messages:send']({ to: dev.id, threadFrom: master.id, text: 'hi there', ...payload })
  const { id } = await write({})
  assert.ok(sessions.writes.some((w) => w.key === dev.id && w.data.includes('<vibeflow from="person">\nhi there')))
  const [mine] = core.handlers['messages:thread']({ from: master.id, to: dev.id })
  assert.equal(mine.id, id)
  assert.deepEqual(mine.sender, { kind: 'person' })
  assert.equal(mine.state, 'read')
  await assert.rejects(write({ threadFrom: stray.id }), (err) => err.code === 'INVALID_REQUEST')
  await assert.rejects(write({ text: '  ' }), (err) => err.code === 'INVALID_REQUEST')
  sessions.alive.delete(dev.id)
  await assert.rejects(write({}), (err) => err.code === 'NOT_RUNNING')
})

test('deleting a card drops the conversations it is part of', async (t) => {
  const { core, master, dev, qa, send } = await masterWithCards(t)
  await send(master, dev, 'to dev')
  await send(dev, master, 'to master')
  await send(master, qa, 'to qa')
  await core.handlers['vibeflow:deleteTask'](dev.id)
  const mine = core.handlers['messages:threads']().filter((s) => [master.id, dev.id, qa.id].includes(s.from))
  assert.deepEqual(mine.map((s) => s.to), [qa.id])
})
