import { execFile } from 'child_process'

export interface PickFolderOptions {
  /** Shown in the dialog's title or prompt. */
  title?: string
  /** Folder the dialog opens in. */
  defaultPath?: string
}

/**
 * `unsupported` = this machine has no dialog VibeFlow can drive (a Linux
 * without zenity / kdialog, a headless box); the frontend falls back to a
 * typed path.
 */
export type PickFolderResult =
  | { path: string }
  | { canceled: true }
  | { unsupported: true }

export interface DialogCommand {
  cmd: string
  args: string[]
  env?: Record<string, string>
  /** Exit codes that mean the user dismissed the dialog. */
  cancelCodes: number[]
  /** Required in stderr as well, where the exit code is shared with real failures. */
  cancelStderr?: RegExp
}

// Activating the script itself raises the dialog above the browser without
// asking for Automation access to another app. argv keeps the prompt and the
// path out of the AppleScript source, so neither needs quoting.
const MAC_SCRIPT = [
  'on run argv',
  'activate',
  'if (count of argv) > 1 then',
  'return POSIX path of (choose folder with prompt (item 1 of argv) default location (POSIX file (item 2 of argv)))',
  'end if',
  'return POSIX path of (choose folder with prompt (item 1 of argv))',
  'end run',
]

// The prompt and path arrive through the environment, so nothing the user
// typed is ever parsed as PowerShell. A TopMost owner form keeps the dialog
// above the browser.
const WINDOWS_SCRIPT = [
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
  'Add-Type -AssemblyName System.Windows.Forms',
  '$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }',
  '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
  '$dialog.Description = $env:VIBEFLOW_DIALOG_TITLE',
  '$dialog.ShowNewFolderButton = $true',
  'if ($env:VIBEFLOW_DIALOG_PATH) { $dialog.SelectedPath = $env:VIBEFLOW_DIALOG_PATH }',
  'if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { $dialog.SelectedPath }',
].join('; ')

/**
 * The commands that can show a folder dialog here, best first. Linux lists
 * both desktop tools; the first one installed is used.
 */
export function folderDialogCommands(
  platform: NodeJS.Platform,
  { title = '選擇資料夾', defaultPath }: PickFolderOptions = {}
): DialogCommand[] {
  if (platform === 'darwin') {
    return [
      {
        cmd: 'osascript',
        args: [...MAC_SCRIPT.flatMap((line) => ['-e', line]), title, ...(defaultPath ? [defaultPath] : [])],
        // osascript exits 1 on any script error; only -128 is "User canceled".
        cancelCodes: [1],
        cancelStderr: /-128/,
      },
    ]
  }
  if (platform === 'win32') {
    return [
      {
        cmd: 'powershell.exe',
        args: ['-NoProfile', '-NonInteractive', '-STA', '-Command', WINDOWS_SCRIPT],
        env: { VIBEFLOW_DIALOG_TITLE: title, VIBEFLOW_DIALOG_PATH: defaultPath ?? '' },
        cancelCodes: [],
      },
    ]
  }
  // zenity treats a trailing slash as "open inside this folder".
  const start = defaultPath ? `${defaultPath.replace(/\/+$/, '')}/` : undefined
  return [
    {
      cmd: 'zenity',
      args: ['--file-selection', '--directory', `--title=${title}`, ...(start ? [`--filename=${start}`] : [])],
      cancelCodes: [1],
    },
    {
      cmd: 'kdialog',
      args: ['--getexistingdirectory', defaultPath ?? '.', '--title', title],
      cancelCodes: [1],
    },
  ]
}

/** The picked folder without the trailing separator macOS adds; a root keeps its own. */
export function parseFolderDialogOutput(stdout: string): string | null {
  const line = stdout.trim()
  if (!line) return null
  if (line === '/' || /^[A-Za-z]:[\\/]$/.test(line)) return line
  return line.replace(/[\\/]+$/, '')
}

function run(command: DialogCommand): Promise<PickFolderResult | 'missing'> {
  return new Promise((resolve, reject) => {
    execFile(
      command.cmd,
      command.args,
      { windowsHide: false, encoding: 'utf8', env: { ...process.env, ...command.env } },
      (err, stdout, stderr) => {
        if (err) {
          const code = (err as NodeJS.ErrnoException).code
          if (code === 'ENOENT') return resolve('missing')
          const canceled =
            typeof code === 'number' &&
            command.cancelCodes.includes(code) &&
            (!command.cancelStderr || command.cancelStderr.test(stderr))
          if (canceled) return resolve({ canceled: true })
          return reject(new Error(`無法開啟資料夾選擇視窗：${stderr.trim() || err.message}`))
        }
        const picked = parseFolderDialogOutput(stdout)
        resolve(picked ? { path: picked } : { canceled: true })
      }
    )
  })
}

/** Show the OS folder dialog on this machine and wait for the user. */
export async function pickFolderWithOs(options: PickFolderOptions = {}): Promise<PickFolderResult> {
  if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    return { unsupported: true }
  }
  for (const command of folderDialogCommands(process.platform, options)) {
    const result = await run(command)
    if (result !== 'missing') return result
  }
  return { unsupported: true }
}
