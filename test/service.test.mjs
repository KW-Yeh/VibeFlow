import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createCore } from '../packages/core/src/service.ts'
import { EventBus } from '../packages/core/src/events.ts'
import { createNodePlatform, setPlatform } from '../packages/core/src/platform.ts'
import { getStore } from '../packages/core/src/store.ts'
import { createTaskFromInput } from '../packages/core/src/tasks.ts'
import { executorSessionId } from '../packages/core/src/launch.ts'
import { claudeProjectDir } from '../packages/core/src/progress-tracker.ts'
import { exists, git, makeRepo, writeFile } from './support/repo.mjs'

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

async function coreWithTask(t, { coreOptions = {}, task: taskInput = {} } = {}) {
  const { projectPath, cleanup } = await makeRepo({ withRemote: false })
  t.after(cleanup)
  const sessions = fakeSessions()
  const bus = new EventBus()
  const core = createCore({ sessions, bus, version: '9.9.9', ...coreOptions })
  // pty:start watches the worktree for sub-agent files; stop it with the test.
  t.after(() => core.shutdown())
  const { task } = await core.handlers['vibeflow:createTask']({
    title: 'Service card',
    description: 'check the launch',
    projectPath,
    baseBranch: null,
    agentCli: 'claude',
    ...taskInput,
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
  const launched = core.handlers['vibeflow:getState']().board.backlog.find((t2) => t2.id === task.id)
  assert.equal(start.key, task.id)
  assert.ok(launched.worktreePath, 'the launch provisioned the worktree')
  assert.equal(start.cwd, launched.worktreePath)
  assert.match(start.command, /^export VIBEFLOW_TASK_ID=/)
  assert.match(start.command, /claude --session-id [0-9a-f-]{36} /)
  assert.ok(!start.command.includes('rm -rf'))
  assert.ok(!start.command.endsWith('\r'), 'the typing CR is stripped for -c')
})

test('a shell start has no command', async (t) => {
  const { core, sessions, task } = await coreWithTask(t)
  await core.handlers['pty:start']({ taskId: task.id, launch: {} })
  await core.handlers['pty:start']({ taskId: task.id, sessionKey: `${task.id}:2` })
  assert.equal(sessions.starts[1].command, undefined)
})

test('a shell is refused before the card has a worktree, never run in the project checkout', async (t) => {
  const { core, sessions, task } = await coreWithTask(t)
  await assert.rejects(core.handlers['pty:start']({ taskId: task.id }), /還沒有 worktree/)
  assert.equal(sessions.starts.length, 0)
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

/** A model catalog that answers from memory and records what it was asked. */
function fakeCatalog(models) {
  const calls = []
  const list = (source) => ({ models, source })
  return {
    calls,
    async get(id) { calls.push(['get', id]); return list('builtin') },
    async refresh(id) { calls.push(['refresh', id]); return list('claude-cli') },
    warm() { calls.push(['warm']) },
    findModel(id, modelId) {
      if (id !== 'claude') return undefined
      return modelId ? models.find((m) => m.id === modelId) : models.find((m) => m.isDefault)
    },
  }
}

const catalogModels = [
  { id: 'claude-opus-4-6', label: 'Opus 4.6', efforts: ['low', 'medium', 'high', 'max'] },
  { id: 'haiku', label: 'Haiku 4.5', efforts: [] },
  { id: 'sonnet', label: 'Sonnet 5.5', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'opus', label: 'Opus 5.5', efforts: ['low', 'medium', 'high', 'xhigh'], isDefault: true },
]

test('agents:listModels reads the catalog, and only a refresh asks the CLI', async (t) => {
  const catalog = fakeCatalog(catalogModels)
  const { core } = await coreWithTask(t, { coreOptions: { modelCatalog: catalog } })
  assert.equal((await core.handlers['agents:listModels']({ agentId: 'claude' })).source, 'builtin')
  assert.equal((await core.handlers['agents:listModels']({ agentId: 'claude', refresh: true })).source, 'claude-cli')
  assert.deepEqual(catalog.calls, [['get', 'claude'], ['refresh', 'claude']])
})

test('createCore does not ask any agent CLI by itself', async (t) => {
  const catalog = fakeCatalog(catalogModels)
  const { core } = await coreWithTask(t, { coreOptions: { modelCatalog: catalog } })
  assert.deepEqual(catalog.calls, [])
  core.warmModelCatalog()
  assert.deepEqual(catalog.calls, [['warm']])
})

async function launchedCommand(t, taskInput) {
  const { core, sessions, task } = await coreWithTask(t, {
    coreOptions: { modelCatalog: fakeCatalog(catalogModels) },
    task: taskInput,
  })
  await core.handlers['pty:start']({ taskId: task.id, launch: {} })
  const stored = core.handlers['vibeflow:getState']().board.backlog.find((t2) => t2.id === task.id)
  return { command: sessions.starts[0].command, stored }
}

test('a launch lowers an effort the model does not accept, leaving the card as picked', async (t) => {
  const { command, stored } = await launchedCommand(t, { model: 'claude-opus-4-6', effort: 'xhigh' })
  assert.match(command, /--model claude-opus-4-6 --effort high /)
  assert.equal(stored.effort, 'xhigh')
})

test('a launch sends no effort to a model that takes none', async (t) => {
  const { command } = await launchedCommand(t, { model: 'haiku', effort: 'high' })
  assert.match(command, /--model haiku /)
  assert.ok(!command.includes('--effort'))
})

test('a launch without a picked model leaves the model to the CLI and fits the effort to its default', async (t) => {
  const { command } = await launchedCommand(t, { effort: 'ultra' })
  assert.ok(!command.includes('--model'), command)
  assert.match(command, /--effort xhigh /)
})

test('a launch passes the effort through when the model is unknown', async (t) => {
  const { command } = await launchedCommand(t, { model: 'claude-custom-1', effort: 'max' })
  assert.match(command, /--model claude-custom-1 --effort max /)
})

test('updateTask rejects an unknown effort', async (t) => {
  const { core, task } = await coreWithTask(t)
  await assert.rejects(
    core.handlers['vibeflow:updateTask']({ taskId: task.id, title: 'x', effort: 'turbo' }),
    { code: 'INVALID_REQUEST' }
  )
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

test('library built-in handlers validate input and use the registered shipped dir', async (t) => {
  const shipped = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-service-builtin-'))
  t.after(() => {
    setPlatform(createNodePlatform({ userDataDir: storeDir }))
    return fs.rm(shipped, { recursive: true, force: true })
  })
  await fs.mkdir(path.join(shipped, 'probe'))
  await fs.writeFile(path.join(shipped, 'probe', 'SKILL.md'), '---\nname: probe\ndescription: p\n---\n')
  setPlatform(createNodePlatform({ userDataDir: storeDir, builtinSkillsDir: shipped }))
  const core = createCore({ sessions: fakeSessions(), bus: new EventBus(), version: '9.9.9' })
  t.after(() => core.shutdown())

  assert.deepEqual(await core.handlers['library:removedBuiltins'](), [])
  await assert.rejects(core.handlers['library:restoreBuiltin']({ name: 42 }), { code: 'INVALID_REQUEST' })
  await assert.rejects(core.handlers['library:restoreBuiltin']({ name: '../etc' }), /內建/)

  const entry = await core.handlers['library:restoreBuiltin']({ name: 'probe' })
  assert.equal(entry.name, 'probe')
  assert.deepEqual(entry.builtin, { modified: false, updateAvailable: false })
  const listed = (await core.handlers['library:list']()).find((e) => e.name === 'probe')
  assert.deepEqual(listed.builtin, { modified: false, updateAvailable: false })

  await core.handlers['library:delete']({ kind: 'skill', name: 'probe' })
  assert.deepEqual(await core.handlers['library:removedBuiltins'](), ['probe'])
})

// Every repo here is named `project`, so cards share one workstation folder.
let lazyCards = 0

async function coreWithRemoteTask(t, extra = {}) {
  const branch = `feature/lazy-card-${++lazyCards}`
  const repo = await makeRepo()
  t.after(repo.cleanup)
  const sessions = fakeSessions()
  const core = createCore({ sessions, bus: new EventBus(), version: '9.9.9' })
  t.after(() => core.shutdown())
  const { task } = await core.handlers['vibeflow:createTask']({
    title: 'Lazy card',
    projectPath: repo.projectPath,
    baseBranch: null,
    branch,
    ...extra,
  })
  return { core, sessions, task, branch, ...repo }
}

const cardIn = (core, col, id) =>
  core.handlers['vibeflow:getState']().board[col].find((t2) => t2.id === id)

test('the branch is cut from the base as it is at launch, then pushed', async (t) => {
  const { core, task, branch, projectPath, remotePath, root } = await coreWithRemoteTask(t)
  // origin/main moves on while the card waits in Backlog.
  const other = path.join(root, 'other')
  await git(root, 'clone', remotePath, other)
  await git(other, 'config', 'user.email', 'qa@vibeflow.test')
  await git(other, 'config', 'user.name', 'VibeFlow QA')
  await fs.writeFile(path.join(other, 'later.txt'), 'later\n')
  await git(other, 'add', '-A')
  await git(other, 'commit', '-m', 'later')
  await git(other, 'push', 'origin', 'main')
  const latest = await git(other, 'rev-parse', 'HEAD')

  assert.equal(await git(projectPath, 'branch', '--list', branch), '')
  await core.handlers['pty:start']({ taskId: task.id, launch: {} })

  const launched = cardIn(core, 'backlog', task.id)
  assert.equal(launched.pushed, true)
  assert.equal(typeof launched.provisionedAt, 'number')
  assert.equal(await git(launched.worktreePath, 'rev-parse', 'HEAD'), latest)
  assert.match(await git(remotePath, 'branch', '--list', branch), new RegExp(branch))
})

test('two launches at once provision one worktree', async (t) => {
  const { core, sessions, task } = await coreWithRemoteTask(t)
  await Promise.all([
    core.handlers['pty:start']({ taskId: task.id, launch: {} }),
    core.handlers['pty:start']({ taskId: task.id, sessionKey: `${task.id}:2` }),
  ])
  assert.equal(sessions.starts.length, 2)
  assert.equal(sessions.starts[0].cwd, sessions.starts[1].cwd)
})

test('a launch that cannot provision sends the card back to Backlog unstarted', async (t) => {
  const { core, task, branch, projectPath } = await coreWithRemoteTask(t)
  core.handlers['vibeflow:setBoard']({
    backlog: [],
    in_progress: [{ ...task, launchedAt: 1 }],
    done: [],
  })
  // Someone takes the name while the card waits.
  await git(projectPath, 'branch', branch)

  await assert.rejects(core.handlers['pty:start']({ taskId: task.id, launch: {} }), {
    code: 'BRANCH_ALREADY_EXISTS',
  })
  const back = cardIn(core, 'backlog', task.id)
  assert.ok(back)
  assert.equal(back.launchedAt, undefined)
  assert.equal(back.worktreePath, undefined)
  assert.match(back.launchError, /本地已有同名分支/)
})

test('only a Backlog card can be edited', async (t) => {
  const { core, task, branch } = await coreWithRemoteTask(t)
  core.handlers['vibeflow:setBoard']({ backlog: [], in_progress: [task], done: [] })
  await assert.rejects(
    core.handlers['vibeflow:updateTask']({ taskId: task.id, title: 'changed' }),
    /只有 Backlog/
  )
})

test('renaming an unprovisioned card only rewrites the store', async (t) => {
  const { core, task, branch, projectPath } = await coreWithRemoteTask(t)
  await core.handlers['vibeflow:updateTask']({ taskId: task.id, title: task.title, branch: `${branch}-renamed` })
  const renamed = cardIn(core, 'backlog', task.id)
  assert.equal(renamed.branch, `${branch}-renamed`)
  assert.equal(renamed.branchExplicit, true)
  assert.equal(await git(projectPath, 'branch', '--list', 'feature/*'), '')
  await assert.rejects(
    core.handlers['vibeflow:updateTask']({ taskId: task.id, title: task.title, branch: 'bad..name' }),
    { code: 'INVALID_BRANCH_NAME' }
  )
})

test('renaming a provisioned Backlog card gives up its clean worktree', async (t) => {
  const { core, task, branch, projectPath } = await coreWithRemoteTask(t)
  await core.handlers['pty:start']({ taskId: task.id, launch: {} })
  const { worktreePath } = cardIn(core, 'backlog', task.id)

  await core.handlers['vibeflow:updateTask']({ taskId: task.id, title: task.title, branch: `${branch}-renamed` })

  const renamed = cardIn(core, 'backlog', task.id)
  assert.equal(renamed.worktreePath, undefined)
  assert.equal(renamed.launchedAt, undefined)
  assert.equal(await exists(worktreePath), false)
  assert.equal(await git(projectPath, 'branch', '--list', branch), '')
})

test('a provisioned Backlog card with changes keeps its branch', async (t) => {
  const { core, task, branch } = await coreWithRemoteTask(t)
  await core.handlers['pty:start']({ taskId: task.id, launch: {} })
  const { worktreePath } = cardIn(core, 'backlog', task.id)
  await writeFile(worktreePath, 'work.txt', 'work\n')

  await assert.rejects(
    core.handlers['vibeflow:updateTask']({ taskId: task.id, title: task.title, branch: `${branch}-renamed` }),
    /已有變更/
  )
  assert.equal(cardIn(core, 'backlog', task.id).branch, branch)
})

test('dialog:pickFolder asks the host platform, and a second request joins the open dialog', async (t) => {
  t.after(() => setPlatform(createNodePlatform({ userDataDir: storeDir })))
  const calls = []
  let answer
  setPlatform({
    ...createNodePlatform({ userDataDir: storeDir }),
    pickFolder: (opts) => {
      calls.push(opts)
      return new Promise((resolve) => (answer = resolve))
    },
  })
  const core = createCore({ sessions: fakeSessions(), bus: new EventBus(), version: '9.9.9' })
  t.after(() => core.shutdown())

  const first = core.handlers['dialog:pickFolder']({ title: '選擇專案資料夾' })
  const second = core.handlers['dialog:pickFolder']()
  answer({ path: '/picked' })
  assert.deepEqual(await first, { path: '/picked' })
  assert.deepEqual(await second, { path: '/picked' })
  assert.deepEqual(calls, [{ title: '選擇專案資料夾', defaultPath: undefined }])
  assert.throws(() => core.handlers['dialog:pickFolder']({ title: 42 }), { code: 'INVALID_REQUEST' })
})

test('dialog:pickFolder reports unsupported when the host has no dialog', async (t) => {
  t.after(() => setPlatform(createNodePlatform({ userDataDir: storeDir })))
  const { pickFolder: _none, ...headless } = createNodePlatform({ userDataDir: storeDir })
  setPlatform(headless)
  const core = createCore({ sessions: fakeSessions(), bus: new EventBus(), version: '9.9.9' })
  t.after(() => core.shutdown())
  assert.deepEqual(await core.handlers['dialog:pickFolder'](), { unsupported: true })
})

test('a CLI card that never launched still shows its spec after its PR is merged and the branch deleted', async (t) => {
  const repo = await makeRepo()
  t.after(repo.cleanup)
  const { projectPath, remotePath, root } = repo
  const core = createCore({ sessions: fakeSessions(), bus: new EventBus(), version: '9.9.9' })
  t.after(() => core.shutdown())
  const { task } = await createTaskFromInput({
    projectPath,
    title: 'CLI card',
    branch: 'feature/cli-card',
    status: 'in_progress',
  })
  assert.equal(task.launchedAt, undefined)
  assert.equal(typeof task.provisionedAt, 'number')

  await writeFile(task.worktreePath, 'docs/features/cli/spec.md', '# cli decisions\n')
  await git(task.worktreePath, 'add', '-A')
  await git(task.worktreePath, 'commit', '-m', 'spec')
  await git(task.worktreePath, 'push', 'origin', 'feature/cli-card')
  await core.handlers['vibeflow:cleanupTask'](task.id)
  assert.equal(await git(projectPath, 'branch', '--list', 'feature/cli-card'), '')

  const other = path.join(root, 'merger')
  await git(root, 'clone', remotePath, other)
  await git(other, 'config', 'user.email', 'qa@vibeflow.test')
  await git(other, 'config', 'user.name', 'VibeFlow QA')
  await git(other, 'merge', '--no-ff', '-m', 'Merge pull request #3 from acme/feature/cli-card', 'origin/feature/cli-card')
  await git(other, 'push', 'origin', 'main')
  await git(other, 'push', 'origin', '--delete', 'feature/cli-card')
  await git(projectPath, 'fetch', '--prune', 'origin')

  const specs = await core.handlers['task:getSpecs'](task.id)
  assert.deepEqual(specs.map((s) => s.markdown.trim()), ['# cli decisions'])
})

// --- progress ---

const PROGRESS_FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'progress', 'claude-todowrite.jsonl')

/** A core whose agent transcripts live under a throwaway home, plus one launched card. */
async function coreWithProgress(t) {
  const { projectPath, cleanup } = await makeRepo({ withRemote: false })
  t.after(cleanup)
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-service-home-'))
  t.after(() => fs.rm(home, { recursive: true, force: true }))
  const bus = new EventBus()
  const events = []
  bus.on((channel, payload) => events.push({ channel, payload }))
  const core = createCore({ sessions: fakeSessions(), bus, version: '9.9.9', homeDir: home })
  t.after(() => core.shutdown())
  const { task: created } = await createTaskFromInput({ projectPath, title: 'Progress card', status: 'in_progress' })
  // The renderer stamps launchedAt when it starts a card; the fixture was recorded 2026-10-05.
  const launchedAt = Date.parse('2026-10-05T14:00:00Z')
  const state = getStore().get('board')
  getStore().set('board', {
    ...state,
    in_progress: state.in_progress.map((t) => (t.id === created.id ? { ...t, launchedAt } : t)),
  })
  const task = { ...created, launchedAt }
  const dir = claudeProjectDir(home, task.worktreePath)
  await fs.mkdir(dir, { recursive: true })
  const transcript = path.join(dir, `${executorSessionId(task.id, task.runId)}.jsonl`)
  const lines = (await fs.readFile(PROGRESS_FIXTURE, 'utf8')).split('\n').filter(Boolean)
  return { core, task, events, transcript, lines }
}

const writeLines = (file, lines) => fs.appendFile(file, lines.map((l) => l + '\n').join(''))

test('progress:get — validates the task id; null before there is a transcript', async (t) => {
  const { core, task } = await coreWithProgress(t)
  await assert.rejects(Promise.resolve().then(() => core.handlers['progress:get']('nope')))
  assert.equal(await core.handlers['progress:get'](task.id), null)
})

test('progress — a launch follows the card and pushes progress:update', async (t) => {
  const { core, task, events, transcript, lines } = await coreWithProgress(t)
  await writeLines(transcript, lines)
  await core.handlers['pty:start']({ taskId: task.id, launch: {} })
  const update = events.find((e) => e.channel === 'progress:update')
  assert.ok(update, 'progress:update emitted')
  assert.equal(update.payload.taskId, task.id)
  assert.equal(update.payload.progress.todos.length, 3)
  const now = await core.handlers['progress:get'](task.id)
  assert.equal(now.totalUsage.output, 2364)
})

test('progress — notifications follow settings.notifications', async (t) => {
  const { core, task, events, transcript, lines } = await coreWithProgress(t)
  const writes = lines.map((l, i) => (l.includes('"TodoWrite"') ? i : -1)).filter((i) => i >= 0)
  await writeLines(transcript, lines.slice(0, writes[1] + 1))
  await core.handlers['progress:get'](task.id)
  core.handlers['vibeflow:setSettings']({ notifications: { stepCompleted: true } })
  await writeLines(transcript, lines.slice(writes[1] + 1, writes[2] + 1))
  await core.handlers['progress:get'](task.id)
  const notes = events.filter((e) => e.channel === 'progress:notify')
  assert.equal(notes.length, 1)
  assert.equal(notes[0].payload.title, 'Progress card')
  assert.deepEqual(notes[0].payload.notifications.map((n) => n.kind), ['step_completed'])

  core.handlers['vibeflow:setSettings']({ notifications: { enabled: false } })
  await writeLines(transcript, lines.slice(writes[2] + 1))
  await core.handlers['progress:get'](task.id)
  assert.equal(events.filter((e) => e.channel === 'progress:notify').length, 1, 'master switch off')
  const stored = getStore().get('settings').notifications
  assert.deepEqual(stored, { enabled: false, stepCompleted: true, allCompleted: true, waitingInput: true, desktop: false })
  core.handlers['vibeflow:setSettings']({ notifications: undefined })
})

test('progress — restart and completion fold the run into Task.usage', async (t) => {
  const { core, task, transcript, lines } = await coreWithProgress(t)
  await writeLines(transcript, lines)
  await core.handlers['pty:start']({ taskId: task.id, launch: {} })
  const { task: reset } = await core.handlers['vibeflow:resetTaskRun'](task.id)
  assert.equal(reset.usage.output, 2364, 'first run kept after restart')
  assert.notEqual(reset.runId, task.runId)
  // The second run writes nothing yet; completing keeps the first run's tokens.
  await core.handlers['vibeflow:cleanupTask'](task.id)
  const done = getStore().get('board').in_progress.find((t) => t.id === task.id)
  assert.equal(done.usage.output, 2364)
  assert.equal(done.worktreePath, undefined)
  assert.equal(await core.handlers['progress:get'](task.id), null)
})

test('a card converted from GitHub keeps its source ref; a ref outside github.com is refused', async (t) => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: false })
  t.after(cleanup)
  const core = createCore({ sessions: fakeSessions(), bus: new EventBus(), version: '9.9.9' })
  t.after(() => core.shutdown())
  const github = { kind: 'issue', repo: 'acme/demo', number: 42, url: 'https://github.com/acme/demo/issues/42' }

  const { task } = await core.handlers['vibeflow:createTask']({
    title: 'From issue', projectPath, baseBranch: null, github,
  })
  assert.deepEqual(task.github, github)
  // What is on disk is what a restarted app reads back.
  const stored = getStore().get('board').backlog.find((c) => c.id === task.id)
  assert.deepEqual(stored.github, github)

  await assert.rejects(
    core.handlers['vibeflow:createTask']({
      title: 'Bad', projectPath, baseBranch: null,
      github: { ...github, url: 'https://evil.example/acme/demo/issues/42' },
    }),
    { code: 'INVALID_REQUEST' }
  )
})

test('github:inbox reads the board projects\' GitHub origins through the injected gh', async (t) => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: false })
  t.after(cleanup)
  await git(projectPath, 'remote', 'add', 'origin', 'https://github.com/acme/demo.git')
  const calls = []
  const core = createCore({
    sessions: fakeSessions(),
    bus: new EventBus(),
    version: '9.9.9',
    githubAuthStatus: async () => ({ installed: true, authenticated: true, login: 'me' }),
    ghRunner: async (args) => {
      calls.push(args)
      if (args[0] === 'issue' && args.includes('--assignee')) {
        return JSON.stringify([{ number: 7, title: 'Fix it', url: 'https://github.com/acme/demo/issues/7', createdAt: '2026-10-01T00:00:00Z' }])
      }
      return '[]'
    },
  })
  t.after(() => core.shutdown())
  await core.handlers['vibeflow:createTask']({ title: 'Card', projectPath, baseBranch: null })

  const inbox = await core.handlers['github:inbox']()
  assert.equal(inbox.status, 'ok')
  const repo = inbox.repos.find((r) => r.repo === 'acme/demo')
  assert.equal(repo.projectPath, projectPath)
  assert.deepEqual(repo.issues.map((i) => i.number), [7])
  assert.ok(calls.every((args) => args.includes('acme/demo')))

  await assert.rejects(core.handlers['github:inbox']('force'), { code: 'INVALID_REQUEST' })
})
