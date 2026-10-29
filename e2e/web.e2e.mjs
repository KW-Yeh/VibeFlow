// End-to-end: the Web UI's main flow against a real core host, driven by
// Playwright, with a fake agent CLI in place of claude.
//
//   npm run build:web && npm run test:e2e
//
// The GitHub CLI is replaced too (e2e/fake-gh.mjs), so the work-item view
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
echo "https://example.com/plain-link"
printf '\\033]8;;https://example.com/osc-link\\033\\\\OSC link\\033]8;;\\033\\\\\\n'
echo "written by the fake agent" > fake-agent-output.txt
echo './preview-image.svg'
echo '"./preview notes.md"'
echo './preview-missing.txt'
echo './preview-report.pdf'
echo './preview-long-directory/another-long-directory/and-one-more-long-directory/preview-wrapped-image.png'
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

async function clickTerminalFile(page, label, target = label) {
  const row = page.locator('.xterm-rows:visible').getByText(label, { exact: false }).first()
  const box = await row.boundingBox()
  assert.ok(box, `${label} is visible`)
  const x = box.x + Math.min(20, box.width / 2)
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.waitForFunction((expected) => [...document.querySelectorAll('.xterm')].some((term) => term.title === expected), target)
  await page.mouse.click(x, y)
  await page.getByRole('dialog', { name: '檔案預覽' }).waitFor()
}

