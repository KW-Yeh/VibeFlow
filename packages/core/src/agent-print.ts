import { spawn } from 'child_process'
import { execEnv } from './env'

export interface AgentPrintOptions {
  cwd: string
  /** Kill the run after this many ms. */
  timeout?: number
  /** Cap on collected stdout, in bytes. */
  maxBuffer?: number
  /** Defaults to the augmented `execEnv()`. */
  env?: NodeJS.ProcessEnv
}

/**
 * Run an agent CLI headlessly and resolve with its stdout.
 *
 * The prompt goes in on stdin rather than as an argument. On Windows an
 * npm-installed CLI is a `claude.cmd` shim, which `execFile` cannot start
 * without a shell — and cmd.exe cannot carry a multi-line, quote-laden prompt
 * as an argument. With the prompt on stdin the command line is only fixed
 * flags, so going through cmd.exe there is safe and finds `.cmd` and `.exe`
 * alike via PATHEXT. `args` must therefore stay plain tokens — never user text.
 */
export function runAgentPrint(
  bin: string,
  args: string[],
  input: string,
  opts: AgentPrintOptions
): Promise<string> {
  const maxBuffer = opts.maxBuffer ?? 1024 * 1024
  return new Promise((resolve, reject) => {
    const spawnOpts = {
      cwd: opts.cwd,
      env: opts.env ?? execEnv(),
      timeout: opts.timeout,
      windowsHide: true,
    }
    // cmd.exe gets one pre-joined command line: handing spawn args alongside
    // `shell` concatenates them unescaped anyway, and Node deprecates it.
    const proc = process.platform === 'win32'
      ? spawn([bin, ...args].join(' '), { ...spawnOpts, shell: true })
      : spawn(bin, args, spawnOpts)

    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (err: Error | null) => {
      if (settled) return
      settled = true
      if (err) reject(err)
      else resolve(stdout)
    }

    proc.stdout.setEncoding('utf8')
    proc.stderr.setEncoding('utf8')
    proc.stdout.on('data', (chunk: string) => {
      stdout += chunk
      if (Buffer.byteLength(stdout) > maxBuffer) {
        proc.kill()
        finish(new Error(`${bin} output exceeded ${maxBuffer} bytes`))
      }
    })
    proc.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-4096)
    })
    proc.on('error', finish)
    proc.on('close', (code, signal) => {
      if (code === 0) return finish(null)
      const reason = signal ? `was killed (${signal})` : `exited with code ${code}`
      finish(new Error(`${bin} ${reason}${stderr.trim() ? `: ${stderr.trim()}` : ''}`))
    })
    // A CLI that exits before reading stdin makes this write fail with EPIPE;
    // the exit code above is the error worth reporting.
    proc.stdin.on('error', () => {})
    proc.stdin.end(input)
  })
}
