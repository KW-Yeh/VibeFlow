import os from 'os'

let cached: Record<string, string> | null = null

/**
 * Build a child-process env with a sane PATH. Apps launched from Finder inherit
 * a minimal PATH (`/usr/bin:/bin:…`), so user-installed CLIs — `claude`, and
 * crucially `git-lfs` (invoked by git's post-checkout/-commit hooks) — would not
 * be found. We augment PATH with the common bin locations as a fallback so that
 * both spawned shells (pty) and direct git child processes resolve them.
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
  const extras = [
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
  const parts = (env.PATH ?? '').split(':').filter(Boolean)
  for (const p of extras) if (!parts.includes(p)) parts.push(p)
  env.PATH = parts.join(':')
  return cached = env
}

/**
 * Env for child processes spawned via `child_process` (git, claude, which):
 * the real process env with the augmented PATH layered on. Keeps the
 * `NodeJS.ProcessEnv` shape that `execFile`'s options require — a single
 * definition shared by every exec call site.
 */
export function execEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: buildEnv().PATH }
}
