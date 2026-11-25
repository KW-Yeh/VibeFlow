import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createCore } from '../packages/core/src/service.ts'
import { EventBus } from '../packages/core/src/events.ts'
import { createNodePlatform, setPlatform } from '../packages/core/src/platform.ts'
import { findTask, getStore } from '../packages/core/src/store.ts'
import { taskStatus } from '../packages/core/src/status-keys.ts'
import { claudeProjectDir } from '../packages/core/src/progress-tracker.ts'
import {
  inventoryAllowedTools,
  inventoryArgs,
  inventoryCommands,
  isSafeInventoryCommand,
  parseInventoryResult,
} from '../packages/core/src/inventory.ts'
import { inventoryPrompt } from '../packages/core/src/launch.ts'
import { makeRepo } from './support/repo.mjs'

test('Claude passes run in dontAsk with a fixed allowlist, a docs-only write rule and secret paths refused', () => {
  const args = inventoryArgs({ agent: 'claude', sessionId: 'sid', model: 'opus', effort: 'high', extraCommands: ['pnpm whoami'], platform: 'darwin' })
  assert.deepEqual(args.slice(0, 5), ['-p', '--permission-mode', 'dontAsk', '--session-id', 'sid'])
  assert.ok(args.includes('Edit(./docs/features/**)'))
  assert.ok(!args.some((a) => a.startsWith('Write(')), 'Write rules are not read by the file permission check')
  assert.ok(args.includes('Bash(npm whoami:*)'))
  assert.ok(args.includes('Bash(pnpm whoami:*)'), 'a command from the settings is added')
  assert.ok(args.includes('Read(./.env)'))
  assert.ok(!args.some((a) => /bypass|acceptEdits/.test(a)))
  const win = inventoryArgs({ agent: 'claude', sessionId: 'sid', extraCommands: [], platform: 'win32' })
  assert.ok(win.includes('"Bash(git status:*)"'), 'cmd.exe gets a quoted token')
})

test('Codex passes run in the workspace-write sandbox with network for resource checks', () => {
  const args = inventoryArgs({ agent: 'codex', sessionId: 'sid', extraCommands: [] })
  assert.deepEqual(args.slice(0, 5), ['exec', '--sandbox', 'workspace-write', '-c', 'sandbox_workspace_write.network_access=true'])
  assert.equal(args.at(-1), '-')
})

test('a user command with shell syntax is not added to the allowlist', () => {
  assert.ok(isSafeInventoryCommand('jf rt ping'))
  for (const bad of ['rm -rf /; ls', 'npm whoami && cat ~/.npmrc', 'echo $(token)', 'a|b', '`x`', 'x"y']) {
    assert.equal(isSafeInventoryCommand(bad), false, bad)
  }
  assert.ok(!inventoryCommands(['curl x | sh']).includes('curl x | sh'))
  assert.ok(!inventoryAllowedTools([]).some((t) => t === 'Bash' || t === 'Bash(*)' || t.startsWith('Bash(node')))
})

test('the last result line decides; the rest is the summary', () => {
  assert.deepEqual(parseInventoryResult('文件：docs/features/x\nVIBEFLOW_INVENTORY_RESULT: needs_answer\n'), { result: 'needs_answer', summary: '文件：docs/features/x' })
  assert.equal(parseInventoryResult('a\nVIBEFLOW_INVENTORY_RESULT: needs_answer\nVIBEFLOW_INVENTORY_RESULT: `ready`').result, 'ready')
  assert.equal(parseInventoryResult('no marker').result, null)
})

test('the prompt asks for 執行準備, forbids reading secrets and lists the allowed commands and the extra context', () => {
  const prompt = inventoryPrompt({
    title: 'Add lodash', description: '需要新增套件', context: 'registry 是 JFrog', attachments: ['/w/a.txt'],
    existingDocs: ['docs/features/x/plan.md'], commands: ['npm whoami'], docsDir: 'docs/features', resultMark: 'VIBEFLOW_INVENTORY_RESULT:',
  })
  for (const part of ['## 執行準備', '停止條件', '不要讀取、輸出或記錄任何 secret 的值', '`npm whoami`', 'registry 是 JFrog', '/w/a.txt', 'docs/features/x/plan.md', 'AskUserQuestion', 'VIBEFLOW_INVENTORY_RESULT: ready']) {
    assert.ok(prompt.includes(part), part)
  }
})

