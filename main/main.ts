import path from 'path'
import { app, ipcMain, type BrowserWindow } from 'electron'
import serve from 'electron-serve'
import { createWindow } from './helpers/create-window'
import { createElectronPlatform } from './helpers/electron-platform'
import { setPlatform } from '../packages/core/src/platform'
import { createCore, type Core, type CoreHandlers } from '../packages/core/src/service'
import { EventBus } from '../packages/core/src/events'
import { createSessionBackend } from '../packages/core/src/sessions'
import { relaunchApp, stopUpdateWatcher, watchForNewBuild } from './helpers/update'
import {
  checkForRemoteUpdates,
  configureRemoteUpdates,
  downloadRemoteUpdate,
  getRemoteUpdateSnapshot,
  installRemoteUpdate,
} from './helpers/remote-update'

const isProd = process.env.NODE_ENV === 'production'

let mainWindowRef: BrowserWindow | null = null
let core: Core | null = null
let stopStoreWatch: (() => void) | null = null

if (isProd) {
  serve({ directory: 'app' })
} else {
  app.setPath('userData', `${app.getPath('userData')} (development)`)
}

// After the userData redirect and before anything opens a store.
setPlatform(createElectronPlatform(() => mainWindowRef))

/** Channels the renderer fires with `send` rather than `invoke`. */
const FIRE_AND_FORGET = new Set(['pty:input', 'pty:resize', 'pty:kill'])

/** Desktop-only channels: hot update of the bundle and electron-updater. */
const electronHandlers: CoreHandlers = {
  // Restart into the build currently on disk (after rebuild.sh --install
  // replaced the bundle). app.relaunch re-executes the same .app path, so
  // the new code is picked up.
  'app:relaunch': () => relaunchApp(),
  'remote-update:getState': () => getRemoteUpdateSnapshot(),
  'remote-update:check': () => checkForRemoteUpdates(),
  'remote-update:download': () => downloadRemoteUpdate(),
  'remote-update:install': () => installRemoteUpdate(),
}

function registerIpcHandlers(handlers: CoreHandlers): void {
  for (const [channel, handler] of Object.entries(handlers)) {
    if (FIRE_AND_FORGET.has(channel)) {
      ipcMain.on(channel, (_event, ...args) => {
        void Promise.resolve(handler(...args)).catch((err) => console.error(`[${channel}]`, err))
      })
    } else {
      ipcMain.handle(channel, (_event, ...args) => handler(...args))
    }
  }
}

;(async () => {
  await app.whenReady()

  const mainWindow = (mainWindowRef = createWindow('main', {
    width: 1000,
    height: 600,
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.js'),
    },
  }))

  mainWindow.maximize()

  const bus = new EventBus()
  // The desktop app keeps today's behaviour: sessions end with the app.
  // VIBEFLOW_SESSION_BACKEND=tmux opts into sessions that outlive it.
  const sessions = createSessionBackend(bus.sink(), {
    prefer: process.env.VIBEFLOW_SESSION_BACKEND === 'tmux' ? 'tmux' : 'pty',
    stateDir: app.getPath('userData'),
  })
  core = createCore({ sessions, bus, version: app.getVersion() })
  registerIpcHandlers({ ...core.handlers, ...electronHandlers })

  bus.on((channel, payload) => {
    if (!mainWindow.webContents.isDestroyed()) mainWindow.webContents.send(channel, payload)
  })
  // Push fresh state after external writes (e.g. CLI) so the board refreshes.
  stopStoreWatch = core.watchStore()

  // Notify the renderer when a newer build replaces the running bundle
  // (e.g. `./rebuild.sh --install`), so it can offer a one-click restart.
  watchForNewBuild(() => bus.emit('update:available', undefined))

  configureRemoteUpdates(mainWindow)
  setTimeout(() => {
    void checkForRemoteUpdates()
  }, 3000)

  if (isProd) {
    await mainWindow.loadURL('app://./home')
  } else {
    const port = process.argv[2]
    await mainWindow.loadURL(`http://localhost:${port}/home`)
    mainWindow.webContents.openDevTools()
  }
})()

function shutdown(): void {
  stopStoreWatch?.()
  core?.shutdown()
}

app.on('window-all-closed', () => {
  shutdown()
  app.quit()
})

app.on('before-quit', () => {
  shutdown()
  stopUpdateWatcher()
})
