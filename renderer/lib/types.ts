// Re-export the persisted domain types from the main process so the renderer
// and main share a single source of truth (type-only, erased at build time).
export type {
  ColumnId,
  OutcomeCommit,
  OutcomeFile,
  OutcomePr,
  Task,
  TaskOutcome,
  BoardState,
  AppSettings,
  AgentConnection,
  AgentConnections,
  ConnectableAgentId,
  VibeFlowState,
} from '../../packages/core/src/store'
export type {
  GitInfo,
  DiffEntry,
  DiffFile,
  FinalizeResult,
  PrStatus,
} from '../../packages/core/src/git'
export type {
  ArtifactContent,
  ArtifactKind,
  TaskArtifact,
} from '../../packages/core/src/artifacts'
export type { BoardCliLaunchInfo } from '../../packages/core/src/board-cli'
export type { TaskDecisions } from '../../packages/core/src/decisions'
export type {
  RecentProject,
  RecentProjectEntry,
} from '../../packages/core/src/recent-projects'
export type {
  LibraryEntry,
  LibraryKind,
  LibraryLaunchInfo,
  LibraryScript,
} from '../../packages/core/src/library'
export type { AgentCli, AgentCliId, AgentEffort } from '../../packages/core/src/agents'
export type {
  GitHubCliAuthEvent,
  GitHubCliAuthStatus,
} from '../../packages/core/src/github-auth'
export type {
  RemoteUpdateSnapshot,
  RemoteUpdateStatus,
} from '../../main/helpers/remote-update'
export type {
  SubAgentRun,
  SubAgentStatus,
} from '../../packages/core/src/subagents'
export type {
  ChatMessage,
  ChatAttachment,
  Conversation,
} from '../../packages/core/src/chat-store'
export type { AttachmentInput } from '../../packages/core/src/attachments'
export type { ChatChunk, ChatPhase, PhaseType } from '../../packages/core/src/chat-session'
