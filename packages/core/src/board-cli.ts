import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import { getPlatform } from './platform'
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
  /**
   * Loader the CLI needs to resolve the TypeScript helpers it imports, as a
   * `file://` URL: `node --import` takes a module specifier, and a Windows
   * absolute path (`C:/…`) is rejected as an unknown `c:` URL scheme.
   */
  loaderPath?: string
}

/**
 * Resolve board-CLI access for a launch: the npm build's bundled CLI, else
 * `scripts/vibeflow.mjs` in a repo checkout. Callers get no `cliPath` when
 * neither exists and must degrade rather than emit a command that cannot run.
 */
export async function boardCliLaunchInfo(): Promise<BoardCliLaunchInfo> {
  const storeDir = path.dirname(getStorePath())
  const entry = getPlatform().cliEntry?.()
  if (entry && fs.existsSync(entry)) return { storeDir, cliPath: entry }
  const root = getPlatform().sourceRoot()
  if (!root) return { storeDir }

  const cliPath = path.join(root, 'scripts', 'vibeflow.mjs')
  const loaderPath = path.join(root, 'test', 'support', 'register.mjs')
  if (!fs.existsSync(cliPath) || !fs.existsSync(loaderPath)) return { storeDir }

  return { storeDir, cliPath, loaderPath: pathToFileURL(loaderPath).href }
}