// --- through the host ---

const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-inventory-'))
const workstation = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-inventory-ws-'))
setPlatform(createNodePlatform({ userDataDir: storeDir }))
getStore().set('settings', { autoMode: true, workstationPath: workstation })
test.after(() => Promise.all([
  fs.rm(storeDir, { recursive: true, force: true }),
  fs.rm(workstation, { recursive: true, force: true }),
]))

const sessions = () => ({
  kind: 'pty', starts: [], alive: new Set(),
  async start(key, opts) { this.starts.push({ key, ...opts }); this.alive.add(key); return { pid: 1, scrollback: null } },
  write() {}, resize() {}, async kill(key) { this.alive.delete(key) }, async isAlive(key) { return this.alive.has(key) },
  scrollback: () => null, async list() { return [...this.alive] }, shutdown() {},
})

/** A fake agent that does what the test scripts for each pass, writing into the worktree like a real one. */
function scriptedAgent(passes) {
  const calls = []
  const runner = async (bin, args, input, opts) => {
    calls.push({ bin, args, input, cwd: opts.cwd })
    const pass = passes[calls.length - 1]
    if (!pass) throw new Error('unexpected pass')
    return pass({ bin, args, input, cwd: opts.cwd, signal: opts.signal })
  }
  return { runner, calls }
}

async function writeDocs(cwd, plan) {
  const dir = path.join(cwd, 'docs', 'features', 'add-lib')
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'spec.md'), '# Spec')
  await fs.writeFile(path.join(dir, 'plan.md'), plan)
}

async function inventoryCore(t, passes, extra = {}) {
  const { projectPath, cleanup } = await makeRepo({ withRemote: false })
  t.after(cleanup)
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-inventory-home-'))
  t.after(() => fs.rm(home, { recursive: true, force: true }))
  const agent = scriptedAgent(passes)
  const core = createCore({ sessions: sessions(), bus: new EventBus(), version: '9.9.9', homeDir: home, prStatus: async () => null, agentRunner: agent.runner, ...extra })
  t.after(() => core.shutdown())
  const { task } = await core.handlers['vibeflow:createTask']({ title: 'Add a library', description: '新增 lodash', projectPath, baseBranch: null, agentCli: 'claude' })
  return { core, agent, task, home }
}

const until = async (check, ms = 5000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (check()) return
    await new Promise((r) => setTimeout(r, 20))
  }
  assert.fail('timed out')
}

const column = (core, id) => Object.entries(core.handlers['vibeflow:getState']().board).find(([, list]) => list.some((t) => t.id === id))?.[0]