const PREVIEW_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="240" viewBox="0 0 480 240"><rect width="480" height="240" rx="16" fill="#1e293b"/><circle cx="90" cy="120" r="48" fill="#38bdf8"/><text x="160" y="115" fill="white" font-family="sans-serif" font-size="26">Terminal preview</text><text x="160" y="150" fill="#94a3b8" font-family="sans-serif" font-size="16">Local image opened in VibeFlow</text></svg>'
const PREVIEW_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64')

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
        TYPESAFE_API_KEY: '', // exercise the visible CLI-default fallback
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
  const sidebar = page.locator('aside').first()
  await sidebar.getByRole('img', { name: 'VibeFlow' }).waitFor()
  assert.equal(await sidebar.evaluate((element) => element.getBoundingClientRect().width), 48)
  assert.equal(await page.getByRole('button', { name: '展開選單' }).count(), 0)
  await sidebar.getByRole('button', { name: '工作項目' }).click()
  assert.equal(await page.getByRole('tab', { name: '工作項目' }).getAttribute('aria-selected'), 'true')
  await sidebar.getByRole('button', { name: '看板' }).click()

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
    // The page may have mounted before the host finished warming the catalog.
    // Reload after the bridge reports the ready list so the picker reads it.
    await page.reload()
    await page.getByRole('button', { name: 'Advanced' }).click()
    const modelSelect = page.locator('select[name="agent-model"]')
    if (await modelSelect.locator('option', { hasText: 'Fable 5.1' }).count() === 0) {
      // If the picker first read fallback models, changing agents asks core
      // again after the catalog has finished warming.
      const agentSelect = page.locator('select[name="agent-agent-cli"]')
      await agentSelect.selectOption('codex')
      await agentSelect.selectOption('claude')
    }
    await modelSelect.locator('option', { hasText: 'Fable 5.1' }).waitFor({ state: 'attached' })
    assert.equal(await modelSelect.locator('option[value="default"]').count(), 0)
    assert.equal(await modelSelect.inputValue(), '', 'the CLI default model is selected independently of Jev')
    assert.equal(await modelSelect.locator('option[value=""]').textContent(), '使用 CLI 預設模型')
    assert.equal(await page.locator('input[name="task-effort"]').getAttribute('aria-valuetext'), '自動 (auto)')
    await page.getByRole('button', { name: 'Advanced' }).click()
  }

  // Create: typed project path (the browser has no folder dialog), title.
  await page.getByLabel('輸入專案資料夾路徑').fill(projectPath)
  await page.getByLabel('輸入專案資料夾路徑').press('Enter')
  await page.getByPlaceholder('例如：實作登入頁面').fill('E2E card')
  await page.getByRole('button', { name: '建立任務' }).click()
  await page.getByText('E2E card').first().waitFor()

  // The card's extra shell is independent of its not-yet-provisioned worktree.
  await page.getByRole('button', { name: '在專案目錄開啟 Terminal：E2E card' }).click()
  await page.waitForFunction(() => document.activeElement?.classList.contains('xterm-helper-textarea'))
  await page.locator('.xterm-helper-textarea:visible').last().focus()
  await page.keyboard.type('pwd > vf-grid-pwd.txt')
  await page.keyboard.press('Enter')
  for (let attempt = 0; !fs.existsSync(path.join(projectPath, 'vf-grid-pwd.txt')) && attempt < 50; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.ok(fs.existsSync(path.join(projectPath, 'vf-grid-pwd.txt')), 'the shell wrote in the project root')
  await page.getByRole('button', { name: /關閉 Terminal/ }).click()
  await page.getByRole('dialog', { name: '關閉 Terminal' }).getByRole('button', { name: '確認關閉' }).click()
  await page.getByRole('tab', { name: '看板' }).click()

  // Start: core builds the launch; the fake agent runs in the worktree.
  await page.getByRole('button', { name: '開始' }).click()
  await waitForTerminal(page, 'fake-claude ready')
  const routedState = await page.evaluate(() => window.vibeflow.getState())
  assert.equal(routedState.board.in_progress[0]?.effort, 'auto')
  assert.equal(routedState.board.in_progress[0]?.model, undefined)
  assert.equal(routedState.board.in_progress[0]?.jevRoute?.status, 'fallback')
  assert.match(routedState.board.in_progress[0]?.jevRoute?.reason ?? '', /TYPESAFE_API_KEY/)
  await page.getByText('Jev effort：模型預設值').first().waitFor()

  const previewTask = routedState.board.in_progress[0]
  fs.writeFileSync(path.join(previewTask.worktreePath, 'preview-image.svg'), PREVIEW_SVG)
  fs.writeFileSync(path.join(previewTask.worktreePath, 'preview notes.md'), '# Terminal preview\n\nReadable markdown.\n<script>window.previewUnsafe = true</script>')
  fs.writeFileSync(path.join(previewTask.worktreePath, 'preview-report.pdf'), '%PDF-1.7')
  const wrappedPath = './preview-long-directory/another-long-directory/and-one-more-long-directory/preview-wrapped-image.png'
  fs.mkdirSync(path.dirname(path.join(previewTask.worktreePath, wrappedPath)), { recursive: true })
  fs.writeFileSync(path.join(previewTask.worktreePath, wrappedPath), PREVIEW_PNG)
  const fileDialog = page.getByRole('dialog', { name: '檔案預覽' })
  await clickTerminalFile(page, './preview-image.svg')
  await fileDialog.locator('img').waitFor()
  await page.waitForFunction(() => document.querySelector('[role="dialog"] img')?.naturalWidth === 480)
  const zoom = fileDialog.getByRole('slider')
  const beforeZoom = await zoom.inputValue()
  await zoom.focus()
  await page.keyboard.press('ArrowRight')
  assert.notEqual(await zoom.inputValue(), beforeZoom)
  const evidence = process.env.VIBEFLOW_E2E_ARTIFACTS
  if (evidence) fs.mkdirSync(evidence, { recursive: true })
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.waitForFunction(() => {
      const dialog = document.querySelector('[role="dialog"]')
      const box = dialog.getBoundingClientRect()
      return box.x >= 0 && box.right <= innerWidth && dialog.scrollWidth <= dialog.clientWidth && getComputedStyle(dialog).opacity === '1' && getComputedStyle(dialog).transform === 'none'
    })
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    if (evidence) await page.screenshot({ path: path.join(evidence, `a7-terminal-file-preview-${width}.png`) })
  }
  await page.keyboard.press('Escape')
  await fileDialog.waitFor({ state: 'detached' })
  await page.setViewportSize({ width: 1280, height: 800 })
  await clickTerminalFile(page, '"./preview notes.md"', './preview notes.md')
  await fileDialog.getByRole('heading', { name: 'Terminal preview' }).waitFor()
  assert.equal(await page.evaluate(() => window.previewUnsafe), undefined)
  await page.keyboard.press('Escape')
  await clickTerminalFile(page, './preview-missing.txt')
  await fileDialog.getByRole('alert').filter({ hasText: '找不到' }).waitFor()
  await page.keyboard.press('Escape')
  await clickTerminalFile(page, './preview-report.pdf')
  await fileDialog.getByText(/此格式無法/).waitFor()
  await fileDialog.getByRole('button', { name: '用系統程式開啟' }).waitFor()
  await page.keyboard.press('Escape')
  await clickTerminalFile(page, './preview-long-directory/', wrappedPath)
  await fileDialog.locator('img').waitFor()
  await page.keyboard.press('Escape')

  // Both printed URLs and OSC 8 hyperlinks open safely in a new tab.
  await waitForTerminal(page, 'https://example.com/plain-link')
  for (const [text, url] of [
    ['https://example.com/plain-link', 'https://example.com/plain-link'],
    ['OSC link', 'https://example.com/osc-link'],
  ]) {
    const link = page.locator('.xterm-rows').getByText(text, { exact: false }).first()
    const box = await link.boundingBox()
    assert.ok(box, `${text} is visible in the terminal`)
    const x = box.x + Math.min(box.width / 2, 24)
    const y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.waitForFunction((expected) => document.querySelector('.xterm')?.title === expected, url)
    const popupPromise = page.waitForEvent('popup')
    await page.mouse.click(x, y)
    const popup = await popupPromise
    assert.equal(popup.url(), url)
    assert.equal(await popup.evaluate(() => window.opener), null)
    await popup.close()
  }

  // Type: keystrokes go over the WebSocket into the pty.
  await page.locator('.xterm-helper-textarea').first().focus()
  await page.keyboard.type('hello-e2e')
  await page.keyboard.press('Enter')
  await waitForTerminal(page, 'got:hello-e2e')

  // Diff: the file the agent wrote shows up.
  await page.getByRole('tab', { name: 'Git diff' }).click()
  await page.getByText('fake-agent-output.txt').first().waitFor({ timeout: 20_000 })

  // Inspector: fold it into the rail, reopen Git diff as a drawer, pin it back.
  const asideSplitter = page.getByRole('separator', { name: '調整終端機與側邊面板的寬度' })
  await page.getByRole('button', { name: '收合側欄' }).click()
  await asideSplitter.waitFor({ state: 'detached' })
  await page.getByRole('tab', { name: /Git diff/ }).click()
  await page.getByText('fake-agent-output.txt').first().waitFor()
  await page.getByRole('button', { name: '固定側欄' }).click()
  await asideSplitter.waitFor()

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
    // Work items: a project whose origin is on GitHub lists its Issues; one
    // creates a Backlog card directly from the detail modal.
    const gh = await makeRepo({ withRemote: false })
    t.after(gh.cleanup)
    await git(gh.projectPath, 'remote', 'add', 'origin', 'https://github.com/e2e/VibeFlow.git')
    await page.evaluate(
      (projectPath) => window.vibeflow.createTask({ title: 'Seed card', projectPath, baseBranch: null }),
      gh.projectPath
    )
    await page.getByText('Seed card').first().waitFor()
    await page.getByRole('tab', { name: '工作項目' }).first().click()
    await page.getByRole('tab', { name: /^Issues/ }).last().click()
    await page.getByRole('region', { name: 'e2e/clcom-frontend' }).waitFor()
    await page.getByRole('region', { name: 'e2e/VibeFlow' }).waitFor()
    assert.equal(await page.getByRole('button', { name: /^專案篩選/ }).count(), 0)
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
    await page.getByRole('tab', { name: '工作項目' }).first().click()
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

