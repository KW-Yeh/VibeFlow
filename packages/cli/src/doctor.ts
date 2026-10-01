import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { AGENT_CLIS, detectAgents } from '../../core/src/agents'
import { execEnv } from '../../core/src/env'
import { findGitBash } from '../../core/src/git-bash'
import { hasTmux } from '../../core/src/tmux-backend'
import { ensurePtySpawnHelper } from '../../core/src/pty-helper'

const pexec = promisify(execFile)

export type CheckLevel = 'ok' | 'warn' | 'fail'

export interface Check {
  /** Stable id for `vibeflow doctor --skip <id,…>`. */
  id: string
  name: string
  level: CheckLevel
  detail: string
  /** How to fix it; present when level is not ok. */
  fix?: string
}

export interface DoctorOptions {
  userDataDir: string
  webDir: string | null
  /** Check ids to leave out, e.g. `agents` on a CI runner without claude/codex. */
  skip?: string[]
}

function parseVersion(text: string): number[] {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(text)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : []
}

export function versionAtLeast(have: number[], want: number[]): boolean {
  for (let i = 0; i < want.length; i++) {
    const h = have[i] ?? 0
    if (h !== want[i]) return h > want[i]
  }
  return true
}

async function run(cmd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await pexec(cmd, args, { env: execEnv(), timeout: 10_000, windowsHide: true })
    return String(stdout).trim()
  } catch {
    return null
  }
}

function installHint(tool: 'git' | 'tmux' | 'node'): string {
  const mac = { git: 'xcode-select --install 或 brew install git', tmux: 'brew install tmux', node: 'brew install node@22' }
  const linux = { git: 'sudo apt install git', tmux: 'sudo apt install tmux', node: '以 nvm 或發行版套件安裝 Node.js 22' }
  const win = { git: '安裝 Git for Windows：https://git-scm.com/download/win', tmux: '', node: 'winget install OpenJS.NodeJS.LTS' }
  const table = process.platform === 'darwin' ? mac : process.platform === 'win32' ? win : linux
  return table[tool]
}

/** A pty can be spawned: node-pty's native binary loads on this Node. */
async function checkNodePty(): Promise<Check> {
  const unrepaired = ensurePtySpawnHelper()
  if (unrepaired.length > 0) {
    return {
      id: 'node-pty',
      name: 'node-pty',
      level: 'fail',
      detail: `spawn-helper 沒有執行權限：${unrepaired[0].error}`,
      fix: unrepaired.map((f) => `chmod +x "${f.path}"`).join(' && '),
    }
  }
  try {
    const pty = await import('node-pty')
    const ok = await new Promise<boolean>((resolve) => {
      const proc = pty.spawn(process.execPath, ['-e', 'process.stdout.write("vf-ok")'], {
        cols: 80,
        rows: 24,
        cwd: process.cwd(),
        env: process.env as Record<string, string>,
      })
      let out = ''
      const timer = setTimeout(() => resolve(false), 8000)
      proc.onData((d) => (out += d))
      proc.onExit(() => {
        clearTimeout(timer)
        resolve(out.includes('vf-ok'))
      })
    })
    return ok
      ? { id: 'node-pty', name: 'node-pty', level: 'ok', detail: '可以開啟終端機' }
      : { id: 'node-pty', name: 'node-pty', level: 'fail', detail: 'pty 啟動後沒有輸出', fix: 'npm rebuild node-pty' }
  } catch (err) {
    return {
      id: 'node-pty',
      name: 'node-pty',
      level: 'fail',
      detail: `無法載入：${(err as Error).message.split('\n')[0]}`,
      fix: `npm rebuild node-pty（需要 C++ 編譯工具：${process.platform === 'win32' ? 'Visual Studio Build Tools' : process.platform === 'darwin' ? 'xcode-select --install' : 'build-essential python3'}）`,
    }
  }
}

