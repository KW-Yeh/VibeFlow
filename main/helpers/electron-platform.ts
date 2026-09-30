import { app, dialog, shell, type BrowserWindow } from 'electron'
import type { PlatformServices } from '../../packages/core/src/platform'

/**
 * Core's host services backed by Electron. `getWindow` parents the native
 * picker; it is read per call because the window is created after the
 * platform is registered.
 */
export function createElectronPlatform(getWindow: () => BrowserWindow | null): PlatformServices {
  return {
    userDataDir: () => app.getPath('userData'),
    sourceRoot: () => (app.isPackaged ? null : app.getAppPath()),
    openExternal: (url) => shell.openExternal(url),
    openPath: (target) => shell.openPath(target),
    pickPath: async ({ title, kind, allowCreate }) => {
      const properties: ('openDirectory' | 'openFile' | 'createDirectory')[] = [
        kind === 'directory' ? 'openDirectory' : 'openFile',
      ]
      if (kind === 'directory' && allowCreate) properties.push('createDirectory')
      const win = getWindow()
      const options = { title, properties }
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options)
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0]
    },
  }
}
