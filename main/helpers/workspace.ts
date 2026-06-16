import { stat } from 'fs/promises'
import { join } from 'path'

export const CONTEXT_FILE = 'context.html'

export interface WorkspaceScan {
  folderExists: boolean
  hasContextFile: boolean
}

export async function scanWorkspace(folderPath: string): Promise<WorkspaceScan> {
  let folderExists = false
  let hasContextFile = false
  try {
    const s = await stat(folderPath)
    folderExists = s.isDirectory()
  } catch {
    return { folderExists: false, hasContextFile: false }
  }
  if (folderExists) {
    try {
      await stat(join(folderPath, CONTEXT_FILE))
      hasContextFile = true
    } catch {
      hasContextFile = false
    }
  }
  return { folderExists, hasContextFile }
}
