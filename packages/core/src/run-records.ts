import type { AgentCliId } from './agents'
import type { JevComplexity } from './jev-router'
import type { TokenUsage } from './progress'

export type RunEnd = 'restart' | 'completed' | 'handoff'
export type ModelSource = 'card' | 'jev' | 'cli'

/**
 * What one finished run cost and what it ran on, kept on the card after the
 * worktree and its transcripts are gone. `Task.usage` is the card's running
 * total; these are the per-run parts, grouped by the choice that was made.
 */
export interface RunRecord {
  /** Absent on a card's first run — only a restart assigns one. */
  runId?: string
  /** Task.launchedAt of the run. */
  startedAt: number
  endedAt: number
  endedBy: RunEnd
  agent: AgentCliId
  /** Sessions counted into `usage`; sub-agent transcripts belong to their parent. */
  sessionIds: string[]
  /** The model the run started with; absent when the CLI picked its own default. */
  model?: string
  modelSource: ModelSource
  /** Effort the run started with, already lowered to what the model accepts. */
  effort?: string
  complexity?: JevComplexity
  scoutModel?: string
  /** This run's own tokens, not the card's total. */
  usage: TokenUsage
  /** API requests the run made. */
  calls: number
}

// Literal lists rather than imports: the renderer bundles this module, so it takes no value imports.
const RUN_ENDS: readonly RunEnd[] = ['restart', 'completed', 'handoff']
const MODEL_SOURCES: readonly ModelSource[] = ['card', 'jev', 'cli']
const AGENTS: readonly AgentCliId[] = ['claude', 'codex']
const COMPLEXITIES: readonly JevComplexity[] = ['simple', 'moderate', 'complex', 'unclear']

const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (list as readonly string[]).includes(value)

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const count = (value: unknown): number => (finite(value) && value > 0 ? value : 0)
const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined)

function normalizeRunUsage(value: unknown): TokenUsage {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  return {
    input: count(v.input),
    output: count(v.output),
    cacheRead: count(v.cacheRead),
    cacheWrite: count(v.cacheWrite),
    reasoning: count(v.reasoning),
  }
}

function normalizeRun(value: unknown): RunRecord | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (!finite(v.startedAt) || !finite(v.endedAt)) return null
  if (!isOneOf(RUN_ENDS, v.endedBy) || !isOneOf(AGENTS, v.agent) || !isOneOf(MODEL_SOURCES, v.modelSource)) return null
  const runId = text(v.runId)
  const model = text(v.model)
  const effort = text(v.effort)
  const scoutModel = text(v.scoutModel)
  return {
    ...(runId ? { runId } : {}),
    startedAt: v.startedAt,
    endedAt: v.endedAt,
    endedBy: v.endedBy,
    agent: v.agent,
    sessionIds: Array.isArray(v.sessionIds) ? v.sessionIds.filter((id): id is string => typeof id === 'string' && id !== '') : [],
    ...(model ? { model } : {}),
    modelSource: v.modelSource,
    ...(effort ? { effort } : {}),
    ...(isOneOf(COMPLEXITIES, v.complexity) ? { complexity: v.complexity } : {}),
    ...(scoutModel ? { scoutModel } : {}),
    usage: normalizeRunUsage(v.usage),
    calls: count(v.calls),
  }
}

/** Accept only well-formed records: persisted store data is untrusted and may predate the field. */
export function normalizeRuns(value: unknown): RunRecord[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const run = normalizeRun(item)
    return run ? [run] : []
  })
}

/** A run is the same run when it has the same restart id and the same launch. */
export function runKey(run: Pick<RunRecord, 'runId' | 'startedAt'>): string {
  return `${run.runId ?? ''}:${run.startedAt}`
}

/**
 * Add a finished run to the card's records. Writing the run that is already
 * there replaces it: a reopened run is read again from its start, so the new
 * record is the whole run, not an addition to it.
 */
export function upsertRun(existing: unknown, record: RunRecord): RunRecord[] {
  const runs = normalizeRuns(existing)
  const key = runKey(record)
  const at = runs.findIndex((run) => runKey(run) === key)
  if (at === -1) return [...runs, record]
  return runs.map((run, i) => (i === at ? record : run))
}
