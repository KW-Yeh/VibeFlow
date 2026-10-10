import type { AgentCliId, AgentModel } from './agents'
import { runAgentPrint } from './agent-print'
import { buildPrompt } from './launch'
import type { Task } from './store'

export interface JevRoute {
  model?: string
  plannerModel?: string
  plan?: string
  status: 'routed' | 'fallback'
  reason?: string
}

export interface JevRouter {
  /** A missing key can use the catalog's local fallback without waiting for a CLI handshake. */
  enabled?: boolean
  route(task: Task, models: readonly AgentModel[]): Promise<JevRoute>
}

type ChoiceAnswer = { type: 'choice'; choice: string }
type JevResponse = { answers?: Record<string, ChoiceAnswer> }

const API_URL = 'https://api.typesafe.ai/v1/systemone'
const MAX_TASK_CHARS = 12_000
const MAX_PLAN_CHARS = 8_000

function tier(model: AgentModel, agent: AgentCliId): number {
  const name = `${model.id} ${model.label}`.toLowerCase()
  if (/haiku|mini|nano|luna|flash/.test(name)) return 0
  if (/opus|astra|pro\b/.test(name)) return 2
  if (agent === 'codex' && /gpt-5\.5|gpt-5\.4(?!-mini)/.test(name)) return 2
  return 1
}

/** Keep a current, exact CLI model id per cost tier, rather than guessing ids. */
export function routeCandidates(agent: AgentCliId, models: readonly AgentModel[]): AgentModel[] {
  const valid = models.filter((m) => /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(m.id))
  const byTier = new Map<number, AgentModel>()
  for (const model of valid) {
    const rank = tier(model, agent)
    // Native CLI catalogs are ordered newest first; preserve that order.
    if (!byTier.has(rank)) byTier.set(rank, model)
  }
  return [...byTier.entries()].sort(([a], [b]) => a - b).map(([, model]) => model)
}

function isChoice(value: unknown): value is ChoiceAnswer {
  return !!value && typeof value === 'object' && (value as ChoiceAnswer).type === 'choice'
    && typeof (value as ChoiceAnswer).choice === 'string'
}

export function createJevRouter(opts: {
  apiKey?: string
  getApiKey?: () => string | undefined
  fetcher?: typeof fetch
  planner?: (agent: AgentCliId, model: string, prompt: string, cwd: string) => Promise<string>
  printAgent?: typeof runAgentPrint
} = {}): JevRouter {
  const getApiKey = opts.getApiKey ?? (() => opts.apiKey ?? process.env.TYPESAFE_API_KEY?.trim())
  const fetcher = opts.fetcher ?? fetch
  const planner = opts.planner ?? (async (agent, model, prompt, cwd) => {
    const args = agent === 'claude'
      ? ['-p', '--model', model, '--permission-mode', 'plan']
      : ['exec', '--model', model, '--sandbox', 'read-only', '--skip-git-repo-check', '-']
    return (opts.printAgent ?? runAgentPrint)(agent, args, prompt, { cwd, timeout: 120_000, maxBuffer: 128 * 1024 })
  })

  async function ask(state: unknown, questions: Record<string, unknown>): Promise<Record<string, ChoiceAnswer>> {
    const apiKey = getApiKey()
    if (!apiKey) throw new Error('未設定 Jev API key（可在設定中輸入或提供 TYPESAFE_API_KEY）')
    const response = await fetcher(API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'jev-latest', state, questions }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error(`Jev API 回應 ${response.status}`)
    const body = await response.json() as JevResponse
    if (!body.answers) throw new Error('Jev API 沒有回傳判斷')
    return body.answers
  }

  return {
    get enabled() { return Boolean(getApiKey()) },
    async route(task, catalog) {
      const agent = task.agentCli === 'codex' ? 'codex' : 'claude'
      const candidates = routeCandidates(agent, catalog)
      if (candidates.length === 0) return { status: 'fallback', reason: '模型清單沒有可用的模型' }
      const expensive = candidates[candidates.length - 1]
      const taskText = buildPrompt(task).slice(0, MAX_TASK_CHARS)
      try {
        const first = await ask({ task: taskText, agent }, {
          complexity: {
            type: 'choice',
            instructions: 'How difficult is this software task to implement correctly?',
            criteria: {
              simple: 'Small, well scoped and routine',
              moderate: 'Some design choices or multiple files',
              complex: 'Architecture, ambiguous requirements, high risk, or many interacting parts',
            },
          },
          preparation: {
            type: 'choice',
            instructions: 'Would a separate read-only planning pass materially improve the implementation?',
            criteria: {
              direct: 'The request is clear enough to start implementation directly',
              plan: 'The request is unclear, broad or complex enough to benefit from a plan first',
            },
          },
        })
        if (!isChoice(first.complexity) || !isChoice(first.preparation)
          || !['simple', 'moderate', 'complex'].includes(first.complexity.choice)
          || !['direct', 'plan'].includes(first.preparation.choice)) throw new Error('Jev 回傳不受支援的判斷')
        let plan: string | undefined
        if (first.preparation.choice === 'plan') {
          if (!task.worktreePath) throw new Error('規劃時找不到 worktree')
          const instruction = `Read the repository and make a concise implementation plan for the following task. Do not edit files. Identify unclear requirements, affected areas, and verification. Return only the plan.\n\n${taskText}`
          plan = (await planner(agent, expensive.id, instruction, task.worktreePath)).trim().slice(0, MAX_PLAN_CHARS)
          if (!plan) throw new Error('規劃模型沒有回傳計畫')
        }
        const options = Object.fromEntries(candidates.map((m) => [m.id,
          `${m.label}; relative cost tier ${tier(m, agent) + 1}/3 (${tier(m, agent) === 2 ? 'highest capability' : tier(m, agent) === 0 ? 'lowest cost' : 'balanced'})`]))
        const second = await ask({ task: taskText, complexity: first.complexity.choice, plan }, {
          model: {
            type: 'choice',
            instructions: 'Choose the lowest-cost available model likely to implement this task correctly. Prefer more capable models as complexity or uncertainty rises.',
            criteria: options,
          },
        })
        if (!isChoice(second.model) || !candidates.some((m) => m.id === second.model.choice)) {
          throw new Error('Jev 選了不在模型清單中的模型')
        }
        return { status: 'routed', model: second.model.choice,
          ...(plan ? { plannerModel: expensive.id, plan } : {}) }
      } catch (err) {
        return { status: 'fallback', reason: err instanceof Error ? err.message : String(err) }
      }
    },
  }
}
