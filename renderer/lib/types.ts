// Re-export the persisted domain types from the main process so the renderer
// and main share a single source of truth (type-only, erased at build time).
export type {
  ColumnId,
  Task,
  Role,
  Workspace,
  BoardState,
  AppSettings,
  AgentConnection,
  AgentConnections,
  ConnectableAgentId,
  VibeFlowState,
  PipelineStage,
  PipelineRun,
} from '../../main/helpers/store'
export type { GitInfo, DiffFile, FinalizeResult, PrStatus } from '../../main/helpers/git'
export type { AgentCli, AgentCliId } from '../../main/helpers/agents'
export type {
  GitHubCliAuthEvent,
  GitHubCliAuthStatus,
} from '../../main/helpers/github-auth'
export type {
  TaskProgress,
  TaskProgressStep,
  ReviewVerdict,
} from '../../main/helpers/progress'
export type {
  SubAgentRun,
  SubAgentStatus,
} from '../../main/helpers/subagents'
export type {
  ChatMessage,
  ChatAttachment,
  Conversation,
} from '../../main/helpers/chat-store'
export type { AttachmentInput, ChatChunk, ChatPhase, PhaseType } from '../../main/helpers/chat-session'
