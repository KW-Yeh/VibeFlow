// End-to-end: the Web UI's main flow against a real core host, driven by
// Playwright, with a fake agent CLI in place of claude.
//
//   npm run build:web && npm run test:e2e
//
// The GitHub CLI is replaced too (e2e/fake-gh.mjs), so the Issues & PRs view
// runs on fixed Issues/PRs without the network — on macOS and Linux only: core
// spawns `gh` without a shell, which on Windows resolves only .exe/.com, so a
// script on PATH cannot stand in for the runner's own gh.exe.
//
// Uses a browser that is already installed (Edge on Windows, Chrome
// elsewhere) through playwright-core, so no browser download is needed.
// Override with VIBEFLOW_E2E_BROWSER=<channel> or
// VIBEFLOW_E2E_EXECUTABLE=<path>. Skipped when no browser can be launched.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'
import { makeRepo, git } from '../test/support/repo.mjs'
import { createCore } from '../packages/core/src/service.ts'
import { EventBus } from '../packages/core/src/events.ts'
import { createNodePlatform, setPlatform } from '../packages/core/src/platform.ts'
import { getStore } from '../packages/core/src/store.ts'
import { startWebServer } from '../packages/core/src/web-server.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const webDir = path.join(root, 'app')

/**
 * The fake agent: announce, change a file, then echo what the user types.
 * `-p` is the host asking for the model catalog at startup instead.
 */
const FAKE_AGENT = `#!/bin/sh
if [ "$1" = "-p" ]; then NODE_OPTIONS= exec "${process.execPath}" "${path.join(root, 'e2e', 'fake-claude-models.mjs')}"; fi
echo "fake-claude ready"
echo "written by the fake agent" > fake-agent-output.txt
while read -r line; do echo "got:$line"; done
`

async function launchBrowser() {
  const channel =
    process.env.VIBEFLOW_E2E_BROWSER ?? (process.platform === 'win32' ? 'msedge' : 'chrome')
  const executablePath = process.env.VIBEFLOW_E2E_EXECUTABLE
  try {
    return await chromium.launch(executablePath ? { executablePath } : { channel })
  } catch (err) {
    return { error: err }
  }
}

function waitForLock(storeDir, timeoutMs = 30_000) {
  const file = path.join(storeDir, 'core.lock')
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const tick = () => {
      try {
        const lock = JSON.parse(fs.readFileSync(file, 'utf8'))
        if (lock.port) return resolve(lock)
      } catch {}
      if (Date.now() > deadline) return reject(new Error('host did not start'))
      setTimeout(tick, 200)
    }
    tick()
  })
}

async function waitForTerminal(page, needle, timeout = 30_000) {
  await page.waitForFunction(
    (n) => Array.from(document.querySelectorAll('.xterm-rows')).some((r) => r.textContent.includes(n)),
    needle,
    { timeout }
  )
}

const canFakeGh = process.platform !== 'win32'
const hasWeb = fs.existsSync(path.join(webDir, 'home', 'index.html'))

