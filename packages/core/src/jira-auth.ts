import { execFile } from 'child_process'
import { promisify } from 'util'
import { execEnv } from './env'
import * as nodePty from 'node-pty'

const pexec = promisify(execFile)

export interface JiraAuthStatus {
  installed: boolean
  authenticated: boolean
  site?: string
  email?: string
  error?: string
}

export type JiraAuthEvent =
  | { type: 'starting' }
  | { type: 'output'; data: string }
  | { type: 'url'; url: string }
  | { type: 'success'; status: JiraAuthStatus }
  | { type: 'signed-out'; status: JiraAuthStatus }
  | { type: 'error'; error: string }
  | { type: 'cancelled' }

let activeLogin: nodePty.IPty | null = null
let activeCancel: (() => void) | null = null

export function stripAnsi(value: string): string {
  return value.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '').replace(/\x07/g, '')
}

export function parseAuthStatus(output: string): JiraAuthStatus {
  const clean = stripAnsi(output)
  const site = clean.match(/(?:site|host)\s*:\s*(?:https?:\/\/)?([a-z0-9.-]+\.atlassian\.net)/i)?.[1]
  const email = clean.match(/(?:email|user)\s*:\s*([^\s]+@[^\s]+)/i)?.[1]
  return {
    installed: true,
    authenticated: Boolean(site) && !/not (?:logged|authenticated)|unauthenticated/i.test(clean),
    ...(site ? { site } : {}),
    ...(email ? { email } : {}),
  }
}

export type AcliRunner = (args: string[]) => Promise<string>

export const defaultAcliRunner: AcliRunner = async (args) => {
  const { stdout } = await pexec('acli', args, {
    env: execEnv(), timeout: 60_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true,
  })
  return stdout.toString()
}

export async function getJiraAuthStatus(run: AcliRunner = defaultAcliRunner): Promise<JiraAuthStatus> {
  try {
    return parseAuthStatus(await run(['jira', 'auth', 'status']))
  } catch (err) {
    const error = err as { code?: string; stderr?: string; message?: string }
    if (error.code === 'ENOENT') return { installed: false, authenticated: false }
    return { installed: true, authenticated: false, error: stripAnsi(String(error.stderr || error.message || err)) }
  }
}

export function cancelJiraLogin(): void {
  activeCancel?.()
  activeCancel = null
  if (!activeLogin) return
  const process = activeLogin
  activeLogin = null
  try { process.kill() } catch { /* Already exited. */ }
}

export function inputJiraLogin(data: string): void {
  activeLogin?.write(data)
}

export function startJiraLogin(onEvent: (event: JiraAuthEvent) => void, run: AcliRunner = defaultAcliRunner): void {
  cancelJiraLogin()
  onEvent({ type: 'starting' })
  let process: nodePty.IPty
  try {
    process = nodePty.spawn('acli', ['jira', 'auth', 'login', '--web'], {
      name: 'xterm-256color', cwd: processCwd(), env: { ...execEnv(), TERM: 'xterm-256color' }, cols: 100, rows: 24,
    })
  } catch (err) {
    onEvent({ type: 'error', error: String((err as Error).message ?? err) })
    return
  }
  activeLogin = process
  let output = ''
  let sentUrl = false
  let cancelled = false
  activeCancel = () => { cancelled = true; onEvent({ type: 'cancelled' }) }
  process.onData((chunk) => {
    onEvent({ type: 'output', data: chunk })
    output += chunk
    if (output.length > 64_000) output = output.slice(-64_000)
    const clean = stripAnsi(output)
    const url = clean.match(/https:\/\/[^\s<>"']+/)?.[0]
    if (url && !sentUrl) { sentUrl = true; onEvent({ type: 'url', url }) }
  })
  process.onExit(async ({ exitCode }) => {
    if (activeLogin !== process) return
    activeLogin = null
    activeCancel = null
    if (cancelled) return
    if (exitCode === 0) {
      const status = await getJiraAuthStatus(run)
      onEvent(status.authenticated ? { type: 'success', status } : { type: 'error', error: status.error ?? '登入完成，但無法確認 Atlassian 帳號。' })
    } else {
      const clean = stripAnsi(output)
      const error = clean.match(/(?:✗\s*)?Error:[^\r\n]*/g)?.at(-1)
        ?? clean.split(/[\r\n]+/).map((line) => line.trim()).filter(Boolean).at(-1)
      onEvent({ type: 'error', error: error || `Atlassian 登入失敗（exit ${exitCode}）。` })
    }
  })
}

function processCwd(): string { return process.cwd() }

export async function logoutJira(run: AcliRunner = defaultAcliRunner): Promise<JiraAuthStatus> {
  await run(['jira', 'auth', 'logout'])
  return getJiraAuthStatus(run)
}
