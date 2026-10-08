import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { parseArgs } from 'node:util'
import { liveHost, type LockInfo } from '../../core/src/lock'
import { createNodePlatform, getPlatform, setPlatform } from '../../core/src/platform'
import { getState, getStore } from '../../core/src/store'
import { recordRecentProject } from '../../core/src/recent-projects'
import { createBridge } from '../../core/src/client'
import { createLocalTransport } from '../../core/src/local-transport'
import { TmuxBackend, hasTmux } from '../../core/src/tmux-backend'
import { ensurePtySpawnHelper } from '../../core/src/pty-helper'
import { runTaskCommand, resolveStorePath, TASK_USAGE } from './task-command'
import { isWebDir, loginUrl, startHost, type HostOptions, type RunningHost } from './host'
import { connectToHost } from './remote'
import { formatChecks, runDoctor } from './doctor'
import { runUpdate } from './update-command'

const USAGE = `
VibeFlow — intent-driven kanban for coding agents

Usage:
  vibeflow                 Start (or reuse) the local core and open the Web UI
  vibeflow tui             Terminal UI on the same board and sessions
  vibeflow status          Running host, sessions and board summary
  vibeflow stop <id>...    Stop the agent sessions of these cards
  vibeflow stop --all      Stop every agent session
  vibeflow shutdown        Stop the host (tmux sessions keep running)
  vibeflow open <path>     Add a project folder to the recent list, then open the Web UI
  vibeflow doctor          Check Node, git, tmux, node-pty and the agent CLIs
                           (--skip agents,web,… leaves checks out, e.g. on CI)
  vibeflow update          Install the latest global npm release (restart the host afterward)
  vibeflow task …          Create / update cards (vibeflow task --help)

Options:
  --profile dev|prod       Store profile (dev = the "(development)" store npm run dev uses)
  --store-path <dir>       Explicit store directory
  --backend auto|tmux|pty  Session backend for a new host (default: auto = tmux when installed)
  --port <n>               Port for a new host (default: 47820, or a free one when taken)
  --no-open                Do not open a browser
  --json                   Machine-readable output (status)
  -v, --version            Print the version
  -h, --help               Show this help
`.trim()

interface Layout {
  version: string
  /** The Web UI's static export, when this install has one. */
  webDir: string | null
  /** Repo root when run from source. */
  sourceRoot: string | null
  /** The bundled CLI file, when run from the npm build. */
  cliEntry: string | null
}

/** Where this copy of VibeFlow lives: a source checkout or the npm bundle. */
function detectLayout(): Layout {
  const file = fileURLToPath(import.meta.url)
  const here = path.dirname(file)
  // npm bundle: dist/vibeflow.mjs with dist/web beside it.
  const bundledWeb = path.join(here, 'web')
  if (isWebDir(bundledWeb) || path.basename(here) === 'dist') {
    return {
      version: readVersion(path.join(here, '..', 'package.json')),
      webDir: isWebDir(bundledWeb) ? bundledWeb : null,
      sourceRoot: null,
      cliEntry: file,
    }
  }
  // Source: packages/cli/src/main.ts, the renderer exported to <root>/app.
  const root = path.resolve(here, '..', '..', '..')
  const override = process.env.VIBEFLOW_WEB_DIR
  const webDir = override && isWebDir(override) ? override : isWebDir(path.join(root, 'app')) ? path.join(root, 'app') : null
  return { version: readVersion(path.join(root, 'package.json')), webDir, sourceRoot: root, cliEntry: null }
}

function readVersion(pkgPath: string): string {
  try {
    return (JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version: string }).version
  } catch {
    return '0.0.0'
  }
}

function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    options: {
      profile: { type: 'string' },
      'store-path': { type: 'string' },
      backend: { type: 'string' },
      port: { type: 'string' },
      'no-open': { type: 'boolean' },
      json: { type: 'boolean' },
      all: { type: 'boolean' },
      skip: { type: 'string' },
      version: { type: 'boolean', short: 'v' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
    strict: true,
  })
}

type Values = ReturnType<typeof parse>['values']

function hostOptions(values: Values, layout: Layout, userDataDir: string, withWeb = true): HostOptions {
  const backend = values.backend ?? 'auto'
  if (!['auto', 'tmux', 'pty'].includes(backend)) throw new Error('--backend must be auto | tmux | pty')
  const port = values.port ? Number(values.port) : undefined
  if (port !== undefined && !(Number.isInteger(port) && port > 0 && port < 65536)) throw new Error('--port must be a port number')
  return {
    userDataDir,
    version: layout.version,
    staticDir: withWeb ? layout.webDir : null,
    sourceRoot: layout.sourceRoot,
    cliEntry: layout.cliEntry,
    backend: backend as HostOptions['backend'],
    port,
  }
}

