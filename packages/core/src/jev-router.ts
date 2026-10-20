import type { AgentModel } from './agents'
import { modelFor, selectableEfforts, type ManualEffort } from './effort'
import { buildPrompt, taskModel } from './launch'
import type { Task } from './store'

export interface JevRoute {
  effort?: ManualEffort
  /** `routing` is transient and never reused after a host restart. */
  status: 'routing' | 'routed' | 'fallback'
  reason?: string
}

export interface JevRouter {
  enabled?: boolean
  route(task: Task, models: readonly AgentModel[]): Promise<JevRoute>
}

type ChoiceAnswer = { type: 'choice'; choice: string }
type JevResponse = { answers?: Record<string, ChoiceAnswer> }

const API_URL = 'https://api.typesafe.ai/v1/systemone'
const MAX_TASK_CHARS = 12_000

export function createJevRouter(opts: {
  apiKey?: string
  getApiKey?: () => string | undefined
  fetcher?: typeof fetch
} = {}): JevRouter {
  const getApiKey = opts.getApiKey ?? (() => opts.apiKey ?? process.env.TYPESAFE_API_KEY?.trim())
  const fetcher = opts.fetcher ?? fetch

  return {
    get enabled() { return Boolean(getApiKey()) },
    async route(task, catalog) {
      const model = modelFor(catalog, taskModel(task))
      const levels = selectableEfforts(model)
      if (levels.length === 0) return { status: 'fallback', reason: '目前模型不支援調整 effort' }
      try {
        const apiKey = getApiKey()
        if (!apiKey) throw new Error('未設定 Jev API key（可在設定中輸入或提供 TYPESAFE_API_KEY）')
        const response = await fetcher(API_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'jev-latest',
            state: {
              task: buildPrompt(task).slice(0, MAX_TASK_CHARS),
              agent: task.agentCli === 'codex' ? 'codex' : 'claude',
              currentModel: model?.id ?? taskModel(task) ?? 'CLI default (catalog unavailable)',
            },
            questions: {
              effort: {
                type: 'choice',
                instructions: 'Choose the lowest reasoning effort likely to complete this software task correctly on the current model. Increase effort for complexity, ambiguity, or risk.',
                criteria: Object.fromEntries(levels.map((level) => [level, effortDescription(level)])),
              },
            },
          }),
          signal: AbortSignal.timeout(15_000),
        })
        if (!response.ok) throw new Error(`Jev API 回應 ${response.status}`)
        const body = await response.json() as JevResponse
        const choice = body.answers?.effort
        if (choice?.type !== 'choice' || !levels.includes(choice.choice as ManualEffort)) {
          throw new Error('Jev 選了目前模型不支援的 effort')
        }
        return { status: 'routed', effort: choice.choice as ManualEffort }
      } catch (err) {
        return { status: 'fallback', reason: err instanceof Error ? err.message : String(err) }
      }
    },
  }
}

function effortDescription(level: ManualEffort): string {
  const descriptions: Record<ManualEffort, string> = {
    low: 'Routine, small and well scoped work',
    medium: 'Typical development with limited uncertainty',
    high: 'Complex debugging or several interacting files',
    xhigh: 'Difficult design or extensive reasoning',
    max: 'The hardest, highest risk tasks',
    ultra: 'Deepest reasoning with automatic delegation',
  }
  return descriptions[level]
}
