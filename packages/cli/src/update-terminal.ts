import { spawn } from 'node:child_process'

interface TerminalCommand { cmd: string; args: string[]; waitForExit?: boolean }

/** No command text comes from the browser: the update command is fixed here. */
export function updateTerminalCommands(platform: NodeJS.Platform): TerminalCommand[] {
  if (platform === 'win32') {
    return [{ cmd: 'powershell.exe', args: ['-NoProfile', '-Command', "Start-Process cmd.exe -ArgumentList '/k vibeflow update'"], waitForExit: true }]
  }
  if (platform === 'darwin') {
    return [{ cmd: 'osascript', args: [
      '-e', 'tell application "Terminal" to activate',
      '-e', 'tell application "Terminal" to do script "sudo vibeflow update"',
    ], waitForExit: true }]
  }
  const command = 'sudo vibeflow update; exec sh'
  return [
    { cmd: 'gnome-terminal', args: ['--', 'sh', '-c', command] },
    { cmd: 'x-terminal-emulator', args: ['-e', 'sh', '-c', command] },
    { cmd: 'konsole', args: ['-e', 'sh', '-c', command] },
    { cmd: 'xfce4-terminal', args: ['--command', `sh -c '${command}'`] },
    { cmd: 'xterm', args: ['-e', 'sh', '-c', command] },
  ]
}

function launch(command: TerminalCommand): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command.cmd, command.args, {
      detached: !command.waitForExit,
      stdio: command.waitForExit ? ['ignore', 'ignore', 'pipe'] : 'ignore',
      windowsHide: false,
    })
    child.once('error', reject)
    if (command.waitForExit) {
      let stderr = ''
      child.stderr?.on('data', (chunk) => { stderr += String(chunk) })
      child.once('close', (code) => code === 0
        ? resolve()
        : reject(new Error(stderr.trim() || `無法開啟終端機（結束碼 ${code ?? 'unknown'}）`)))
    } else {
      child.once('spawn', () => { child.unref(); resolve() })
    }
  })
}

export async function openUpdateTerminal(
  platform: NodeJS.Platform = process.platform,
  run: (command: TerminalCommand) => Promise<void> = launch
): Promise<void> {
  if (platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    throw new Error('找不到圖形桌面，無法開啟更新終端機。')
  }
  for (const command of updateTerminalCommands(platform)) {
    try {
      await run(command)
      return
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }
  throw new Error('找不到可用的終端機，請手動執行更新指令。')
}
