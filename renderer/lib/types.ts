// Re-export the persisted domain types from the main process so the renderer
// and main share a single source of truth (type-only, erased at build time).
export type {
  ColumnId,
  Task,
  Role,
  BoardState,
  AppSettings,
  VibeFlowState,
  PipelineStage,
  PipelineRun,
} from '../../main/helpers/store'
export type { GitInfo, DiffFile, FinalizeResult } from '../../main/helpers/git'
export type { AgentCli, AgentCliId } from '../../main/helpers/agents'
export type {
  TaskProgress,
  TaskProgressStep,
  ReviewVerdict,
} from '../../main/helpers/progress'
export type {
  SubAgentRun,
  SubAgentStatus,
} from '../../main/helpers/subagents'
