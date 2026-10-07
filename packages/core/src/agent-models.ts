import fs from 'fs'
import os from 'os'
import path from 'path'
import { AGENT_CLIS, type AgentCliId, type AgentModel } from './agents'
import { fetchClaudeModels } from './claude-models'
import { CodexLoginRequiredError, fetchCodexModels } from './codex-models'

export type AgentModelSource = 'builtin' | 'claude-cli' | 'codex-app-server' | 'codex-cache'

export interface AgentModelList {
  models: AgentModel[]
  source: AgentModelSource
  /** Why the agent CLI's own catalog was unusable, when the list fell back. */
  error?: string
  /** The CLI is still being asked; this is the fallback list until it answers. */
  pending?: true
  /** The agent CLI is not signed in (Codex: run `codex login`). */
  loginRequired?: true
}

function builtinModels(id: AgentCliId): AgentModel[] {
  return (AGENT_CLIS.find((a) => a.id === id) ?? AGENT_CLIS[0]).models
}

function defaultCodexHome(): string {
  const configured = process.env.CODEX_HOME?.trim()
  return configured ? configured : path.join(os.homedir(), '.codex')
}

/**
 * Codex's model catalog is not a published interface; anything that does not
 * look like `{ models: [{ slug, display_name?, visibility? }] }` is rejected so
 * the caller falls back to the builtin list instead of showing garbage.
 */
export function parseCodexCatalog(raw: string): AgentModel[] {
  const body = JSON.parse(raw) as { models?: unknown }
  if (!Array.isArray(body.models)) throw new Error('Codex model catalog has no models array')
  const seen = new Set<string>()
  const models: AgentModel[] = []
  for (const entry of body.models) {
    if (!entry || typeof entry !== 'object') continue
    const { slug, display_name: displayName, visibility } = entry as Record<string, unknown>
    if (typeof slug !== 'string' || !slug.trim() || visibility === 'hide') continue
    const id = slug.trim()
    if (seen.has(id)) continue
    seen.add(id)
    models.push({
      id,
      label: typeof displayName === 'string' && displayName.trim() ? displayName.trim() : id,
    })
  }
  if (models.length === 0) throw new Error('Codex model catalog lists no selectable models')
  return models
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function readCodexCache(codexHome: string): Promise<AgentModelList> {
  const cachePath = path.join(codexHome, 'models_cache.json')
  try {
    const raw = await fs.promises.readFile(cachePath, 'utf8')
    return { models: parseCodexCatalog(raw), source: 'codex-cache' }
  } catch (err) {
    const missing = (err as NodeJS.ErrnoException).code === 'ENOENT'
    return {
      models: builtinModels('codex'),
      source: 'builtin',
      ...(missing ? {} : { error: errorMessage(err) }),
    }
  }
}

export interface ModelCatalogOptions {
  /** VibeFlow's version, reported to codex app-server as the client version. */
  version: string
  /** Directory holding Codex's models_cache.json; defaults to the user's CODEX_HOME. */
  codexHome?: string
  /** Asks the Claude Code CLI. Injectable for tests. */
  fetchClaude?: () => Promise<AgentModel[]>
  /** Asks codex app-server. Injectable for tests. */
  fetchCodex?: () => Promise<AgentModel[]>
}

export interface ModelCatalog {
  /** The latest answer, or the fallback list while there is none — never starts a CLI. */
  get(id: AgentCliId): Promise<AgentModelList>
  /** Asks the agent CLI again and keeps the answer. */
  refresh(id: AgentCliId): Promise<AgentModelList>
  /** Asks both CLIs in the background. */
  warm(): void
  /** A model from the latest settled answer, for checks that cannot wait. */
  findModel(id: AgentCliId, modelId: string): AgentModel | undefined
}

/**
 * Models offered for each agent, sourced from the CLI the user is already
 * signed in to — no provider API key involved. Answers live in memory only:
 * they are asked for once at host start and again on an explicit refresh.
 */
export function createModelCatalog(opts: ModelCatalogOptions): ModelCatalog {
  const fetchClaude = opts.fetchClaude ?? (() => fetchClaudeModels())
  const fetchCodex = opts.fetchCodex ?? (() => fetchCodexModels(opts.version))
  const inFlight = new Map<AgentCliId, Promise<AgentModelList>>()
  const settled = new Map<AgentCliId, AgentModelList>()

  const fallback = (id: AgentCliId): Promise<AgentModelList> =>
    id === 'codex'
      ? readCodexCache(opts.codexHome ?? defaultCodexHome())
      : Promise.resolve({ models: builtinModels(id), source: 'builtin' })

  const ask = async (id: AgentCliId): Promise<AgentModelList> => {
    try {
      const models = await (id === 'codex' ? fetchCodex() : fetchClaude())
      return { models, source: id === 'codex' ? 'codex-app-server' : 'claude-cli' }
    } catch (err) {
      const list = await fallback(id)
      return {
        ...list,
        error: errorMessage(err),
        ...(err instanceof CodexLoginRequiredError ? { loginRequired: true as const } : {}),
      }
    }
  }

  const refresh = (id: AgentCliId): Promise<AgentModelList> => {
    const running = inFlight.get(id)
    if (running) return running
    const pending = ask(id)
      .then((list) => {
        settled.set(id, list)
        return list
      })
      .finally(() => inFlight.delete(id))
    inFlight.set(id, pending)
    return pending
  }

  return {
    async get(id) {
      const answer = settled.get(id)
      if (answer) return answer
      const list = await fallback(id)
      return inFlight.has(id) ? { ...list, pending: true } : list
    },
    refresh,
    warm() {
      for (const agent of AGENT_CLIS) void refresh(agent.id)
    },
    findModel(id, modelId) {
      return settled.get(id)?.models.find((model) => model.id === modelId)
    },
  }
}
