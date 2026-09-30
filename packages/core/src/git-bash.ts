import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import path from 'path'
import { execEnv } from './env'

/**
 * Locating Git Bash on Windows. Every agent launch command is POSIX sh
 * (`export`, `if [ -f … ]`, `'\''` quoting), so on Windows it has to run under
 * Git for Windows' bash.exe — PowerShell cannot execute it.
 *
 * `where bash` is deliberately not consulted: it usually finds
 * `System32\bash.exe`, the WSL launcher, which runs the command in a Linux
 * distro that cannot see the Windows worktree the same way.
 */

type Env = Record<string, string | undefined>

/**
 * bash.exe candidates, most explicit first: the user's override, the
 * locations of the standard installers, then whatever sits next to the `git`
 * on PATH (Git for Windows keeps `git.exe` in `cmd\`, `bin\` or
 * `mingw64\bin\`, and `bash.exe` in `bin\` of the same root).
 */
export function gitBashCandidates(env: Env, gitOnPath: string[] = []): string[] {
  const win = path.win32
  const candidates = [
    env.GIT_BASH_PATH,
    // Claude Code's own override, so one setting serves both.
    env.CLAUDE_CODE_GIT_BASH_PATH,
    env.ProgramFiles && win.join(env.ProgramFiles, 'Git', 'bin', 'bash.exe'),
    env['ProgramFiles(x86)'] && win.join(env['ProgramFiles(x86)'], 'Git', 'bin', 'bash.exe'),
    env.LOCALAPPDATA && win.join(env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'),
    // Scoop puts a shim on PATH, so the git root cannot be derived from it.
    env.USERPROFILE && win.join(env.USERPROFILE, 'scoop', 'apps', 'git', 'current', 'bin', 'bash.exe'),
  ]
  for (const gitExe of gitOnPath) {
    let dir = win.dirname(gitExe)
    if (/[\\/]mingw64[\\/]bin$/i.test(dir)) dir = win.dirname(win.dirname(dir))
    else if (/^(cmd|bin)$/i.test(win.basename(dir))) dir = win.dirname(dir)
    else continue
    candidates.push(win.join(dir, 'bin', 'bash.exe'))
  }
  return candidates.filter((c): c is string => Boolean(c))
}

function gitExecutablesOnPath(): string[] {
  try {
    return execFileSync('where.exe', ['git'], {
      encoding: 'utf8',
      env: execEnv(),
      windowsHide: true,
    })
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

let found: string | null = null

/**
 * Absolute path of Git Bash, or null when none is installed (and always null
 * off Windows, where the login shell is used instead). Only a hit is cached:
 * a user who installs Git after a miss should not have to restart the app.
 */
export function findGitBash(): string | null {
  if (process.platform !== 'win32') return null
  if (found && existsSync(found)) return found
  const env = execEnv()
  const hit =
    gitBashCandidates(env).find((c) => existsSync(c)) ??
    gitBashCandidates({}, gitExecutablesOnPath()).find((c) => existsSync(c)) ??
    null
  found = hit
  return hit
}

/** Shown in the terminal when a launch cannot run because Git Bash is missing. */
export const GIT_BASH_MISSING_MESSAGE =
  '找不到 Git Bash：VibeFlow 的啟動指令需要 Git for Windows 的 bash.exe 才能執行。' +
  '請安裝 Git for Windows（https://git-scm.com/download/win），' +
  '或把環境變數 GIT_BASH_PATH 設成 bash.exe 的完整路徑後重新啟動 VibeFlow。'