async function openBrowser(url: string): Promise<void> {
  try {
    await getPlatform().openExternal(url)
  } catch {
    // Printed anyway; the user can open it by hand.
  }
}

/** Stop the host cleanly on Ctrl+C / kill, then exit. */
function stopOnSignals(host: RunningHost): Promise<void> {
  return new Promise((resolve) => {
    const stop = () => {
      void host.stop().then(resolve)
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    process.once('SIGHUP', stop)
  })
}

async function cmdWeb(values: Values, layout: Layout, userDataDir: string, pathname = '/home/'): Promise<number> {
  const running = liveHost(userDataDir)
  if (running?.port) {
    const url = loginUrl(running, pathname)
    console.log(`VibeFlow 已在執行（pid ${running.pid}）：${url}`)
    if (!values['no-open']) await openBrowser(url)
    return 0
  }
  if (!layout.webDir) {
    console.error('找不到 Web UI 的靜態檔。從原始碼執行時請先執行：npm run build:web')
    return 1
  }
  const started = await startHost(hostOptions(values, layout, userDataDir))
  if (started.kind === 'running') return cmdWeb(values, layout, userDataDir, pathname)
  const { host } = started
  const url = loginUrl(host.lock, pathname)
  console.log(`VibeFlow ${layout.version} · ${host.core.sessions.kind} sessions · 資料：${userDataDir}`)
  console.log(`Web UI：${url}`)
  console.log('按 Ctrl+C 停止。')
  // First start on a machine with a problem: say so once, up front.
  const checks = await runDoctor({ userDataDir, webDir: layout.webDir })
  if (checks.some((c) => c.level === 'fail')) console.log(`\n環境檢查發現問題：\n${formatChecks(checks)}\n`)
  if (!values['no-open']) await openBrowser(url)
  await stopOnSignals(host)
  return 0
}

async function cmdTui(values: Values, layout: Layout, userDataDir: string): Promise<number> {
  const { runTui } = await import('../../tui/src/index')
  const running = liveHost(userDataDir)
  if (running?.port) {
    setPlatform(createNodePlatform({ userDataDir }))
    const remote = connectToHost(running)
    try {
      await runTui({
        api: remote.api,
        userDataDir,
        isHost: false,
        openWeb: () => void openBrowser(loginUrl(running)),
      })
    } finally {
      remote.close()
    }
    return 0
  }
  // No host: this process becomes it, serving the Web UI too so `w` works.
  const started = await startHost(hostOptions(values, layout, userDataDir))
  if (started.kind === 'running') return cmdTui(values, layout, userDataDir)
  const { host } = started
  try {
    await runTui({
      api: createBridge(createLocalTransport(host.core)),
      userDataDir,
      isHost: true,
      openWeb: layout.webDir ? () => void openBrowser(loginUrl(host.lock)) : undefined,
    })
  } finally {
    await host.stop()
  }
  return 0
}

async function withHost<T>(lock: LockInfo, fn: (remote: ReturnType<typeof connectToHost>) => Promise<T>): Promise<T> {
  const remote = connectToHost(lock)
  try {
    return await fn(remote)
  } finally {
    remote.close()
  }
}

async function cmdStatus(values: Values, userDataDir: string): Promise<number> {
  setPlatform(createNodePlatform({ userDataDir }))
  const running = liveHost(userDataDir)
  let backend: string
  let sessions: string[]
  if (running?.port) {
    const info = await withHost(running, (r) => r.api.term.list())
    backend = info.backend
    sessions = info.sessions
  } else if (hasTmux()) {
    // tmux sessions outlive the host; they are still worth reporting.
    backend = 'tmux'
    sessions = await new TmuxBackend({ send() {}, isDestroyed: () => true }, { stateDir: userDataDir }).list()
  } else {
    backend = 'pty'
    sessions = []
  }
  const board = getState().board
  const title = (id: string) =>
    [...board.backlog, ...board.in_progress, ...board.done].find((t) => t.id === id.split(':')[0])?.title ?? '（不在看板上）'
  if (values.json) {
    console.log(
      JSON.stringify(
        {
          host: running ? { pid: running.pid, port: running.port, version: running.version } : null,
          backend,
          sessions: sessions.map((key) => ({ key, title: title(key) })),
          board: { backlog: board.backlog.length, in_progress: board.in_progress.length, done: board.done.length },
        },
        null,
        2
      )
    )
    return 0
  }
  console.log(running ? `Host：執行中（pid ${running.pid}，port ${running.port}，v${running.version}）` : 'Host：未執行')
  console.log(`Sessions（${backend}）：${sessions.length === 0 ? '無' : ''}`)
  for (const key of sessions) console.log(`  ● ${key}  ${title(key)}`)
  console.log(`看板：Backlog ${board.backlog.length} · In Progress ${board.in_progress.length} · Done ${board.done.length}`)
  return 0
}

async function cmdStop(values: Values, ids: string[], userDataDir: string): Promise<number> {
  if (!values.all && ids.length === 0) {
    console.error('用法：vibeflow stop <taskId>... 或 vibeflow stop --all')
    return 1
  }
  setPlatform(createNodePlatform({ userDataDir }))
  const running = liveHost(userDataDir)
  if (running?.port) {
    return withHost(running, async (r) => {
      const keys = values.all ? (await r.api.term.list()).sessions : ids
      for (const key of keys) r.api.term.kill(key)
      // `kill` is fire-and-forget; one answered call flushes them.
      await r.api.term.list()
      console.log(keys.length ? `已停止：${keys.join(', ')}` : '沒有執行中的 session')
      return 0
    })
  }
  if (!hasTmux()) {
    console.log('Host 未執行，也沒有 tmux session：沒有要停止的 agent。')
    return 0
  }
  const tmux = new TmuxBackend({ send() {}, isDestroyed: () => true }, { stateDir: userDataDir })
  const keys = values.all ? await tmux.list() : ids
  for (const key of keys) await tmux.kill(key)
  console.log(keys.length ? `已停止：${keys.join(', ')}` : '沒有執行中的 session')
  return 0
}

async function cmdShutdown(userDataDir: string): Promise<number> {
  const running = liveHost(userDataDir)
  if (!running?.port) {
    console.log('Host 未執行。')
    return 0
  }
  await withHost(running, (r) => r.invoke('host:shutdown'))
  console.log(`已停止 host（pid ${running.pid}）。`)
  return 0
}

async function cmdOpen(values: Values, target: string | undefined, layout: Layout, userDataDir: string): Promise<number> {
  if (!target) {
    console.error('用法：vibeflow open <path>')
    return 1
  }
  const dir = path.resolve(target)
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    console.error(`不是資料夾：${dir}`)
    return 1
  }
  const running = liveHost(userDataDir)
  if (running?.port) {
    await withHost(running, (r) => r.invoke('projects:record', dir))
  } else {
    setPlatform(createNodePlatform({ userDataDir }))
    recordRecentProject(getStore(), dir)
  }
  console.log(`已加入最近使用的專案：${dir}`)
  return cmdWeb(values, layout, userDataDir)
}

