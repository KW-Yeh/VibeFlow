/** electron-updater state, as the Electron shell reports it. Other hosts report `unsupported`. */
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
