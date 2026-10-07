import { spawn } from 'child_process'
import { execEnv } from './env'

/**
 * A line-delimited JSON conversation with a child process: one JSON value per
 * line each way. Lines that are not JSON are ignored, so a CLI's banner or log
 * output cannot break the exchange.
 */
export interface JsonLinesChannel {
  send(message: unknown): void
  /** Resolves with the first incoming message `match` accepts — including one that already arrived. */
  next(match: (message: unknown) => boolean): Promise<unknown>
  /** Ends the conversation and makes sure the process does not outlive it. */
  close(): void
}

export type OpenJsonLinesChannel = () => JsonLinesChannel

export interface JsonLinesProcessOptions {
  cwd: string
  /** Hard limit for the whole conversation; the process is killed when it passes. */
  timeoutMs: number
  env?: NodeJS.ProcessEnv
  /** How long a closed process may take to exit on its own before it is killed. */
  exitGraceMs?: number
  /** Runs once the process is gone, whatever ended it. */
  onExit?: () => void
}

/**
 * `args` must stay plain tokens: on Windows the command runs through cmd.exe
 * (see agent-print.ts for why) and is not escaped.
 */
export function spawnJsonLines(
  bin: string,
  args: string[],
  opts: JsonLinesProcessOptions
): JsonLinesChannel {
  const spawnOpts = { cwd: opts.cwd, env: opts.env ?? execEnv(), windowsHide: true }
  const proc = process.platform === 'win32'
    ? spawn([bin, ...args].join(' '), { ...spawnOpts, shell: true })
    : spawn(bin, args, spawnOpts)

  const inbox: unknown[] = []
  const waiters: { match: (m: unknown) => boolean; resolve: (m: unknown) => void; reject: (e: Error) => void }[] = []
  let failure: Error | null = null
  let stderr = ''
  let exited = false
  const finished = () => {
    if (exited) return
    exited = true
    opts.onExit?.()
  }

  const fail = (err: Error) => {
    if (failure) return
    failure = err
    for (const w of waiters.splice(0)) w.reject(err)
  }

  const deliver = (message: unknown) => {
    const i = waiters.findIndex((w) => w.match(message))
    if (i === -1) inbox.push(message)
    else waiters.splice(i, 1)[0].resolve(message)
  }

  let buffered = ''
  proc.stdout.setEncoding('utf8')
  proc.stdout.on('data', (chunk: string) => {
    buffered += chunk
    let nl: number
    while ((nl = buffered.indexOf('\n')) >= 0) {
      const line = buffered.slice(0, nl).trim()
      buffered = buffered.slice(nl + 1)
      if (!line) continue
      let message: unknown
      try {
        message = JSON.parse(line)
      } catch {
        continue
      }
      deliver(message)
    }
  })
  proc.stderr.setEncoding('utf8')
  proc.stderr.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-2048)
  })
  proc.on('error', (err) => {
    fail(err)
    // A process that never started emits no 'exit'.
    if (proc.pid === undefined) {
      clearTimeout(timer)
      finished()
    }
  })
  proc.on('exit', (code, signal) => {
    finished()
    clearTimeout(timer)
    clearTimeout(graceTimer)
    const reason = signal ? `was killed (${signal})` : `exited with code ${code}`
    fail(new Error(`${bin} ${reason}${stderr.trim() ? `: ${stderr.trim()}` : ''}`))
  })
  // A CLI that exits before reading stdin makes writes fail with EPIPE; the
  // exit above is the error worth reporting.
  proc.stdin.on('error', () => {})

  const kill = () => {
    if (exited) return
    // On Windows the CLI runs under cmd.exe: ending only cmd.exe would orphan
    // the CLI, which keeps our pipes — and so this process — alive.
    if (process.platform === 'win32' && proc.pid !== undefined) {
      spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true })
        .on('error', () => proc.kill())
      return
    }
    proc.kill()
  }
  const timer = setTimeout(() => {
    fail(new Error(`${bin} did not answer within ${opts.timeoutMs}ms`))
    kill()
  }, opts.timeoutMs)
  let graceTimer: ReturnType<typeof setTimeout> | undefined

  return {
    send(message) {
      if (!failure) proc.stdin.write(`${JSON.stringify(message)}\n`)
    },
    next(match) {
      const i = inbox.findIndex(match)
      if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0])
      if (failure) return Promise.reject(failure)
      return new Promise((resolve, reject) => waiters.push({ match, resolve, reject }))
    },
    close() {
      clearTimeout(timer)
      fail(new Error(`${bin} conversation closed`))
      proc.stdin.end()
      if (!exited && !graceTimer) graceTimer = setTimeout(kill, opts.exitGraceMs ?? 3000)
    },
  }
}
