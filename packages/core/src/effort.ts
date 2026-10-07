import type { AgentModel } from './agents'

/**
 * Provider-neutral reasoning depth stored on a task. The launch builder
 * translates it to each CLI's session-scoped flag; which levels a model
 * accepts comes from the CLI's own model catalog.
 */
export type AgentEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra'

/** Every valid effort level, ordered shallow → deep. Backs input validation. */
export const AGENT_EFFORTS: readonly AgentEffort[] = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']

/**
 * Levels offered when nothing is known about the model (a custom id, or a
 * list that came from a source without effort data). The deeper levels are
 * only offered once a model declares them.
 */
export const UNKNOWN_MODEL_EFFORTS: readonly AgentEffort[] = ['low', 'medium', 'high', 'xhigh']

/**
 * The catalog entry for the model a card will run: the picked one, or the
 * CLI's default when the card leaves the choice to the CLI.
 */
export function modelFor(models: readonly AgentModel[] | null | undefined, modelId: string | undefined): AgentModel | undefined {
  return modelId ? models?.find((m) => m.id === modelId) : models?.find((m) => m.isDefault)
}

export function isAgentEffort(value: unknown): value is AgentEffort {
  return typeof value === 'string' && (AGENT_EFFORTS as readonly string[]).includes(value)
}

/**
 * Levels a model declares: `null` when it declares nothing (unknown),
 * `[]` when it takes no effort at all.
 */
export function allowedEfforts(model: AgentModel | undefined): readonly AgentEffort[] | null {
  return model?.efforts ?? null
}

/** Levels a picker should offer for the model. */
export function selectableEfforts(model: AgentModel | undefined): readonly AgentEffort[] {
  return allowedEfforts(model) ?? UNKNOWN_MODEL_EFFORTS
}

/**
 * The card keeps the user's choice; only what is sent is lowered to the
 * deepest level the model allows without exceeding it. A model that takes no
 * effort gets none.
 */
export function clampEffort(
  effort: AgentEffort | undefined,
  allowed: readonly AgentEffort[]
): AgentEffort | undefined {
  if (allowed.length === 0) return undefined
  if (effort === undefined || allowed.includes(effort)) return effort
  const rank = AGENT_EFFORTS.indexOf(effort)
  const ordered = AGENT_EFFORTS.filter((level) => allowed.includes(level))
  const notDeeper = ordered.filter((level) => AGENT_EFFORTS.indexOf(level) <= rank)
  return notDeeper.length > 0 ? notDeeper[notDeeper.length - 1] : ordered[0]
}
