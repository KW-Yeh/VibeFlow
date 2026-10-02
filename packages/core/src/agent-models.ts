import { execFile } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import { AGENT_CLIS, type AgentCliId, type AgentModel } from './agents'
import { execEnv } from './env'

const pexec = promisify(execFile)

export type AgentModelSource = 'builtin' | 'codex-cache' | 'codex-cli'

export interface AgentModelList {
  models: AgentModel[]
  source: AgentModelSource
  /** Why a dynamic source was unusable, when the list fell back to builtin. */
  error?: string
}

export interface ListAgentModelsOptions {
  /** Ask the agent CLI itself (slow, spawns a process) instead of its cache. */
  refresh?: boolean
  /** Directory holding Codex's models_cache.json; defaults to the user's CODEX_HOME. */
  codexHome?: string
  /** Runs `codex debug models` and resolves its stdout. Injectable for tests. */
  runCodexModels?: () => Promise<string>
}

const CODEX_MODELS_TIMEOUT_MS = 20_000

function builtinModels(id: AgentCliId): AgentModel[] {
  return (AGENT_CLIS.find((a) => a.id === id) ?? AGENT_CLIS[0]).models
}

function defaultCodexHome(): string {
  const configured = process.env.CODEX_HOME?.trim()
  return configured ? configured : path.join(os.homedir(), '.codex')
}

async function defaultRunCodexModels(): Promise<string> {
  const { stdout } = await pexec('codex', ['debug', 'models'], {
    env: execEnv(),
    timeout: CODEX_MODELS_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  })
  return stdout
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

/**
 * Models offered for an agent, sourced from the CLI the user is already signed
 * in to — no provider API key involved. Claude's aliases always resolve to the
 * newest model of their tier, so its builtin list never goes stale.
 */
export async function listAgentModels(
  id: AgentCliId,
  opts: ListAgentModelsOptions = {}
): Promise<AgentModelList> {
  if (id !== 'codex') return { models: builtinModels(id), source: 'builtin' }

  if (opts.refresh) {
    try {
      const stdout = await (opts.runCodexModels ?? defaultRunCodexModels)()
      return { models: parseCodexCatalog(stdout), source: 'codex-cli' }
    } catch (err) {
      return { models: builtinModels(id), source: 'builtin', error: errorMessage(err) }
    }
  }

  const cachePath = path.join(opts.codexHome ?? defaultCodexHome(), 'models_cache.json')
  try {
    const raw = await fs.promises.readFile(cachePath, 'utf8')
    return { models: parseCodexCatalog(raw), source: 'codex-cache' }
  } catch (err) {
    const missing = (err as NodeJS.ErrnoException).code === 'ENOENT'
    return {
      models: builtinModels(id),
      source: 'builtin',
      ...(missing ? {} : { error: errorMessage(err) }),
    }
  }
}