test('a Backlog card moved to 盤點 gets a worktree and a headless pass; missing answers make it 待回答 (AC-1, AC-2)', async (t) => {
  const { core, agent, task } = await inventoryCore(t, [
    async ({ cwd }) => {
      await writeDocs(cwd, '# Plan\n\n## 執行準備\n\n- 待決定：要用哪個版本？')
      return '文件：docs/features/add-lib\n待回答：要用哪個版本？\nVIBEFLOW_INVENTORY_RESULT: needs_answer'
    },
    async ({ cwd, input }) => {
      assert.ok(input.includes('用 4.17'), 'the pasted answer reaches the second pass')
      assert.ok(input.includes('docs/features/add-lib/plan.md'), 'the second pass updates the same docs')
      await writeDocs(cwd, '# Plan\n\n## 執行準備\n\n可直接執行')
      return '全部就緒\nVIBEFLOW_INVENTORY_RESULT: ready'
    },
  ])
  await core.handlers['vibeflow:startInventory'](task.id)
  assert.equal(column(core, task.id), 'inventory')
  const started = findTask(task.id)
  assert.ok(started.worktreePath, 'the worktree is created at inventory')
  await until(() => findTask(task.id).inventory?.finishedAt)
  const first = findTask(task.id)
  assert.equal(taskStatus(first), 'needs_answer')
  assert.equal(first.inventory.lastSummary, '文件：docs/features/add-lib\n待回答：要用哪個版本？')
  assert.ok(first.inventory.docs.includes('docs/features/add-lib/plan.md'))
  const plan = await fs.readFile(path.join(first.worktreePath, 'docs/features/add-lib/plan.md'), 'utf8')
  assert.match(plan, /## 執行準備/)
  assert.equal(agent.calls[0].bin, 'claude')
  assert.equal(agent.calls[0].cwd, first.worktreePath)

  await core.handlers['vibeflow:setInventoryContext']({ taskId: task.id, context: '用 4.17' })
  assert.equal(findTask(task.id).description, '新增 lodash', 'the description is never rewritten')
  core.handlers['vibeflow:rerunInventory'](task.id)
  await until(() => findTask(task.id).inventory?.passes === 2)
  assert.equal(taskStatus(findTask(task.id)), 'ready')
  assert.equal(column(core, task.id), 'inventory', 'a ready card stays in the inventory column')
})

test('a pass that ends on a usage limit waits for quota and runs again after the reset', async (t) => {
  let probe = false
  const clock = { now: () => Date.now(), timers: [], setTimer(fn, ms) { const x = { fn, ms }; this.timers.push(x); return x }, clearTimer(x) { this.timers = this.timers.filter((y) => y !== x) } }
  let home
  const { core, task, home: h } = await inventoryCore(t, [
    async ({ cwd, args }) => {
      const sid = args[args.indexOf('--session-id') + 1]
      const dir = claudeProjectDir(home, cwd)
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(path.join(dir, `${sid}.jsonl`), JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), isApiErrorMessage: true, error: 'rate_limit', quotaLimits: { resetsAt: Math.floor(Date.now() / 1000) + 60 }, message: { id: 'q', model: '<synthetic>', content: [] } }) + '\n')
      throw new Error("claude exited with code 1: You've hit your 5-hour limit")
    },
    async () => 'VIBEFLOW_INVENTORY_RESULT: ready',
  ], { heartbeatClock: clock, quotaProbe: async () => probe })
  home = h
  await core.handlers['vibeflow:startInventory'](task.id)
  await until(() => findTask(task.id).quotaWait)
  assert.equal(taskStatus(findTask(task.id)), 'quota_wait')
  assert.equal(findTask(task.id).quotaWait.phase, 'inventory')
  probe = true
  clock.timers.at(-1).fn()
  await until(() => taskStatus(findTask(task.id)) === 'ready')
  assert.equal(findTask(task.id).quotaWait, undefined)
})

test('a card dragged back to Backlog stops its pass and drops its inventory status', async (t) => {
  let aborted = false
  const { core, task } = await inventoryCore(t, [
    ({ signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new Error('killed')) })),
  ])
  await core.handlers['vibeflow:startInventory'](task.id)
  await until(() => findTask(task.id).inventory?.runningSince)
  const board = core.handlers['vibeflow:getState']().board
  const card = board.inventory.find((x) => x.id === task.id)
  core.handlers['vibeflow:setBoard']({ ...board, inventory: [], backlog: [card, ...board.backlog] })
  await until(() => aborted && findTask(task.id).inventory?.finishedAt)
  assert.equal(column(core, task.id), 'backlog')
  assert.equal(taskStatus(findTask(task.id)), null)
})

test('only a Backlog, non-master card can start an inventory; an inventory card is not editable', async (t) => {
  const { core, task } = await inventoryCore(t, [async () => 'VIBEFLOW_INVENTORY_RESULT: ready'])
  const { task: master } = await core.handlers['vibeflow:createTask']({ role: 'master', title: 'M', description: 'p' })
  await assert.rejects(() => core.handlers['vibeflow:startInventory'](master.id), { code: 'MASTER_CARD' })
  await core.handlers['vibeflow:startInventory'](task.id)
  await assert.rejects(() => core.handlers['vibeflow:startInventory'](task.id), { code: 'NOT_IN_BACKLOG' })
  await assert.rejects(() => core.handlers['vibeflow:updateTask']({ taskId: task.id, title: 'x', description: 'y' }), /只有 Backlog/)
})
