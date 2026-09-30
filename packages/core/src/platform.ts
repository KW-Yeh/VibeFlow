import { execFile } from 'child_process'
import { homedir } from 'os'
import path from 'path'

/**
 * Everything core needs from the host it runs in. Core never imports electron:
 * the Electron shell registers an implementation backed by `app` / `shell` /
 * `dialog`, and a plain Node host (CLI, tests, the future Web UI server)
 * registers `createNodePlatform()`.
 */
export interface PlatformServices {
  /**
   * Directory holding the app's persisted state (`vibeflow-state.json`, the
   * library, …). Electron's `userData`; resolved per call because Electron
   * redirects it in dev before anything is read.
   */
  userDataDir(): string
  /**
   * Root of a source checkout when running from one, `null` when packaged.
   * The board CLI (`scripts/vibeflow.mjs`) exists only in a checkout.
   */
  sourceRoot(): string | null
  /** Open a URL in the default browser. */
  openExternal(url: string): Promise<void>
  /** Open a local path with the OS; resolves to an error string, empty on success. */
  openPath(target: string): Promise<string>
  /** Ask the user for a path; `null` when cancelled or the host has no picker. */
  pickPath(options: PickPathOptions): Promise<string | null>
}

export interface PickPathOptions {
  title: string
  kind: 'directory' | 'file'
  /** Offer a "New Folder" button (directories only). */
  allowCreate?: boolean
}

let _platform: PlatformServices | null = null

/** Register the host's services. Call once, before any store is touched. */
export function setPlatform(platform: PlatformServices): void {
  _platform = platform
}

export function getPlatform(): PlatformServices {
  if (!_platform) {
    throw new Error('PlatformServices not registered: call setPlatform() at startup')
  }
  return _platform
}

/**
 * Electron's `appData` for this platform — the parent of the app's userData.
 * Mirrors Electron's own resolution so a Node host finds the same store.
 */
export function appDataDir(): string {
  const home = homedir()
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support')
  if (process.platform === 'win32') return process.env.APPDATA || path.join(home, 'AppData', 'Roaming')
  return process.env.XDG_CONFIG_HOME || path.join(home, '.config')
}

/**
 * Electron names userData after package.json's `name` (`vibeflow`), and
 * main.ts suffixes it with " (development)" in dev. macOS and Windows compare
 * these case-insensitively, so the documented `VibeFlow` spelling is the same
 * directory there.
 */
export function defaultUserDataDir(profile: 'dev' | 'prod' = 'prod'): string {
  return path.join(appDataDir(), profile === 'dev' ? 'vibeflow (development)' : 'vibeflow')
}

/** The OS command that opens a file or URL with its default handler. */
function openCommand(target: string): [string, string[]] {
  // Not `cmd /c start`: cmd re-parses the line, so `&` in a URL splits it.
  if (process.platform === 'win32') return ['rundll32', ['url.dll,FileProtocolHandler', target]]
  if (process.platform === 'darwin') return ['open', [target]]
  return ['xdg-open', [target]]
}

function openWithOs(target: string): Promise<string> {
  const [cmd, args] = openCommand(target)
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true }, (err) => resolve(err ? err.message : ''))
  })
}

export interface NodePlatformOptions {
  userDataDir?: string
  sourceRoot?: string | null
}

/** Services for a host without Electron. It has no native picker. */
export function createNodePlatform(options: NodePlatformOptions = {}): PlatformServices {
  const userData = options.userDataDir ?? defaultUserDataDir()
  const root = options.sourceRoot ?? null
  return {
    userDataDir: () => userData,
    sourceRoot: () => root,
    openExternal: async (url) => {
      const err = await openWithOs(url)
      if (err) throw new Error(err)
    },
    openPath: (target) => openWithOs(target),
    pickPath: async () => null,
  }
}
