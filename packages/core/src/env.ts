import fs from 'fs'
import os from 'os'
import path from 'path'

let cached: Record<string, string> | null = null

/**
 * Build a child-process env with a sane PATH. Apps launched outside a login
 * shell can inherit a minimal PATH, so user-installed CLIs such as `claude`,
 * `codex`, and tools invoked by git hooks may not be found. We
 * augment PATH with common bin locations per platform.
 *
 * Memoized: the process PATH does not change during a run.
 */
export function buildEnv(): Record<string, string> {
  if (cached) return cached
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') env[k] = v
  }

  const home = os.homedir()
  const pathKey =
    Object.keys(env).find((k) => k.toLowerCase() === 'path') ??
    (process.platform === 'win32' ? 'Path' : 'PATH')
  const delimiter = path.delimiter
  const extras = process.platform === 'win32'
    ? [
        process.env.APPDATA ? path.join(process.env.APPDATA, 'npm') : null,
        process.env.LOCALAPPDATA
          ? path.join(
              process.env.LOCALAPPDATA,
              'Programs',
              'OpenAI',
              'Codex',
              'bin'
            )
          : null,
        process.env.LOCALAPPDATA
          ? path.join(process.env.LOCALAPPDATA, 'Programs', 'nodejs')
          : null,
        process.env.ProgramFiles
          ? path.join(process.env.ProgramFiles, 'nodejs')
          : null,
        process.env.ProgramFiles
          ? path.join(process.env.ProgramFiles, 'Git', 'cmd')
          : null,
        path.join(home, '.local', 'bin'),
        path.join(home, '.cargo', 'bin'),
        path.join(home, 'scoop', 'shims'),
      ]
    : [
        '/opt/homebrew/bin',
        '/opt/homebrew/sbin',
        '/usr/local/bin',
        '/usr/bin',
        '/bin',
        '/usr/sbin',
        '/sbin',
        `${home}/.local/bin`,
        `${home}/.npm-global/bin`,
      ]

  const seen = new Set<string>()
  const parts = (env[pathKey] ?? '')
    .split(delimiter)
    .filter(Boolean)
    .filter((p) => {
      const key = process.platform === 'win32' ? p.toLowerCase() : p
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

  for (const p of extras) {
    if (!p) continue
    const key = process.platform === 'win32' ? p.toLowerCase() : p
    if (seen.has(key)) continue
    seen.add(key)
    parts.push(p)
  }

  env[pathKey] = parts.join(delimiter)
  cached = env
  return cached
}

/**
 * Env for child processes spawned via `child_process` and PTY sessions. Keeps
 * the platform's canonical PATH key (`Path` on Windows, `PATH` elsewhere).
 */
export function execEnv(): NodeJS.ProcessEnv {
  // buildEnv() copies all of process.env, so NODE_ENV is present at runtime;
  // the index-signature type just doesn't prove it to the stricter ProcessEnv.
  return { ...buildEnv() } as NodeJS.ProcessEnv
}

/**
 * node-pty on Windows looks a relative file up in the host's own Path by its
 * exact name — no `.exe` appended, and not the augmented `execEnv()` Path — so
 * a bare `acli` or `gh` is "File not found". Resolve it to a full path there; other
 * platforms keep the bare name.
 */
export function resolvePtyFile(bin: string, env: NodeJS.ProcessEnv = execEnv()): string {
  if (process.platform !== 'win32' || path.isAbsolute(bin)) return bin
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path')
  const dirs = (pathKey ? env[pathKey] ?? '' : '').split(path.delimiter).filter(Boolean)
  const names = path.extname(bin) ? [bin] : [`${bin}.exe`, `${bin}.com`]
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name)
      if (fs.existsSync(candidate)) return candidate
    }
  }
  return bin
}
