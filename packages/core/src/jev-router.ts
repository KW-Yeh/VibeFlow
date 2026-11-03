import type { AgentCliId, AgentModel } from './agents'
import { runAgentPrint } from './agent-print'
import { clampEffort, MANUAL_EFFORTS, modelFor, selectableEfforts, type ManualEffort } from './effort'
import { buildPrompt, taskAgent, taskModel } from './launch'
import type { Task } from './store'

export type JevComplexity = 'simple' | 'moderate' | 'complex' | 'unclear'
export type JevRoutePhase = 'judging' | 'scouting' | 'selecting'

export interface JevRoute {
  /** Set only when the card left its model to Jev. */
  model?: string
  effort?: ManualEffort
  complexity?: JevComplexity
  /** The model that read the repo when Jev could not judge the task. */
  scoutModel?: string
  /** That model's analysis, added to the first prompt of the run. */
  context?: string
  /** `routing` is transient and never reused after a host restart. */
  status: 'routing' | 'routed' | 'fallback'
  phase?: JevRoutePhase
  reason?: string
}

export interface JevRouteOptions {
  /** Read the repo with the strongest model when Jev cannot judge; off for masters. */
  scout?: boolean
  /** Where the scout runs: the card's worktree. */
  cwd?: string
  onPhase?: (phase: JevRoutePhase) => void
}

export type JevScout = (agent: AgentCliId, model: string, effort: ManualEffort | undefined, prompt: string, cwd: string) => Promise<string>

export interface JevRouter {
  enabled?: boolean
  route(task: Task, models: readonly AgentModel[], opts?: JevRouteOptions): Promise<JevRoute>
}

type ChoiceAnswer = { type: 'choice'; choice: string }
type JevResponse = { answers?: Record<string, ChoiceAnswer> }

const API_URL = 'https://api.typesafe.ai/v1/systemone'
const MAX_TASK_CHARS = 12_000
const MAX_CONTEXT_CHARS = 8_000
const SCOUT_TIMEOUT_MS = 5 * 60_000
/** Ids that are safe as one plain CLI token; aliases like `default` say nothing about the model. */
const SAFE_MODEL_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

/** Relative capability from the model name: 0 lowest cost, 2 highest capability. */
function tier(model: AgentModel, agent: AgentCliId): number {
  const name = `${model.id} ${model.label}`.toLowerCase()
  if (/haiku|mini|nano|luna|flash/.test(name)) return 0
  if (/opus|fable|astra|pro\b/.test(name)) return 2
  if (agent === 'codex' && /gpt-5\.5|gpt-5\.4(?!-mini)/.test(name)) return 2
  return 1
}

const TIER_LABELS = ['lowest cost', 'balanced', 'highest capability']

/** One exact CLI model id per capability tier, cheapest first, in catalog order within a tier. */
export function routeCandidates(agent: AgentCliId, models: readonly AgentModel[]): AgentModel[] {
  const byTier = new Map<number, AgentModel>()
  for (const model of models) {
    if (!SAFE_MODEL_ID.test(model.id) || model.id === 'default') continue
    const rank = tier(model, agent)
    if (!byTier.has(rank)) byTier.set(rank, model)
  }
  return [...byTier.entries()].sort(([a], [b]) => a - b).map(([, model]) => model)
}

function isChoice(value: unknown): value is ChoiceAnswer {
  return !!value && typeof value === 'object' && (value as ChoiceAnswer).type === 'choice'
    && typeof (value as ChoiceAnswer).choice === 'string'
}

/** Read-only, headless run of the agent CLI; the prompt goes in on stdin. */
const defaultScout: JevScout = (agent, model, effort, prompt, cwd) => {
  const args = agent === 'claude'
    ? ['-p', '--model', model, '--permission-mode', 'plan', ...(effort ? ['--effort', effort] : [])]
    : ['exec', '--model', model, ...(effort ? ['-c', `model_reasoning_effort=${effort}`] : []),
        '--sandbox', 'read-only', '--skip-git-repo-check', '-']
  return runAgentPrint(agent, args, prompt, { cwd, timeout: SCOUT_TIMEOUT_MS, maxBuffer: 128 * 1024 })
}

