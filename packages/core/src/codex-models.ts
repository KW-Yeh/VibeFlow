import os from 'os'
import type { AgentModel } from './agents'
import { isAgentEffort } from './effort'
import { execEnv } from './env'
import { spawnJsonLines, type OpenJsonLinesChannel } from './json-lines-process'

const CODEX_MODELS_TIMEOUT_MS = 20_000
/** Guards against a server that keeps handing out cursors. */
const MAX_PAGES = 20

/** Codex answered, but nobody is signed in — the catalog it would list is not the user's. */
export class CodexLoginRequiredError extends Error {
  constructor() {
    super('Codex CLI is not signed in; run `codex login`')
    this.name = 'CodexLoginRequiredError'
  }
}

/**
 * `codex app-server` speaks JSON-RPC over stdio (https://learn.chatgpt.com/docs/app-server).
 * It runs with the user's own environment: the library's CODEX_HOME override
 * only applies to launched tasks, so the user's login is what answers here.
 */
export function codexAppServerCommand() {
  return {
    bin: 'codex',
    args: ['app-server', '--listen', 'stdio://'],
    cwd: os.homedir(),
    env: execEnv(),
  }
}

function openCodex(): ReturnType<OpenJsonLinesChannel> {
  const { bin, args, cwd, env } = codexAppServerCommand()
  return spawnJsonLines(bin, args, { cwd, env, timeoutMs: CODEX_MODELS_TIMEOUT_MS })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const responseTo = (id: number) => (message: unknown) =>
  isRecord(message) && message.id === id && ('result' in message || 'error' in message)

function resultOf(message: unknown, method: string): Record<string, unknown> {
  if (!isRecord(message)) throw new Error(`codex ${method}: malformed response`)
  if (isRecord(message.error)) throw new Error(`codex ${method}: ${String(message.error.message ?? 'request failed')}`)
  if (!isRecord(message.result)) throw new Error(`codex ${method}: response has no result`)
  return message.result
}

/** Only the sign-in state is read; the account's details are not. */
export function isCodexSignedIn(result: Record<string, unknown>): boolean {
  return result.account != null || result.requiresOpenaiAuth === false
}

export function parseCodexModelPage(result: Record<string, unknown>): { models: AgentModel[]; nextCursor: string | null } {
  if (!Array.isArray(result.data)) throw new Error('codex model/list has no data array')
  const models: AgentModel[] = []
  for (const entry of result.data) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id.trim() || entry.hidden === true) continue
    const id = entry.id.trim()
    const label = typeof entry.displayName === 'string' && entry.displayName.trim() ? entry.displayName.trim() : id
    const description = typeof entry.description === 'string' && entry.description.trim() ? entry.description.trim() : undefined
    const efforts = Array.isArray(entry.supportedReasoningEfforts)
      ? entry.supportedReasoningEfforts
          .map((e) => (isRecord(e) ? e.reasoningEffort : undefined))
          .filter(isAgentEffort)
      : undefined
    models.push({
      id,
      label,
      ...(description ? { description } : {}),
      ...(efforts ? { efforts } : {}),
      ...(entry.isDefault === true ? { isDefault: true } : {}),
    })
  }
  const nextCursor = typeof result.nextCursor === 'string' && result.nextCursor ? result.nextCursor : null
  return { models, nextCursor }
}

export async function fetchCodexModels(
  clientVersion: string,
  open: OpenJsonLinesChannel = openCodex
): Promise<AgentModel[]> {
  const channel = open()
  try {
    channel.send({
      method: 'initialize',
      id: 1,
      params: { clientInfo: { name: 'vibeflow', title: 'VibeFlow', version: clientVersion } },
    })
    resultOf(await channel.next(responseTo(1)), 'initialize')
    channel.send({ method: 'initialized', params: {} })

    channel.send({ method: 'account/read', id: 2, params: { refreshToken: false } })
    if (!isCodexSignedIn(resultOf(await channel.next(responseTo(2)), 'account/read'))) {
      throw new CodexLoginRequiredError()
    }

    const seen = new Set<string>()
    const models: AgentModel[] = []
    let cursor: string | null = null
    for (let page = 0; page < MAX_PAGES; page++) {
      const id = 3 + page
      channel.send({
        method: 'model/list',
        id,
        params: { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) },
      })
      const parsed = parseCodexModelPage(resultOf(await channel.next(responseTo(id)), 'model/list'))
      for (const model of parsed.models) {
        if (seen.has(model.id)) continue
        seen.add(model.id)
        models.push(model)
      }
      cursor = parsed.nextCursor
      if (!cursor) break
    }
    if (cursor) throw new Error(`codex model/list did not finish within ${MAX_PAGES} pages`)
    if (models.length === 0) throw new Error('codex model/list lists no selectable models')
    return models
  } finally {
    channel.close()
  }
}
