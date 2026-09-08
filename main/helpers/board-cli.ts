import fs from 'fs'
import path from 'path'
import { getStorePath } from './store'

/**
 * What an agent needs to put cards on the board it is itself running on:
 * the store the live app reads, and the CLI that can write it.
 */
export interface BoardCliLaunchInfo {
  /** Store directory for the CLI's `--store-path`, so dev and packaged never cross. */
  storeDir: string
  /** `scripts/vibeflow.mjs`; absent when no CLI is reachable — see below. */
  cliPath?: string
  /** Loader the CLI needs to resolve the TypeScript helpers it imports. */
  loaderPath?: string
}

/**
 * Resolve board-CLI access for a launch. The packaged app ships only
 * `package.json` + `app` (see electron-builder.yml), so the CLI exists in a repo
 * checkout only; callers get no `cliPath` otherwise and must degrade rather
 * than emit a command that cannot run.
 */
export async function boardCliLaunchInfo(): Promise<BoardCliLaunchInfo> {
  const { app } = await import('electron')
  const storeDir = path.dirname(getStorePath())
  if (app.isPackaged) return { storeDir }

  const root = app.getAppPath()
  const cliPath = path.join(root, 'scripts', 'vibeflow.mjs')
  const loaderPath = path.join(root, 'test', 'support', 'register.mjs')
  if (!fs.existsSync(cliPath) || !fs.existsSync(loaderPath)) return { storeDir }

  return { storeDir, cliPath, loaderPath }
}