export function createJevRouter(opts: {
  apiKey?: string
  getApiKey?: () => string | undefined
  fetcher?: typeof fetch
  scout?: JevScout
} = {}): JevRouter {
  const getApiKey = opts.getApiKey ?? (() => opts.apiKey ?? process.env.TYPESAFE_API_KEY?.trim())
  const fetcher = opts.fetcher ?? fetch
  const scout = opts.scout ?? defaultScout

  async function ask(state: unknown, questions: Record<string, unknown>): Promise<Record<string, ChoiceAnswer>> {
    const apiKey = getApiKey()
    if (!apiKey) throw new Error('未設定 Jev API key（可在設定中輸入或提供 TYPESAFE_API_KEY）')
    const response = await fetcher(API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'jev-latest', state, questions }),
      signal: AbortSignal.timeout(15_000),
    })
    if (response.status === 402 || response.status === 429) {
      throw new Error(`Jev 額度已用完或請求過多（HTTP ${response.status}），改用 CLI 目前的模型`)
    }
    if (!response.ok) throw new Error(`Jev API 回應 ${response.status}`)
    const body = await response.json() as JevResponse
    if (!body.answers) throw new Error('Jev API 沒有回傳判斷')
    return body.answers
  }

  /** The card picked its model: Jev only chooses effort for it. */
  async function routeEffort(task: Task, catalog: readonly AgentModel[]): Promise<JevRoute> {
    const model = modelFor(catalog, taskModel(task))
    const levels = selectableEfforts(model)
    if (levels.length === 0) return { status: 'fallback', reason: '目前模型不支援調整 effort' }
    try {
      const answers = await ask({
        task: buildPrompt(task).slice(0, MAX_TASK_CHARS),
        agent: taskAgent(task),
        currentModel: model?.id ?? taskModel(task) ?? 'CLI default (catalog unavailable)',
      }, { effort: effortQuestion(levels) })
      const choice = answers.effort
      if (!isChoice(choice) || !levels.includes(choice.choice as ManualEffort)) {
        throw new Error('Jev 選了目前模型不支援的 effort')
      }
      return { status: 'routed', effort: choice.choice as ManualEffort }
    } catch (err) {
      return { status: 'fallback', reason: message(err) }
    }
  }

  /** The card left its model to Jev: judge the task, scout when unclear, then pick. */
  async function routeModel(task: Task, catalog: readonly AgentModel[], ro: JevRouteOptions): Promise<JevRoute> {
    const agent = taskAgent(task)
    const candidates = routeCandidates(agent, catalog)
    if (candidates.length === 0) return { status: 'fallback', reason: '模型清單沒有可用的模型' }
    const chooseEffort = task.effort === 'auto'
    const strongest = candidates[candidates.length - 1]
    const levels = MANUAL_EFFORTS.filter((level) => candidates.some((m) => selectableEfforts(m).includes(level)))
    const taskText = buildPrompt(task).slice(0, MAX_TASK_CHARS)
    const modelQuestion = {
      type: 'choice',
      instructions: 'Choose the lowest-cost available model likely to implement this software task correctly. Prefer more capable models as complexity, ambiguity or risk rises.',
      criteria: Object.fromEntries(candidates.map((m) => [m.id, `${m.label}; ${TIER_LABELS[tier(m, agent)]}`])),
    }
    const questions = (withUnclear: boolean): Record<string, unknown> => ({
      complexity: {
        type: 'choice',
        instructions: 'How difficult is this software task to implement correctly?',
        criteria: {
          simple: 'Small, well scoped and routine',
          moderate: 'Some design choices or multiple files',
          complex: 'Architecture, ambiguous requirements, high risk, or many interacting parts',
          ...(withUnclear ? { unclear: 'Cannot be judged from the description alone; the repository must be read first' } : {}),
        },
      },
      model: modelQuestion,
      ...(chooseEffort && levels.length > 0 ? { effort: effortQuestion(levels) } : {}),
    })
    const decide = (answers: Record<string, ChoiceAnswer>, extra: Partial<JevRoute>): JevRoute => {
      const model = candidates.find((m) => isChoice(answers.model) && m.id === answers.model.choice)
      if (!model) throw new Error('Jev 選了不在模型清單中的模型')
      let effort: ManualEffort | undefined
      if (chooseEffort && levels.length > 0) {
        const choice = answers.effort
        if (!isChoice(choice) || !levels.includes(choice.choice as ManualEffort)) throw new Error('Jev 回傳不受支援的 effort')
        effort = clampEffort(choice.choice as ManualEffort, selectableEfforts(model))
      }
      return { status: 'routed', model: model.id, ...(effort ? { effort } : {}), ...extra }
    }
    // Unclear tasks get the strongest model, deep: it has to work out the task itself.
    const conservative = (extra: Partial<JevRoute>): JevRoute => {
      const effort = chooseEffort ? clampEffort('high', selectableEfforts(strongest)) : undefined
      return { model: strongest.id, ...(effort ? { effort } : {}), ...extra } as JevRoute
    }

    let first: Record<string, ChoiceAnswer>
    let complexity: JevComplexity
    try {
      ro.onPhase?.('judging')
      first = await ask({ task: taskText, agent }, questions(true))
      const c = first.complexity
      if (!isChoice(c) || !['simple', 'moderate', 'complex', 'unclear'].includes(c.choice)) throw new Error('Jev 回傳不受支援的複雜度')
      complexity = c.choice as JevComplexity
      if (complexity !== 'unclear') return decide(first, { complexity })
    } catch (err) {
      return { status: 'fallback', reason: message(err) }
    }

    if (ro.scout === false) return conservative({ status: 'routed', complexity })
    let context: string
    try {
      if (!ro.cwd) throw new Error('補充 context 時找不到 worktree')
      ro.onPhase?.('scouting')
      const scoutEffort = clampEffort('high', selectableEfforts(strongest))
      const instruction = 'Read the repository to prepare the following software task. Do not edit any file. '
        + 'Report concisely: the affected areas and files, requirements that are unclear, the main risks, and how to verify the work. Return only the analysis.\n\n'
        + taskText
      context = (await scout(agent, strongest.id, scoutEffort, instruction, ro.cwd)).trim().slice(0, MAX_CONTEXT_CHARS)
      if (!context) throw new Error('補充 context 的模型沒有回傳分析')
    } catch (err) {
      return conservative({ status: 'fallback', complexity, reason: message(err) })
    }
    try {
      ro.onPhase?.('selecting')
      const second = await ask({ task: taskText, agent, context }, questions(false))
      return decide(second, { complexity, scoutModel: strongest.id, context })
    } catch (err) {
      // Jev itself is unavailable: like any Jev failure, leave model and effort
      // to the CLI's own setting, but keep the analysis already paid for.
      return { status: 'fallback', complexity, reason: message(err), scoutModel: strongest.id, context }
    }
  }

  return {
    get enabled() { return Boolean(getApiKey()) },
    route(task, catalog, ro = {}) {
      return taskModel(task) ? routeEffort(task, catalog) : routeModel(task, catalog, ro)
    },
  }
}

function effortQuestion(levels: readonly ManualEffort[]) {
  return {
    type: 'choice',
    instructions: 'Choose the lowest reasoning effort likely to complete this software task correctly on the chosen model. Increase effort for complexity, ambiguity, or risk.',
    criteria: Object.fromEntries(levels.map((level) => [level, effortDescription(level)])),
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
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