export async function main(argv: string[]): Promise<number> {
  ensurePtySpawnHelper()
  if (argv[0] === 'task') {
    if (argv.includes('--help') || argv.includes('-h') || argv.length === 1) {
      console.log(TASK_USAGE)
      return 0
    }
    return runTaskCommand(argv.slice(1))
  }
  let parsed
  try {
    parsed = parse(argv)
  } catch (err) {
    console.error((err as Error).message)
    console.error('執行 vibeflow --help 查看用法')
    return 1
  }
  const { values, positionals } = parsed
  const layout = detectLayout()
  if (values.version) {
    console.log(layout.version)
    return 0
  }
  if (values.help) {
    console.log(USAGE)
    return 0
  }
  const userDataDir = resolveStorePath(values['store-path'], values.profile)
  const [command = 'web', ...rest] = positionals
  try {
    switch (command) {
      case 'web':
      case 'start':
        return await cmdWeb(values, layout, userDataDir)
      case 'tui':
        return await cmdTui(values, layout, userDataDir)
      case 'status':
        return await cmdStatus(values, userDataDir)
      case 'stop':
        return await cmdStop(values, rest, userDataDir)
      case 'shutdown':
        return await cmdShutdown(userDataDir)
      case 'update':
        if (rest.length) throw new Error('vibeflow update 不接受其他參數')
        return runUpdate(layout)
      case 'open':
        return await cmdOpen(values, rest[0], layout, userDataDir)
      case 'doctor': {
        const skip = values.skip?.split(',').map((x) => x.trim()).filter(Boolean)
        const checks = await runDoctor({ userDataDir, webDir: layout.webDir, skip })
        console.log(formatChecks(checks))
        return checks.some((c) => c.level === 'fail') ? 1 : 0
      }
      default:
        console.error(`未知的指令：${command}\n\n${USAGE}`)
        return 1
    }
  } catch (err) {
    console.error(`vibeflow: ${(err as Error).message}`)
    return 1
  }
}
