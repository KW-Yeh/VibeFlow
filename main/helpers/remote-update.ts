import { app, type BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { ProgressInfo, UpdateInfo } from 'electron-updater'

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

let snapshot: RemoteUpdateSnapshot = {
  status: 'idle',
  currentVersion: app.getVersion(),
}
let configured = false
let checking = false
let downloading = false
let updateInfo: UpdateInfo | null = null
let mainWindow: BrowserWindow | null = null

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

function unsupportedSnapshot(): RemoteUpdateSnapshot {
  return publish({
    status: 'unsupported',
    message: '遠端更新只會在 packaged app 中啟用。',
  })
}

export function getRemoteUpdateSnapshot(): RemoteUpdateSnapshot {
  return snapshot
}

export function configureRemoteUpdates(window: BrowserWindow): void {
  mainWindow = window
  if (configured) return
  configured = true

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.autoRunAppAfterInstall = true
  autoUpdater.logger = null

  if (!app.isPackaged) {
    publish({
      status: 'unsupported',
      message: '遠端更新只會在 packaged app 中啟用。',
    })
    return
  }

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
  if (!app.isPackaged) return unsupportedSnapshot()
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
  if (!app.isPackaged) return unsupportedSnapshot()
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
  autoUpdater.quitAndInstall(false, true)
}
