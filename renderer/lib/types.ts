// Re-export the persisted domain types from the main process so the renderer
// and main share a single source of truth (type-only, erased at build time).
export type {
  ColumnId,
  Task,
  BoardState,
  VibeFlowState,
} from '../../main/helpers/store'
export type { GitInfo } from '../../main/helpers/git'
