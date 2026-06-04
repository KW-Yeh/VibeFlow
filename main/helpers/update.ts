import fs from 'fs'
import path from 'path'
import { app } from 'electron'

/**
 * Local "hot update" support.
 *
 * A packaged Electron app cannot hot-swap its main process (asar + native
 * modules), so the standard pattern — same as electron-updater, minus the
 * remote download — is: detect that a newer build replaced the running
 * bundle on disk, then relaunch into it. `rebuild.sh --install` overwrites
 * the running .app in place; the watcher below notices and lets the
 * renderer offer a one-click restart.
 */

/** Restart the app immediately (used after a new build replaced the bundle). */
export function relaunchApp(): void {
  app.relaunch()
  app.exit(0)
}

/** The file whose mtime identifies the running build (packaged only). */
function bundleMarkerPath(): string {
  // <VibeFlow.app>/Contents/Resources/app.asar — rewritten on every build.
  return path.join(process.resourcesPath, 'app.asar')
}

let watchedMarker: string | null = null

/**
 * Watch the running bundle for replacement by a newer build and invoke
 * `onNewBuild` once when detected. No-op in dev (nextron already hot-reloads
 * there, and there is no bundle to watch). `fs.watchFile` is used because it
 * tolerates the marker transiently vanishing while the bundle is swapped.
 */
export function watchForNewBuild(onNewBuild: () => void): void {
  if (!app.isPackaged) return
  stopUpdateWatcher()

  const marker = bundleMarkerPath()
  let baseline: number
  try {
    baseline = fs.statSync(marker).mtimeMs
  } catch {
    return // unexpected layout — skip rather than misfire
  }

  watchedMarker = marker
  fs.watchFile(marker, { interval: 2000 }, (curr) => {
    // mtimeMs is 0 while the file is missing mid-swap; fire only once the
    // new asar is in place and differs from the build we booted from.
    if (curr.mtimeMs > 0 && curr.mtimeMs !== baseline) {
      stopUpdateWatcher()
      onNewBuild()
    }
  })
}

export function stopUpdateWatcher(): void {
  if (watchedMarker) {
    fs.unwatchFile(watchedMarker)
    watchedMarker = null
  }
}