test('Web UI: create, start, type, diff, approve, finish', { skip: !hasWeb && 'run npm run build:web first', timeout: 180_000 }, async (t) => {
  const browser = await launchBrowser()
  if (browser.error) {
    t.skip(`no browser: ${browser.error.message.split('\n')[0]}`)
    return
  }
  t.after(() => browser.close())

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-e2e-'))
  const storeDir = path.join(tmp, 'store')
  const workstation = path.join(tmp, 'ws')
  const fakeBin = path.join(tmp, 'bin')
  // A private HOME: the user's shell rc cannot reorder PATH, and nothing
  // touches their real ~/.claude.
  const home = path.join(tmp, 'home')
  for (const d of [storeDir, workstation, fakeBin, home]) fs.mkdirSync(d, { recursive: true })
  fs.writeFileSync(path.join(fakeBin, 'claude'), FAKE_AGENT, { mode: 0o755 })
  if (canFakeGh) {
    // No codex in this run, whatever the machine has installed.
    fs.writeFileSync(path.join(fakeBin, 'codex'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
    fs.writeFileSync(
      path.join(fakeBin, 'gh'),
      `#!/bin/sh\nexec "${process.execPath}" "${path.join(root, 'e2e', 'fake-gh.mjs')}" "$@"\n`,
      { mode: 0o755 }
    )
  }
  fs.writeFileSync(
    path.join(storeDir, 'vibeflow-state.json'),
    JSON.stringify({
      version: 4,
      projectPath: null,
      board: { backlog: [], in_progress: [], done: [] },
      settings: { autoMode: true, workstationPath: workstation },
    })
  )
  const { projectPath, remotePath, cleanup } = await makeRepo({ withRemote: true })

  const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH'
  const host = spawn(
    process.execPath,
    [
      '--experimental-strip-types',
      '--no-warnings',
      '--import',
      pathToFileURL(path.join(root, 'test', 'support', 'register.mjs')).href,
      path.join(root, 'packages', 'cli', 'src', 'bin.ts'),
      '--store-path',
      storeDir,
      '--backend',
      'pty',
      '--no-open',
    ],
    {
      env: {
        ...process.env,
        [pathKey]: `${fakeBin}${path.delimiter}${process.env[pathKey]}`,
        HOME: home,
        VIBEFLOW_WEB_DIR: webDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  )
  let hostLog = ''
  host.stdout.on('data', (d) => (hostLog += d))
  host.stderr.on('data', (d) => (hostLog += d))
  t.after(async () => {
    host.kill()
    await cleanup()
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  const lock = await waitForLock(storeDir)
  const base = `http://127.0.0.1:${lock.port}`
  const page = await browser.newPage()
  await page.goto(`${base}/home/?token=${encodeURIComponent(lock.token)}`)
  assert.equal(new URL(page.url()).search, '', 'the token leaves the address bar')

  if (canFakeGh) {
    // Models: the host asked the (fake) claude CLI at startup; the picker
    // offers what it answered, and codex falls back without a CLI.
    await page.waitForFunction(async () => {
      const [claude, codex] = await Promise.all([
        window.vibeflow.listAgentModels('claude'),
        window.vibeflow.listAgentModels('codex'),
      ])
      return claude.source === 'claude-cli' && !codex.pending
    }, null, { timeout: 20_000, polling: 250 })
    const codex = await page.evaluate(() => window.vibeflow.listAgentModels('codex'))
    assert.notEqual(codex.source, 'codex-app-server')
    await page.getByRole('button', { name: 'Advanced' }).click()
    const modelSelect = page.locator('select[name="agent-model"]')
    await modelSelect.locator('option', { hasText: 'Fable 5.1' }).waitFor({ state: 'attached' })
    assert.equal(await modelSelect.locator('option[value="default"]').count(), 0)
    await page.getByRole('button', { name: 'Advanced' }).click()
  }

  // Create: typed project path (the browser has no folder dialog), title.
  await page.getByLabel('輸入專案資料夾路徑').fill(projectPath)
  await page.getByLabel('輸入專案資料夾路徑').press('Enter')
  await page.getByPlaceholder('例如：實作登入頁面').fill('E2E card')
  await page.getByRole('button', { name: '建立任務' }).click()
  await page.getByText('E2E card').first().waitFor()

  // Start: core builds the launch; the fake agent runs in the worktree.
  await page.getByRole('button', { name: '開始' }).click()
  await waitForTerminal(page, 'fake-claude ready')

  // Type: keystrokes go over the WebSocket into the pty.
  await page.locator('.xterm-helper-textarea').first().focus()
  await page.keyboard.type('hello-e2e')
  await page.keyboard.press('Enter')
  await waitForTerminal(page, 'got:hello-e2e')

  // Diff: the file the agent wrote shows up.
  await page.getByRole('tab', { name: 'Git diff' }).click()
  await page.getByText('fake-agent-output.txt').first().waitFor({ timeout: 20_000 })

  // Approve over the same bridge the UI uses: commit + push to origin.
  const state = await page.evaluate(() => window.vibeflow.getState())
  const task = state.board.in_progress[0]
  assert.ok(task, 'the started card is In Progress')
  const approved = await page.evaluate((id) => window.vibeflow.approve(id, 'e2e: fake agent change'), task.id)
  assert.equal(approved.result.pushed, true, JSON.stringify(approved.result))
  assert.match(await git(remotePath, 'log', '--oneline', task.branch), /e2e: fake agent change/)

  // Finish: cleanup removes the worktree and keeps what the work amounted to.
  const done = await page.evaluate((id) => window.vibeflow.cleanupTask(id), task.id)
  const finished = [...done.board.in_progress, ...done.board.done, ...done.board.backlog].find((x) => x.id === task.id)
  assert.equal(finished.worktreePath, undefined)
  assert.ok(finished.outcome?.files.some((f) => f.path === 'fake-agent-output.txt'))
  assert.equal(fs.existsSync(task.worktreePath), false)

  if (canFakeGh) {
    // Issues & PRs: a project whose origin is on GitHub lists its Issues; one
    // creates a Backlog card directly from the detail modal.
    const gh = await makeRepo({ withRemote: false })
    t.after(gh.cleanup)
    await git(gh.projectPath, 'remote', 'add', 'origin', 'https://github.com/e2e/VibeFlow.git')
    await page.evaluate(
      (projectPath) => window.vibeflow.createTask({ title: 'Seed card', projectPath, baseBranch: null }),
      gh.projectPath
    )
    await page.getByText('Seed card').first().waitFor()
    await page.getByRole('tab', { name: 'Issues & PRs' }).first().click()
    await page.getByRole('tab', { name: /^Issues/ }).last().click()
    await page.getByRole('button', { name: /^專案篩選/ }).waitFor()
    assert.equal(await page.getByRole('button', { name: /^Assignee篩選/ }).count(), 0)
    assert.equal(await page.getByRole('button', { name: /^發起人篩選/ }).count(), 0)
    // clcom-frontend has no board card; global search still discovers it.
    await page.getByRole('button', { name: /#431/ }).click()
    await page.getByRole('dialog').waitFor()
    assert.equal(await page.getByRole('button', { name: '建立卡片' }).isDisabled(), true)
    await page.getByLabel('建立到專案').waitFor()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: /#112/ }).click()
    await page.getByRole('dialog').waitFor()
    await page.getByRole('button', { name: '建立卡片' }).click()
    await page.getByText('已建立到 Backlog').waitFor()
    await page.getByRole('button', { name: '前往卡片' }).waitFor()
    const converted = (await page.evaluate(() => window.vibeflow.getState())).board.backlog.find(
      (c) => c.github?.number === 112
    )
    assert.deepEqual(converted?.github, {
      kind: 'issue',
      repo: 'e2e/VibeFlow',
      number: 112,
      url: 'https://github.com/e2e/VibeFlow/issues/112',
    })
    assert.equal(converted.projectPath, gh.projectPath)
    assert.equal(converted.title, '側邊欄搜尋在中文輸入法組字時會閃爍')
    await page.getByRole('button', { name: '前往卡片' }).click()
    await page.getByRole('button', { name: '在 GitHub 開啟 Issue #112' }).waitFor()

    // PR filters remain independent of Issues and include reviewed PRs.
    await page.getByRole('tab', { name: 'Issues & PRs' }).first().click()
    await page.getByRole('tab', { name: /^Pull Requests/ }).click()
    await page.getByRole('button', { name: /^Assignee篩選/ }).waitFor()
    await page.getByRole('button', { name: /#107/ }).waitFor()
    const listed = () =>
      page.$$eval('button[aria-pressed]', (cards) =>
        cards.flatMap((c) => c.querySelector('.truncate')?.textContent.match(/#(\d+)$/)?.slice(1).map(Number) ?? [])
      )
    const tick = async (filter, option) => {
      await page.getByRole('button', { name: new RegExp(`^${filter}篩選`) }).click()
      await page.getByRole('menuitemcheckbox', { name: option, exact: true }).click()
      await page.keyboard.press('Escape')
    }
    assert.deepEqual(await listed(), [107, 105, 103])
    await tick('發起人', 'dev-amy')
    assert.deepEqual(await listed(), [103])
    await tick('發起人', 'dev-ben')
    assert.deepEqual(await listed(), [107, 103])
    await tick('Assignee', '未指派')
    assert.deepEqual(await listed(), [107])
    await page.getByRole('button', { name: '清除篩選' }).click()
    assert.deepEqual(await listed(), [107, 105, 103])
  }

  // Another origin cannot open the socket, even from the same browser.
  const other = await browser.newPage()
  await other.goto('about:blank')
  const refused = await other.evaluate(
    (url) =>
      new Promise((resolve) => {
        const ws = new WebSocket(url)
        ws.onopen = () => resolve(false)
        ws.onerror = () => resolve(true)
      }),
    `ws://127.0.0.1:${lock.port}/ws`
  )
  assert.equal(refused, true)
  assert.ok(!/Error/.test(hostLog), hostLog)
})

test('Web UI: Jira tabs, status filter and direct Backlog creation', { skip: !hasWeb && 'run npm run build:web first', timeout: 60_000 }, async (t) => {
  const browser = await launchBrowser()
  if (browser.error) { t.skip(`no browser: ${browser.error.message.split('\n')[0]}`); return }
  t.after(() => browser.close())
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-jira-e2e-'))
  const { projectPath, cleanup } = await makeRepo({ withRemote: false })
  await git(projectPath, 'remote', 'add', 'origin', 'https://github.com/e2e/VibeFlow.git')
  t.after(async () => { await cleanup(); fs.rmSync(tmp, { recursive: true, force: true }) })
  setPlatform(createNodePlatform({ userDataDir: tmp }))
  getStore().set('settings', { autoMode: true, workstationPath: path.join(tmp, 'ws') })
  const bus = new EventBus()
  const sessions = {
    kind: 'pty', start: async () => ({ pid: 1, scrollback: null }), write() {}, resize() {},
    kill: async () => {}, isAlive: async () => false, scrollback: () => null,
    list: async () => [], shutdown() {},
  }
  const rows = [
    { key: 'WR-5729', fields: { summary: 'Fix login', status: { name: 'Architecture Review', statusCategory: { key: 'indeterminate' } },
      issuetype: { name: 'Story' }, duedate: '2026-10-29', customfield_10033: 8,
      description: { type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Context' }] }] } } },
    { key: 'WR-5730', fields: { summary: 'Review docs', status: { name: 'To Do', statusCategory: { key: 'new' } }, issuetype: { name: 'Task' } } },
  ]
  const core = createCore({ sessions, bus, version: '9.9.9',
    jiraAuthStatus: async () => ({ installed: true, authenticated: true, site: 'example.atlassian.net', email: 'me@example.com' }),
    acliRunner: async () => JSON.stringify({ issues: rows }),
    githubAuthStatus: async () => ({ installed: true, authenticated: true, login: 'me' }),
    ghRunner: async (args) => args[0] === 'search' && args[1] === 'issues' && args.includes('--assignee')
      ? JSON.stringify([{ repository: { nameWithOwner: 'e2e/VibeFlow' } }])
      : args[0] === 'issue' && args.includes('--assignee')
        ? JSON.stringify([{ number: 112, title: 'Fix sidebar', url: 'https://github.com/e2e/VibeFlow/issues/112',
          body: 'Details', createdAt: '2026-10-01T00:00:00Z' }]) : '[]',
  })
  const server = await startWebServer({ handlers: core.handlers, bus, staticDir: webDir, token: 'jira-e2e-token' })
  t.after(async () => { core.shutdown(); await server.close() })
  await core.handlers['vibeflow:createTask']({ title: 'Seed project', projectPath, baseBranch: null })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.goto(server.loginUrl())
  await page.getByRole('tab', { name: 'Issues & PRs' }).first().click()
  await page.getByRole('tab', { name: /Jira/ }).waitFor()
  assert.equal(await page.getByRole('tab', { name: /Jira/ }).getAttribute('aria-selected'), 'true')
  assert.equal(await page.getByRole('separator', { name: '調整看板與工作區的高度' }).isVisible(), false)
  await page.getByText('Fix login').waitFor()
  assert.equal(await page.locator('button[aria-pressed]').count(), 2)
  await page.getByRole('button', { name: /^Status篩選/ }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Architecture Review' }).click()
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('button[aria-pressed]').count(), 1)
  await page.locator('button[aria-pressed]').click()
  await page.getByRole('dialog').waitFor()
  assert.equal(await page.getByRole('button', { name: '建立卡片' }).isDisabled(), true)
  await page.getByLabel('建立到專案').selectOption(projectPath)
  await page.getByRole('button', { name: '建立卡片' }).click()
  await page.getByText('已建立到 Backlog').waitFor()
  const state = await page.evaluate(() => window.vibeflow.getState())
  assert.equal(state.board.backlog[0].jira.key, 'WR-5729')
  await page.setViewportSize({ width: 375, height: 780 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true)
  await page.getByRole('button', { name: '前往卡片' }).click()
  assert.equal(await page.getByRole('tab', { name: '看板' }).first().getAttribute('aria-selected'), 'true')
  await page.getByRole('tab', { name: 'Issues & PRs' }).first().click()
  await page.getByRole('tab', { name: /Issues/ }).last().click()
  await page.getByRole('button', { name: /#112/ }).click()
  await page.getByRole('dialog').waitFor()
  await page.getByRole('button', { name: '建立卡片' }).click()
  await page.getByText('已建立到 Backlog').waitFor()
  const afterGithub = await page.evaluate(() => window.vibeflow.getState())
  assert.equal(afterGithub.board.backlog[0].github.number, 112)
})
