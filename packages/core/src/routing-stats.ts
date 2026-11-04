import { totalTokens } from './progress'
import { normalizeRuns, type RunRecord } from './run-records'
import type { BoardState } from './store'

export interface RoutingGroup {
  /** `none` when Jev made no complexity call for the run (a card that picked its own model). */
  complexity: string
  /** `cli-default` when the run started on whatever the CLI picked. */
  model: string
  /** `default` when the run passed no effort flag. */
  effort: string
  runs: number
  cards: number
  medianTokens: number
  medianCalls: number
  /** Median of (input + cacheRead + cacheWrite) / calls — what a request carries. */
  medianContextPerCall: number
  /** Runs that ended in a restart (their work was thrown away) over all runs in the group. */
  restartRate: number
}

export interface RoutingStats {
  groups: RoutingGroup[]
  /** Runs counted. */
  runs: number
  /** Cards with at least one record. */
  cards: number
  /** Cards left out because they hold no records — everything finished before records existed. */
  cardsWithoutRuns: number
}

const COMPLEXITY_ORDER = ['simple', 'moderate', 'complex', 'unclear', 'none']

/** Middle value, rounded; the mean of the two middle values for an even count. */
export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return Math.round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2)
}

interface Bucket {
  complexity: string
  model: string
  effort: string
  runs: RunRecord[]
  cardIds: Set<string>
}

/** Group every recorded run by complexity × model × effort. Reads only the cards, never a transcript. */
export function routingStats(board: BoardState): RoutingStats {
  const buckets = new Map<string, Bucket>()
  let runs = 0
  let cards = 0
  let cardsWithoutRuns = 0
  for (const task of Object.values(board).flat()) {
    const records = normalizeRuns(task.runs)
    if (records.length === 0) {
      cardsWithoutRuns += 1
      continue
    }
    cards += 1
    for (const run of records) {
      runs += 1
      const complexity = run.complexity ?? 'none'
      const model = run.model ?? 'cli-default'
      const effort = run.effort ?? 'default'
      const key = JSON.stringify([complexity, model, effort])
      const bucket = buckets.get(key) ?? { complexity, model, effort, runs: [], cardIds: new Set<string>() }
      bucket.runs.push(run)
      bucket.cardIds.add(task.id)
      buckets.set(key, bucket)
    }
  }
  const rank = (complexity: string) => {
    const at = COMPLEXITY_ORDER.indexOf(complexity)
    return at === -1 ? COMPLEXITY_ORDER.length : at
  }
  const groups = [...buckets.values()]
    .map((b): RoutingGroup => ({
      complexity: b.complexity,
      model: b.model,
      effort: b.effort,
      runs: b.runs.length,
      cards: b.cardIds.size,
      medianTokens: median(b.runs.map((r) => totalTokens(r.usage))),
      medianCalls: median(b.runs.map((r) => r.calls)),
      medianContextPerCall: median(
        b.runs.filter((r) => r.calls > 0).map((r) => (r.usage.input + r.usage.cacheRead + r.usage.cacheWrite) / r.calls)
      ),
      restartRate: b.runs.filter((r) => r.endedBy === 'restart').length / b.runs.length,
    }))
    .sort((a, b) => rank(a.complexity) - rank(b.complexity) || a.model.localeCompare(b.model) || a.effort.localeCompare(b.effort))
  return { groups, runs, cards, cardsWithoutRuns }
}