export async function runDoctor(options: DoctorOptions): Promise<Check[]> {
  const checks: Check[] = []

  const nodeVersion = parseVersion(process.versions.node)
  checks.push(
    versionAtLeast(nodeVersion, [22, 0])
      ? { id: 'node', name: 'Node.js', level: 'ok', detail: `v${process.versions.node}` }
      : { id: 'node', name: 'Node.js', level: 'fail', detail: `v${process.versions.node}，需要 22 以上`, fix: installHint('node') }
  )

  const git = await run('git', ['--version'])
  if (!git) {
    checks.push({ id: 'git', name: 'Git', level: 'fail', detail: 'PATH 中找不到 git', fix: installHint('git') })
  } else {
    const v = parseVersion(git)
    checks.push(
      versionAtLeast(v, [2, 30])
        ? { id: 'git', name: 'Git', level: 'ok', detail: git }
        : { id: 'git', name: 'Git', level: 'fail', detail: `${git}，需要 2.30 以上（git worktree 功能）`, fix: installHint('git') }
    )
  }

  if (process.platform === 'win32') {
    const bash = findGitBash()
    checks.push(
      bash
        ? { id: 'git-bash', name: 'Git Bash', level: 'ok', detail: bash }
        : {
            id: 'git-bash',
            name: 'Git Bash',
            level: 'fail',
            detail: '找不到 bash.exe，agent 啟動指令無法執行',
            fix: '安裝 Git for Windows，或設定環境變數 GIT_BASH_PATH',
          }
    )
    checks.push({
      id: 'tmux',
      name: 'tmux',
      level: 'warn',
      detail: 'Windows 沒有 tmux：終端機由 core 直接持有，關閉 vibeflow 後 agent 會一起結束',
      fix: '要讓任務在背景持續執行，請在 WSL 內使用 vibeflow',
    })
  } else {
    const tmux = await run('tmux', ['-V'])
    checks.push(
      tmux && hasTmux()
        ? { id: 'tmux', name: 'tmux', level: 'ok', detail: `${tmux}（任務可在背景持續執行）` }
        : {
            id: 'tmux',
            name: 'tmux',
            level: 'warn',
            detail: '未安裝：改用 node-pty，關閉 vibeflow 後 agent 會一起結束',
            fix: installHint('tmux'),
          }
    )
  }

  checks.push(await checkNodePty())

  const agents = await detectAgents()
  checks.push(
    agents.length > 0
      ? { id: 'agents', name: 'Agent CLI', level: 'ok', detail: agents.map((a) => a.name).join('、') }
      : {
          id: 'agents',
          name: 'Agent CLI',
          level: 'fail',
          detail: `PATH 中找不到 ${AGENT_CLIS.map((a) => a.bin).join(' 或 ')}`,
          fix: 'npm i -g @anthropic-ai/claude-code（或 npm i -g @openai/codex），然後登入',
        }
  )

  if (options.webDir) {
    checks.push({ id: 'web', name: 'Web UI', level: 'ok', detail: options.webDir })
  } else {
    checks.push({
      id: 'web',
      name: 'Web UI',
      level: 'fail',
      detail: '找不到 Web UI 的靜態檔',
      fix: '從原始碼執行時先跑 npm run build:web',
    })
  }

  try {
    fs.mkdirSync(options.userDataDir, { recursive: true })
    const probe = path.join(options.userDataDir, `.doctor-${process.pid}`)
    fs.writeFileSync(probe, '')
    fs.rmSync(probe)
    checks.push({ id: 'data', name: '資料目錄', level: 'ok', detail: options.userDataDir })
  } catch (err) {
    checks.push({
      id: 'data',
      name: '資料目錄',
      level: 'fail',
      detail: `${options.userDataDir} 無法寫入：${(err as Error).message}`,
      fix: '確認目錄權限，或以 --store-path 指定其他目錄',
    })
  }

  const skip = new Set(options.skip ?? [])
  return checks.filter((c) => !skip.has(c.id))
}

const MARK: Record<CheckLevel, string> = { ok: '✔', warn: '⚠', fail: '✖' }

export function formatChecks(checks: Check[]): string {
  const lines = checks.map((c) => {
    const head = `${MARK[c.level]} ${c.name}：${c.detail}`
    return c.fix && c.level !== 'ok' ? `${head}\n    → ${c.fix}` : head
  })
  const failed = checks.filter((c) => c.level === 'fail').length
  lines.push('', failed ? `${failed} 項需要處理。` : '一切正常。')
  return lines.join('\n')
}
