import { spawnSync } from 'child_process'
import { createRequire } from 'node:module'
import { app, type BrowserWindow } from 'electron'

const require = createRequire(import.meta.url)

export type RemoteUpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'unsupported'

export interface RemoteUpdateSnapshot {
  status: RemoteUpdateStatus
  currentVersion: string
  version?: string
  releaseName?: string
  releaseDate?: string
  percent?: number
  transferred?: number
  total?: number
  bytesPerSecond?: number
  message?: string
}

interface UpdateInfo {
  version: string
  releaseName?: string | null
  releaseDate: string
}

interface ProgressInfo {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

interface AutoUpdater {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  autoRunAppAfterInstall: boolean
  logger: unknown
  on(event: 'checking-for-update', listener: () => void): void
  on(event: 'update-available', listener: (info: UpdateInfo) => void): void
  on(event: 'update-not-available', listener: (info: UpdateInfo) => void): void
  on(event: 'download-progress', listener: (progress: ProgressInfo) => void): void
  on(event: 'update-downloaded', listener: (info: UpdateInfo) => void): void
  on(event: 'update-cancelled', listener: (info: UpdateInfo) => void): void
  on(event: 'error', listener: (err: Error) => void): void
  checkForUpdates(): Promise<{ updateInfo: UpdateInfo } | null>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

let snapshot: RemoteUpdateSnapshot = {
  status: 'idle',
  currentVersion: app.getVersion(),
}
let configured = false
let checking = false
let downloading = false
let updateInfo: UpdateInfo | null = null
let mainWindow: BrowserWindow | null = null
let updater: AutoUpdater | null = null

function toInfoPatch(info: UpdateInfo): Partial<RemoteUpdateSnapshot> {
  return {
    version: info.version,
    releaseName: info.releaseName ?? undefined,
    releaseDate: info.releaseDate,
  }
}

function publish(patch: Partial<RemoteUpdateSnapshot>): RemoteUpdateSnapshot {
  snapshot = {
    ...snapshot,
    currentVersion: app.getVersion(),
    ...patch,
  }
  if (mainWindow && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('remote-update:state', snapshot)
  }
  return snapshot
}

function unsupportedMessage(): string {
  if (!app.isPackaged) return '遠端更新只會在 packaged app 中啟用。'
  if (process.platform === 'darwin') {
    return '遠端更新需要 Developer ID 簽署的 macOS app。'
  }
  return '目前環境沒有可用的更新設定。'
}

function isSupportedForRemoteUpdates(): boolean {
  if (!app.isPackaged) return false
  if (process.platform !== 'darwin') return true

  try {
    const result = spawnSync('codesign', ['-dv', '--verbose=4', app.getPath('exe')], {
      encoding: 'utf8',
    })
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
    return (
      result.status === 0 &&
      !output.includes('Signature=adhoc') &&
      !output.includes('TeamIdentifier=not set') &&
      /Authority=(Developer ID Application|Apple)/.test(output)
    )
  } catch {
    return false
  }
}

function unsupportedSnapshot(): RemoteUpdateSnapshot {
  return publish({
    status: 'unsupported',
    message: unsupportedMessage(),
  })
}

async function getAutoUpdater(): Promise<AutoUpdater | null> {
  if (!isSupportedForRemoteUpdates()) return null
  if (!updater) {
    const updaterModule = ['electron', 'updater'].join('-')
    updater = (require(updaterModule) as { autoUpdater: AutoUpdater }).autoUpdater
  }
  return updater
}

export function getRemoteUpdateSnapshot(): RemoteUpdateSnapshot {
  return snapshot
}

export async function configureRemoteUpdates(window: BrowserWindow): Promise<void> {
  mainWindow = window
  if (configured) return
  configured = true

  const autoUpdater = await getAutoUpdater()
  if (!autoUpdater) {
    unsupportedSnapshot()
    return
  }

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.autoRunAppAfterInstall = true
  autoUpdater.logger = null

  autoUpdater.on('checking-for-update', () => {
    checking = true
    publish({ status: 'checking', message: undefined })
  })

  autoUpdater.on('update-available', (info) => {
    checking = false
    updateInfo = info
    publish({
      status: 'available',
      ...toInfoPatch(info),
      percent: undefined,
      transferred: undefined,
      total: undefined,
      bytesPerSecond: undefined,
      message: undefined,
    })
  })

  autoUpdater.on('update-not-available', (info) => {
    checking = false
    updateInfo = null
    publish({
      status: 'not-available',
      ...toInfoPatch(info),
      message: undefined,
    })
  })

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    downloading = true
    publish({
      status: 'downloading',
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
      message: undefined,
    })
  })

  autoUpdater.on('update-downloaded', (event) => {
    downloading = false
    publish({
      status: 'downloaded',
      ...toInfoPatch(event),
      percent: 100,
      message: undefined,
    })
  })

  autoUpdater.on('update-cancelled', (info) => {
    checking = false
    downloading = false
    updateInfo = info
    publish({
      status: 'available',
      ...toInfoPatch(info),
      message: '下載已取消，可重新開始。',
    })
  })

  autoUpdater.on('error', (err) => {
    checking = false
    downloading = false
    publish({
      status: 'error',
      message: err.message || String(err),
    })
  })
}

export async function checkForRemoteUpdates(): Promise<RemoteUpdateSnapshot> {
  const autoUpdater = await getAutoUpdater()
  if (!autoUpdater) return unsupportedSnapshot()
  if (checking) return snapshot
  try {
    checking = true
    publish({ status: 'checking', message: undefined })
    const result = await autoUpdater.checkForUpdates()
    if (!result) {
      checking = false
      return publish({
        status: 'unsupported',
        message: '目前環境沒有可用的更新設定。',
      })
    }
    updateInfo = result.updateInfo
    return snapshot
  } catch (err) {
    checking = false
    return publish({
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
    })
  }
}

export async function downloadRemoteUpdate(): Promise<RemoteUpdateSnapshot> {
  const autoUpdater = await getAutoUpdater()
  if (!autoUpdater) return unsupportedSnapshot()
  if (downloading) return snapshot
  if (snapshot.status === 'downloaded') return snapshot

  try {
    if (!updateInfo) {
      const checked = await checkForRemoteUpdates()
      if (checked.status !== 'available') return checked
    }

    downloading = true
    publish({ status: 'downloading', percent: 0, message: undefined })
    await autoUpdater.downloadUpdate()
    return snapshot
  } catch (err) {
    downloading = false
    return publish({
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
    })
  }
}

export function installRemoteUpdate(): void {
  if (snapshot.status !== 'downloaded') return
  updater?.quitAndInstall(false, true)
}
