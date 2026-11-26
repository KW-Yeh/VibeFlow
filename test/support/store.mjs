import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { getStoreAtPath } from '../../packages/core/src/store.ts'

/**
 * A throwaway store directory whose settings point `workstationPath` inside it,
 * so creating a card never makes folders under the real `~/Desktop` default.
 *
 * Returns { storeDir, workstationPath, cleanup }.
 */
export async function makeStore(prefix = 'vf-store-') {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  const workstationPath = path.join(storeDir, 'workstation')
  await fs.mkdir(workstationPath)
  getStoreAtPath(storeDir).set('settings', { workstationPath })
  const cleanup = () => fs.rm(storeDir, { recursive: true, force: true, maxRetries: 10 })
  return { storeDir, workstationPath, cleanup }
}
