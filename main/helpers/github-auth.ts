import { execFile } from 'child_process'
import { promisify } from 'util'
import * as nodePty from 'node-pty'
import { execEnv } from './env'

const pexec = promisify(execFile)
const GITHUB_HOST = 'github.com'
const DEVICE_URL = 'https://github.com/login/device'

export interface GitHubCliAuthStatus {
  installed: boolean
  authenticated: boolean
  login?: string
  gitProtocol?: string
  error?: string
}

export type GitHubCliAuthEvent =
  | { type: 'starting' }
  | { type: 'code'; code: string; url: string }
  | { type: 'success'; status: GitHubCliAuthStatus }
  | { type: 'error'; error: string }
  | { type: 'cancelled' }

interface GhAuthStatusAccount {
  active?: boolean
  error?: string
  gitProtocol?: string
  login?: string
  state?: string
}

interface GhAuthStatusBody {
  hosts?: Record<string, GhAuthStatusAccount[]>
}

let activeLogin: nodePty.IPty | null = null

function stripAnsi(value: string): string {
  return value
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
    .replace(/\x07/g, '')
}

function normalizeCode(code: string): string {
  return code.replace(/\s+/g, '').toUpperCase()
}

function extractDeviceCode(output: string): string | null {
  const cleaned = stripAnsi(output)
  const explicit = cleaned.match(/one-time code:\s*([A-Z0-9-]+)/i)
  if (explicit?.[1]) return normalizeCode(explicit[1])

  const fallback = cleaned.match(/\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/i)
  return fallback?.[1] ? normalizeCode(fallback[1]) : null
}

function statusFromBody(body: GhAuthStatusBody): GitHubCliAuthStatus {
  const accounts = body.hosts?.[GITHUB_HOST] ?? []
  const active = accounts.find((account) => account.active) ?? accounts[0]
  if (!active) return { installed: true, authenticated: false }

  return {
    installed: true,
    authenticated: Boolean(active.login) && !active.error,
    login: active.login,
    gitProtocol: active.gitProtocol,
    error: active.error,
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

export async function getGitHubCliAuthStatus(): Promise<GitHubCliAuthStatus> {
  try {
    const { stdout } = await pexec(
      'gh',
      ['auth', 'status', '--hostname', GITHUB_HOST, '--json', 'hosts'],
      {
        env: execEnv(),
        timeout: 10_000,
        windowsHide: true,
      }
    )
    const body = JSON.parse(stdout.toString()) as GhAuthStatusBody
    return statusFromBody(body)
  } catch (err) {
    const maybeStdout = (err as { stdout?: Buffer | string }).stdout
    if (maybeStdout) {
      try {
        const body = JSON.parse(maybeStdout.toString()) as GhAuthStatusBody
        return statusFromBody(body)
      } catch {
        // Fall through to the human-readable error.
      }
    }

    const message = errorMessage(err)
    return {
      installed: !/ENOENT|not found/i.test(message),
      authenticated: false,
      error: message,
    }
  }
}

export async function logoutGitHubCli(): Promise<GitHubCliAuthStatus> {
  const status = await getGitHubCliAuthStatus()
  if (!status.installed) throw new Error('找不到 GitHub CLI（gh）。')
  if (!status.login) return status

  await pexec(
    'gh',
    ['auth', 'logout', '--hostname', GITHUB_HOST, '--user', status.login],
    {
      env: execEnv(),
      timeout: 10_000,
      windowsHide: true,
    }
  )
  return getGitHubCliAuthStatus()
}

export function cancelGitHubCliLogin(): void {
  if (!activeLogin) return
  try {
    activeLogin.kill()
  } catch {
    // Already exited.
  }
  activeLogin = null
}

export function startGitHubCliLogin(
  onEvent: (event: GitHubCliAuthEvent) => void
): void {
  cancelGitHubCliLogin()
  onEvent({ type: 'starting' })

  let output = ''
  let sentBrowserChoice = false
  let emittedCode: string | null = null
  let continuedAfterCode = false
  let completed = false

  let proc: nodePty.IPty
  try {
    proc = nodePty.spawn(
      'gh',
      ['auth', 'login', '--hostname', GITHUB_HOST, '--git-protocol', 'https'],
      {
        name: 'xterm-256color',
        cwd: process.cwd(),
        env: { ...execEnv(), BROWSER: 'true', TERM: 'xterm-256color' },
        cols: 100,
        rows: 24,
      }
    )
  } catch (err) {
    onEvent({ type: 'error', error: errorMessage(err) })
    return
  }

  activeLogin = proc

  proc.onData((data) => {
    output += data
    const cleaned = stripAnsi(output)

    if (!sentBrowserChoice && cleaned.includes('Login with a web browser')) {
      sentBrowserChoice = true
      proc.write('\r')
    }

    const code = extractDeviceCode(output)
    if (code && code !== emittedCode) {
      emittedCode = code
      onEvent({ type: 'code', code, url: DEVICE_URL })
    }
    if (code && !continuedAfterCode) {
      continuedAfterCode = true
      proc.write('\r')
    }
  })

  proc.onExit(async ({ exitCode }) => {
    if (activeLogin === proc) activeLogin = null
    if (completed) return
    completed = true

    if (exitCode === 0) {
      onEvent({ type: 'success', status: await getGitHubCliAuthStatus() })
      return
    }

    const cleaned = stripAnsi(output).trim()
    if (exitCode === 130 || cleaned.endsWith('cancelled')) {
      onEvent({ type: 'cancelled' })
      return
    }

    onEvent({
      type: 'error',
      error: cleaned || `GitHub CLI 登入失敗（exit ${exitCode}）。`,
    })
  })
}