test('Web UI: update notice, version, Jira status columns, attachment links and folder-picked Backlog creation', { skip: !hasWeb && 'run npm run build:web first', timeout: 60_000 }, async (t) => {
  const browser = await launchBrowser()
  if (browser.error) { t.skip(`no browser: ${browser.error.message.split('\n')[0]}`); return }
  t.after(() => browser.close())
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-jira-e2e-'))
  const { projectPath, cleanup } = await makeRepo({ withRemote: false })
  const { projectPath: newProjectPath, cleanup: cleanupNewProject } = await makeRepo({ withRemote: false })
  await git(projectPath, 'remote', 'add', 'origin', 'https://github.com/e2e/VibeFlow.git')
  t.after(async () => { await cleanup(); await cleanupNewProject(); fs.rmSync(tmp, { recursive: true, force: true }) })
  let folderPicks = 0
  const openedUrls = []
  const jiraSearches = []
  setPlatform({ ...createNodePlatform({ userDataDir: tmp }),
    pickFolder: async () => ++folderPicks === 2 ? { path: newProjectPath } : { canceled: true },
    openExternal: async (url) => { openedUrls.push(url) },
  })
  getStore().set('settings', { autoMode: true, workstationPath: path.join(tmp, 'ws') })
  const bus = new EventBus()
  const sessions = {
    kind: 'pty', start: async () => ({ pid: 1, scrollback: null }), write() {}, resize() {},
    kill: async () => {}, isAlive: async () => false, scrollback: () => null,
    list: async () => [], shutdown() {},
  }
  const rows = [
    { key: 'WR-5729', fields: { summary: 'Fix login', status: { name: 'Architecture Review', statusCategory: { key: 'indeterminate' } },
      issuetype: { name: 'Story' }, duedate: '2026-10-29', customfield_10033: 8, parent: { key: 'WR-100' },
      attachment: [{ id: '12345', filename: 'design-notes.pdf', size: 123456 }],
      description: { type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Context' }] }] } } },
    { key: 'WR-5730', fields: { summary: 'Review docs', status: { name: 'To Do', statusCategory: { key: 'new' } }, issuetype: { name: 'Task' } } },
  ]
  const core = createCore({ sessions, bus, version: '9.9.9',
    jiraAuthStatus: async () => ({ installed: true, authenticated: true, site: 'example.atlassian.net', email: 'me@example.com' }),
    acliRunner: async (args) => {
      if (args[2] === 'search') jiraSearches.push(args[args.indexOf('--jql') + 1])
      return JSON.stringify(args[2] === 'search' ? { issues: rows } : rows.find((row) => row.key === args[3]))
    },
    githubAuthStatus: async () => ({ installed: true, authenticated: true, login: 'me' }),
    ghRunner: async (args) => args[0] === 'search' && args[1] === 'issues' && args.includes('--assignee')
      ? JSON.stringify([{ repository: { nameWithOwner: 'e2e/VibeFlow' } }])
      : args[0] === 'issue' && args.includes('--assignee')
        ? JSON.stringify([{ number: 112, title: 'Fix sidebar', url: 'https://github.com/e2e/VibeFlow/issues/112',
          body: 'Details', createdAt: '2026-10-01T00:00:00Z' }]) : '[]',
  })
  let updateLaunches = 0
  let updateChecks = 0
  const server = await startWebServer({ handlers: {
    ...core.handlers,
    'host:updateStatus': () => ({ currentVersion: '9.9.9', latestVersion: '10.0.0' }),
    'host:checkUpdate': () => {
      updateChecks++
      if (updateChecks === 1) throw new Error('registry offline')
      return updateChecks === 2
        ? { status: 'current', currentVersion: '9.9.9' }
        : { status: 'available', currentVersion: '9.9.9', latestVersion: '10.1.0' }
    },
    'host:openUpdateTerminal': () => {
      updateLaunches++
      if (updateLaunches === 1) throw new Error('找不到可用的終端機')
    },
  }, bus, staticDir: webDir, token: 'jira-e2e-token' })
  t.after(async () => { core.shutdown(); await server.close() })
  await core.handlers['vibeflow:createTask']({ title: 'Seed project', projectPath, baseBranch: null })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.goto(server.loginUrl())
  await page.getByText('VibeFlow v10.0.0 已發布', { exact: false }).waitFor()
  await page.getByRole('button', { name: '更新 VibeFlow' }).click()
  await page.getByRole('alert').getByText('找不到可用的終端機').waitFor()
  await page.getByRole('button', { name: '更新 VibeFlow' }).click()
  await page.getByRole('alert').getByText('找不到可用的終端機').waitFor({ state: 'hidden' })
  assert.equal(updateLaunches, 2)
  await page.getByRole('button', { name: '關閉更新提示' }).click()
  assert.equal(await page.getByText('VibeFlow v10.0.0 已發布', { exact: false }).count(), 0)
  bus.emit('update:available', { currentVersion: '9.9.9', latestVersion: '10.1.0' })
  await page.getByText('VibeFlow v10.1.0 已發布', { exact: false }).waitFor()
  await page.getByRole('button', { name: '設定 System Prompt' }).first().click()
  await page.getByText('VibeFlow 版本：v9.9.9').waitFor()
  const settings = page.getByRole('dialog')
  await settings.getByRole('button', { name: '檢查更新' }).click()
  await settings.getByRole('alert').getByText('registry offline', { exact: false }).waitFor()
  await settings.getByRole('button', { name: '檢查更新' }).click()
  await settings.getByText('已是最新版本（v9.9.9）').waitFor()
  await settings.getByRole('button', { name: '檢查更新' }).click()
  await settings.getByText('VibeFlow v10.1.0 已發布', { exact: false }).waitFor()
  await settings.getByRole('button', { name: '更新 VibeFlow' }).click()
  await settings.getByRole('button', { name: '更新 VibeFlow' }).waitFor()
  assert.equal(updateChecks, 3)
  assert.equal(updateLaunches, 3)
  await page.getByLabel('Jev API key').fill('e2e-jev-secret')
  await page.getByRole('button', { name: '儲存金鑰' }).click()
  await page.getByText('已設定 Jev API key（本機儲存）').waitFor()
  assert.equal((await page.getByLabel('Jev API key').inputValue()), '')
  assert.equal(JSON.stringify(await page.evaluate(() => window.vibeflow.getState())).includes('e2e-jev-secret'), false)
  await page.getByRole('button', { name: '移除金鑰' }).click()
  await page.waitForFunction(async () => (await window.vibeflow.getJevKeyStatus()).source !== 'saved')
  await page.getByRole('button', { name: '取消' }).click()
  await page.getByRole('tab', { name: '工作項目' }).first().click()
  await page.getByRole('tab', { name: /Jira/ }).waitFor()
  assert.equal(await page.getByRole('tab', { name: /Jira/ }).getAttribute('aria-selected'), 'true')
  assert.equal(await page.getByRole('separator', { name: '調整看板與工作區的高度' }).isVisible(), false)
  await page.getByText('Fix login').waitFor()
  assert.equal(await page.locator('button[aria-pressed]').count(), 2)
  assert.equal(await page.getByRole('button', { name: /^Status篩選/ }).count(), 0)
  assert.equal(await page.getByRole('region', { name: 'To Do，1 筆' }).count(), 1)
  assert.equal(await page.getByRole('region', { name: 'In Progress，1 筆' }).count(), 1)
  assert.equal(await page.getByRole('region', { name: 'To be Released，0 筆' }).count(), 1)
  assert.equal(await page.getByRole('region', { name: 'Done，0 筆' }).count(), 1)
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 800 })
    const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    assert.ok(pageWidth <= width, `Jira page overflows at ${width}px: ${pageWidth}px`)
  }
  await page.getByLabel('Jira 抓取範圍').selectOption('all')
  for (let attempt = 0; jiraSearches.length < 2 && attempt < 30; attempt++) await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal(jiraSearches.at(-1), 'assignee = currentUser() ORDER BY updated DESC')
  await page.reload()
  assert.equal(await page.getByLabel('Jira 抓取範圍').inputValue(), 'all')
  await page.getByRole('button', { name: /WR-5729/ }).click()
  await page.getByRole('dialog').waitFor()
  assert.equal(await page.getByRole('link', { name: 'WR-5729' }).getAttribute('href'), 'https://example.atlassian.net/browse/WR-5729')
  assert.equal(await page.getByRole('link', { name: 'WR-100' }).getAttribute('href'), 'https://example.atlassian.net/browse/WR-100')
  assert.equal(await page.getByRole('link', { name: 'design-notes.pdf' }).getAttribute('href'), 'https://example.atlassian.net/rest/api/3/attachment/content/12345')
  await page.getByRole('link', { name: 'WR-5729' }).click()
  await page.getByRole('link', { name: 'WR-100' }).click()
  await page.getByRole('link', { name: 'design-notes.pdf' }).click()
  for (let attempt = 0; openedUrls.length < 3 && attempt < 20; attempt++) await new Promise((resolve) => setTimeout(resolve, 50))
  assert.deepEqual(openedUrls, [
    'https://example.atlassian.net/browse/WR-5729',
    'https://example.atlassian.net/browse/WR-100',
    'https://example.atlassian.net/rest/api/3/attachment/content/12345',
  ])
  assert.equal(await page.getByRole('button', { name: '在 Jira 開啟' }).count(), 0)
  assert.equal(await page.getByRole('button', { name: '建立卡片' }).isDisabled(), true)
  await page.getByRole('button', { name: '從資料夾選擇專案' }).click()
  await page.waitForTimeout(100)
  assert.equal(await page.getByLabel('建立到專案').inputValue(), '')
  await page.getByRole('button', { name: '從資料夾選擇專案' }).click()
  await page.waitForFunction((path) => document.querySelector('select[aria-label="建立到專案"]')?.value === path, newProjectPath)
  assert.equal(await page.getByLabel('建立到專案').inputValue(), newProjectPath)
  await page.getByRole('button', { name: '從資料夾選擇專案' }).click()
  await page.waitForTimeout(100)
  assert.equal(await page.getByLabel('建立到專案').inputValue(), newProjectPath)
  await page.getByRole('button', { name: '建立卡片' }).click()
  await page.getByText('已建立到 Backlog').waitFor()
  const state = await page.evaluate(() => window.vibeflow.getState())
  assert.equal(state.board.backlog[0].jira.key, 'WR-5729')
  assert.equal(state.board.backlog[0].projectPath, newProjectPath)
  await page.setViewportSize({ width: 375, height: 780 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true)
  await page.getByRole('button', { name: '前往卡片' }).click()
  assert.equal(await page.getByRole('tab', { name: '看板' }).first().getAttribute('aria-selected'), 'true')
  await page.getByRole('tab', { name: '工作項目' }).first().click()
  await page.getByRole('tab', { name: /Issues/ }).last().click()
  await page.getByRole('button', { name: /#112/ }).click()
  await page.getByRole('dialog').waitFor()
  await page.getByRole('button', { name: '建立卡片' }).click()
  await page.getByText('已建立到 Backlog').waitFor()
  const afterGithub = await page.evaluate(() => window.vibeflow.getState())
  assert.equal(afterGithub.board.backlog[0].github.number, 112)
})

test('Web UI: terminal grid opens the card column directory and selected folders, keeps and closes sessions', { skip: !hasWeb && 'run npm run build:web first', timeout: 60_000 }, async (t) => {
  const browser = await launchBrowser()
  if (browser.error) { t.skip(`no browser: ${browser.error.message.split('\n')[0]}`); return }
  t.after(() => browser.close())
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-terminal-e2e-'))
  const { projectPath, cleanup } = await makeRepo({ withRemote: false })
  t.after(async () => { await cleanup(); fs.rmSync(tmp, { recursive: true, force: true }) })
  setPlatform(createNodePlatform({ userDataDir: tmp }))
  const workstationPath = path.join(tmp, 'workstation')
  fs.mkdirSync(workstationPath)
  getStore().set('settings', { autoMode: true, workstationPath })
  const starts = []
  const kills = []
  const bus = new EventBus()
  const sessions = {
    kind: 'pty', starts, kills,
    async start(key, options) { starts.push({ key, ...options }); return { pid: 1, scrollback: null } },
    write() {}, resize() {},
    async kill(key) { kills.push(key) },
    async isAlive() { return false }, scrollback: () => null,
    async list() { return [] }, shutdown() {},
  }
  const core = createCore({ sessions, bus, version: '9.9.9' })
  const first = await core.handlers['vibeflow:createTask']({ title: 'Backlog terminal', projectPath, baseBranch: null })
  const second = await core.handlers['vibeflow:createTask']({ title: 'Running terminal', projectPath, baseBranch: null })
  const third = await core.handlers['vibeflow:createTask']({ title: 'Done terminal', projectPath, baseBranch: null })
  core.handlers['vibeflow:setBoard']({ backlog: [first.task], in_progress: [second.task], done: [third.task] })
  const server = await startWebServer({ handlers: core.handlers, bus, staticDir: webDir, token: 'terminal-e2e-token' })
  t.after(async () => { core.shutdown(); await server.close() })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.goto(server.loginUrl())
  assert.equal(await page.getByText(/個任務 · .*個專案/).count(), 0)

  for (const title of ['Backlog terminal', 'Running terminal', 'Done terminal']) {
    const directory = title === 'Running terminal' ? '分支' : '專案'
    await page.getByRole('button', { name: `在${directory}目錄開啟 Terminal：${title}` }).click()
    await page.getByRole('tab', { name: '終端機' }).waitFor()
    assert.equal(await page.getByRole('tab', { name: '終端機' }).getAttribute('aria-selected'), 'true')
    await page.getByRole('tab', { name: '看板' }).click()
    await page.getByRole('button', { name: `開啟任務：${title}` })
      .getByRole('button', { name: `查看 Terminal：${path.basename(projectPath)}` }).waitFor()
  }
  await page.waitForFunction(() => document.querySelectorAll('.xterm').length === 3)
  for (let attempt = 0; starts.length < 3 && attempt < 50; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.equal(starts.length, 3)
  const runningCard = core.handlers['vibeflow:getState']().board.in_progress[0]
  assert.ok(runningCard.worktreePath)
  assert.deepEqual(
    starts.map(({ cwd }) => cwd).sort(),
    [projectPath, runningCard.worktreePath, projectPath].sort()
  )
  assert.ok(starts.every(({ command }) => command === undefined))
  await page.getByRole('tab', { name: '終端機' }).click()
  const panes = page.locator('section[aria-label^="Terminal："]')
  fs.writeFileSync(path.join(projectPath, 'standalone-preview.png'), PREVIEW_PNG)
  bus.emit('pty:data', { sessionKey: starts[0].key, data: './standalone-preview.png\r\n' })
  await waitForTerminal(page, './standalone-preview.png')
  await clickTerminalFile(page, './standalone-preview.png')
  await page.getByRole('dialog', { name: '檔案預覽' }).locator('img').waitFor()
  await page.keyboard.press('Escape')
  assert.equal(starts.length, 3, 'preview keeps standalone sessions mounted')
  assert.equal(kills.length, 0, 'preview does not kill a terminal')
  const assertTerminalContentFits = () => page.waitForFunction(() =>
    [...document.querySelectorAll('section[aria-label^="Terminal："]')].every((pane) => {
      const host = pane.querySelector('[aria-label^="終端機："]')
      const screen = pane.querySelector('.xterm-screen')
      if (!host || !screen || getComputedStyle(host).paddingBottom !== '0px') return false
      const hostBounds = host.getBoundingClientRect()
      const screenBounds = screen.getBoundingClientRect()
      return screenBounds.bottom <= hostBounds.bottom + 1 && screenBounds.right <= hostBounds.right + 1
    }), null, { timeout: 5000 })
  const wideBoxes = await Promise.all([0, 1, 2].map((index) => panes.nth(index).boundingBox()))
  assert.ok(wideBoxes.every((box) => box && box.width > 340 && box.height === 480))
  assert.ok(wideBoxes.every((box) => box.y === wideBoxes[0].y))
  const scrollback = panes.first().locator('.xterm-viewport')
  assert.equal(await scrollback.evaluate((element) => getComputedStyle(element).scrollbarWidth), 'thin')
  assert.equal(await scrollback.evaluate((element) => getComputedStyle(element).overflowY), 'scroll')
  assert.equal(await panes.first().locator('..').evaluate((element) => getComputedStyle(element).scrollbarWidth), 'thin')
  const gridBox = await panes.first().locator('..').boundingBox()
  assert.ok(gridBox && Math.abs(wideBoxes[2].x + wideBoxes[2].width - (gridBox.x + gridBox.width - 16)) < 1)
  await page.setViewportSize({ width: 1600, height: 800 })
  const extraWideBoxes = await Promise.all([0, 1, 2].map((index) => panes.nth(index).boundingBox()))
  assert.ok(extraWideBoxes.every((box) => box.y === extraWideBoxes[0].y && box.width > wideBoxes[0].width))
  await assertTerminalContentFits()
  await page.setViewportSize({ width: 800, height: 800 })
  const mediumBoxes = await Promise.all([0, 1, 2].map((index) => panes.nth(index).boundingBox()))
  assert.equal(mediumBoxes[0].y, mediumBoxes[1].y)
  assert.ok(mediumBoxes[2].y > mediumBoxes[0].y)
  await page.setViewportSize({ width: 480, height: 800 })
  const narrowBoxes = await Promise.all([0, 1, 2].map((index) => panes.nth(index).boundingBox()))
  assert.ok(narrowBoxes[0].y < narrowBoxes[1].y && narrowBoxes[1].y < narrowBoxes[2].y)
  await assertTerminalContentFits()
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.getByText(runningCard.worktreePath).waitFor()
  const titles = page.getByRole('textbox', { name: /編輯 Terminal 標題/ })
  await titles.first().fill('My shell')
  assert.equal(await titles.first().inputValue(), 'My shell')
  await page.getByRole('tab', { name: '看板' }).click()
  await page.getByRole('button', { name: '開啟任務：Backlog terminal' })
    .getByRole('button', { name: '查看 Terminal：My shell' }).click()
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Terminal：My shell')
  assert.equal(await page.getByRole('tab', { name: '終端機' }).getAttribute('aria-selected'), 'true')
  await page.getByRole('button', { name: '關閉 Terminal：My shell' }).click()
  const closeDialog = page.getByRole('dialog', { name: '關閉 Terminal' })
  await closeDialog.getByText('關閉「My shell」？').waitFor()
  assert.equal(kills.length, 0, 'opening the warning leaves the session running')
  await closeDialog.getByRole('button', { name: '取消' }).click()
  assert.equal(await panes.count(), 3, 'cancel keeps the terminal pane')
  assert.equal(kills.length, 0, 'cancel leaves the session running')
  await page.getByRole('button', { name: '關閉 Terminal：My shell' }).click()
  await closeDialog.getByRole('button', { name: '確認關閉' }).click()
  await page.waitForFunction(() => document.querySelectorAll('.xterm').length === 2)
  assert.equal(kills.length, 1)
  await page.getByRole('tab', { name: '看板' }).click()
  assert.equal(await page.getByRole('button', { name: '查看 Terminal：My shell' }).count(), 0)
  await page.getByRole('tab', { name: '終端機' }).click()

  await page.getByRole('button', { name: '新增 Terminal' }).click()
  await page.getByRole('combobox', { name: '專案資料夾' }).selectOption(projectPath)
  await page.getByRole('button', { name: '開啟 Terminal' }).click()
  await page.waitForFunction(() => document.querySelectorAll('.xterm').length === 3)
  for (let attempt = 0; starts.length < 4 && attempt < 50; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.equal(starts.length, 4)
  assert.equal(starts.at(-1).cwd, projectPath)

  // A reload keeps the view in the URL and re-attaches every pane under its saved key and title.
  await titles.first().fill('Kept title')
  await titles.first().press('Enter')
  for (let attempt = 0; !core.handlers['vibeflow:getState']().terminals.some((e) => e.title === 'Kept title') && attempt < 50; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const saved = core.handlers['vibeflow:getState']().terminals
  assert.ok(saved.some((e) => e.title === 'Kept title'), 'the rename reached core')
  assert.equal(saved.length, 3)
  assert.match(page.url(), /[?&]view=terminals/)
  await page.reload()
  await page.waitForFunction(() => document.querySelectorAll('.xterm').length === 3)
  assert.equal(await page.getByRole('tab', { name: '終端機' }).getAttribute('aria-selected'), 'true')
  assert.equal(await titles.first().inputValue(), 'Kept title')
  for (let attempt = 0; starts.length < 7 && attempt < 50; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.deepEqual(starts.slice(4).map(({ key }) => key).sort(), saved.map((e) => e.sessionKey).sort())
  assert.equal(kills.length, 1, 'a reload ends no session')

  await page.getByRole('tab', { name: '工作項目' }).click()
  await page.reload()
  await page.getByRole('tab', { name: '工作項目' }).waitFor()
  assert.equal(await page.getByRole('tab', { name: '工作項目' }).getAttribute('aria-selected'), 'true')
})
