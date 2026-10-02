// npm `postinstall` of the published package. It runs as the owner of the install
// dir — root under `sudo npm i -g` — so it can fix what the user later cannot.
// It must never fail the install: `vibeflow` and `vibeflow doctor` retry the repair.
import { ensurePtySpawnHelper, spawnHelperFixCommand } from '../../core/src/pty-helper'

try {
  const failures = ensurePtySpawnHelper()
  if (failures.length > 0) {
    console.warn(`[vibeflow] node-pty spawn-helper 無法設為可執行，終端機會無法啟動。請執行：\n  ${spawnHelperFixCommand(failures)}`)
  }
} catch (err) {
  console.warn(`[vibeflow] postinstall 略過：${(err as Error).message}`)
}
