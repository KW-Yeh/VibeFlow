import type { BoardState, VibeFlowState } from '@/lib/types'

/**
 * Returns the preload-exposed VibeFlow bridge, or null when it is unavailable
 * (e.g. during static export / running the renderer in a plain browser).
 */
function bridge() {
  if (typeof window === 'undefined') return null
  return window.vibeflow ?? null
}

export function hasBridge(): boolean {
  return bridge() !== null
}

export async function loadState(): Promise<VibeFlowState | null> {
  const b = bridge()
  return b ? b.getState() : null
}

export async function persistBoard(board: BoardState): Promise<void> {
  const b = bridge()
  if (b) await b.setBoard(board)
}

export async function selectProject(): Promise<VibeFlowState | null> {
  const b = bridge()
  return b ? b.selectProject() : null
}
