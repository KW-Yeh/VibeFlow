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
  NotificationSettings,
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
export type { TaskSpec } from '../../packages/core/src/specs'
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
export type { AgentCli, AgentCliId, AgentEffort, AgentModel } from '../../packages/core/src/agents'
export type {
  GitHubCliAuthEvent,
  GitHubCliAuthStatus,
} from '../../packages/core/src/github-auth'
export type {
  GithubInbox,
  GithubInboxStatus,
  GithubIssue,
  GithubItem,
  GithubLabel,
  GithubLink,
  GithubPr,
  GithubPrState,
  GithubRef,
  GithubRepoInbox,
  GithubTaskLinks,
  GithubUser,
} from '../../packages/core/src/github'
export type { JiraAttachment, JiraInbox, JiraRef, JiraTicket, JiraStatusCategory } from '../../packages/core/src/jira'
export type { JiraAuthEvent, JiraAuthStatus } from '../../packages/core/src/jira-auth'
export type {
  SubAgentRun,
  SubAgentStatus,
} from '../../packages/core/src/subagents'
export type {
  Activity,
  ProgressNotification,
  ProgressNotificationKind,
  TaskProgress,
  TodoItem,
  TodoStatus,
  TokenUsage,
} from '../../packages/core/src/progress'
export type { ProgressNotifyPayload, ProgressUpdatePayload } from '../../packages/core/src/client'
export type {
  ChatMessage,
  ChatAttachment,
  Conversation,
} from '../../packages/core/src/chat-store'
export type { AttachmentInput } from '../../packages/core/src/attachments'
export type { ChatChunk, ChatPhase, PhaseType } from '../../packages/core/src/chat-session'
export type { LaunchIntent } from '../../packages/core/src/service'
export type { StartResult } from '../../packages/core/src/session-backend'
export type {
  AgentModelList,
  AgentModelSource,
} from '../../packages/core/src/agent-models'
