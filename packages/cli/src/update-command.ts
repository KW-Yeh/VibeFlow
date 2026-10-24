import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

interface NpmResult {
  status: number | null
  stdout?: string | Buffer | null
  error?: Error
}

type NpmRunner = (args: string[], inherit: boolean) => NpmResult

export interface UpdateOptions {
  cliEntry: string | null
  sourceRoot: string | null
  runNpm?: NpmRunner
  log?: (message: string) => void
  error?: (message: string) => void
}

function npmRunner(args: string[], inherit: boolean): NpmResult {
  const spawnOpts = {
    encoding: 'utf8' as const,
    stdio: inherit ? 'inherit' as const : ['ignore' as const, 'pipe' as const, 'inherit' as const],
    windowsHide: true,
  }
  // Windows distributes npm as a .cmd shim; Node needs a shell to launch it.
  // cmd.exe gets one pre-joined line (args are fixed tokens and a validated
  // package name): passing args alongside `shell` is deprecated (DEP0190).
  return process.platform === 'win32'
    ? spawnSync(['npm.cmd', ...args].join(' '), { ...spawnOpts, shell: true })
    : spawnSync('npm', args, spawnOpts)
}

export function packageName(packageRoot: string): string | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')) as { name?: unknown }
    if (typeof pkg.name !== 'string') return null
    // The name is read from disk and passed to npm; keep it within npm's package-name grammar.
    return /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(pkg.name) ? pkg.name : null
  } catch {
    return null
  }
}

/** Update only the npm global package that contains this running CLI. */
export function runUpdate(options: UpdateOptions): number {
  const log = options.log ?? console.log
  const error = options.error ?? console.error
  const runNpm = options.runNpm ?? npmRunner
  if (options.sourceRoot || !options.cliEntry) {
    error('vibeflow update 只適用於全域 npm 安裝；目前是原始碼版本。')
    return 1
  }

  const packageRoot = path.dirname(path.dirname(options.cliEntry))
  const name = packageName(packageRoot)
  if (!name) {
    error('無法辨識目前 VibeFlow 的 npm 套件名稱，已取消更新。')
    return 1
  }

  const root = runNpm(['root', '-g'], false)
  if (root.error || root.status !== 0 || !String(root.stdout ?? '').trim()) {
    error(`無法查詢 npm 全域安裝目錄：${root.error?.message ?? `npm 結束碼 ${root.status ?? 'unknown'}`}`)
    return 1
  }

  try {
    const globalPackage = path.join(String(root.stdout).trim(), ...name.split('/'))
    // A linked package is not an npm-managed global installation. Installing
    // over its link would silently change the user's development setup.
    if (fs.lstatSync(globalPackage).isSymbolicLink() || fs.realpathSync(globalPackage) !== fs.realpathSync(packageRoot)) {
      error('vibeflow update 只適用於全域 npm 安裝；目前執行的套件來自其他位置。')
      return 1
    }
  } catch {
    error('vibeflow update 只適用於全域 npm 安裝；目前執行的套件不是 npm 全域安裝。')
    return 1
  }

  log(`正在更新 ${name} 至 npm latest…`)
  // Right after a release npm's cached metadata (or a lagging registry edge)
  // can name the new `latest` without listing it yet (ETARGET); revalidate.
  const result = runNpm(['install', '-g', `${name}@latest`, '--prefer-online'], true)
  if (result.error || result.status !== 0) {
    error(`更新失敗：${result.error?.message ?? `npm 結束碼 ${result.status ?? 'unknown'}`}`)
    return result.status && result.status > 0 ? result.status : 1
  }
  log('更新完成。執行中的 Web UI host 會在數秒內自動重新啟動成新版本；TUI host 或有執行中 session 的 pty host 請自行重新啟動。')
  return 0
}
