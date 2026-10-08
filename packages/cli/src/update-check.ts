import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AvailableUpdate } from '../../core/src/client'

const execFileAsync = promisify(execFile)
export const UPDATE_CHECK_INTERVAL_MS = 2 * 60 * 60 * 1000

function versionParts(value: string): { numbers: number[]; prerelease: boolean } | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value)
  if (!match) return null
  return { numbers: match.slice(1, 4).map(Number), prerelease: !!match[4] }
}

export function isNewerVersion(latest: string, current: string): boolean {
  const next = versionParts(latest)
  const installed = versionParts(current)
  if (!next || !installed) return false
  for (let index = 0; index < 3; index++) {
    if (next.numbers[index] !== installed.numbers[index]) {
      return next.numbers[index] > installed.numbers[index]
    }
  }
  return installed.prerelease && !next.prerelease
}

/** Ask the user's configured npm registry for its latest dist-tag. */
export async function checkForUpdate(
  packageName: string,
  currentVersion: string,
  query: (name: string) => Promise<string> = async (name) => {
    const { stdout } = await execFileAsync(process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['view', `${name}@latest`, 'version', '--json'],
      { timeout: 10_000, windowsHide: true, shell: process.platform === 'win32' })
    return stdout
  }
): Promise<AvailableUpdate | null> {
  const latest = JSON.parse(await query(packageName)) as unknown
  if (typeof latest !== 'string' || !isNewerVersion(latest, currentVersion)) return null
  return { currentVersion, latestVersion: latest }
}
