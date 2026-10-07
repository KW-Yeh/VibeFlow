import fs from 'fs'
import os from 'os'
import path from 'path'
import type { AgentModel } from './agents'
import { isAgentEffort } from './effort'
import { spawnJsonLines, type OpenJsonLinesChannel } from './json-lines-process'

const CLAUDE_MODELS_TIMEOUT_MS = 15_000
const REQUEST_ID = 'vibeflow-models'

/**
 * The SDK control handshake Claude Code answers in stream-json mode. It
 * reports the signed-in account's model catalog without starting a turn, so
 * nothing is billed and no transcript is written. Not a published interface:
 * test/fixtures/agent-models/claude-initialize.jsonl pins the fields we read.
 */
const CLAUDE_ARGS = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose']

function openClaude(): ReturnType<OpenJsonLinesChannel> {
  // An empty cwd keeps project-level settings and hooks out of the handshake.
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-claude-models-'))
  return spawnJsonLines('claude', CLAUDE_ARGS, {
    cwd,
    timeoutMs: CLAUDE_MODELS_TIMEOUT_MS,
    onExit: () => fs.rmSync(cwd, { recursive: true, force: true }),
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isOurResponse(message: unknown): boolean {
  return isRecord(message)
    && message.type === 'control_response'
    && isRecord(message.response)
    && message.response.request_id === REQUEST_ID
}

/**
 * Only `models` is read from the response; the account details that ride
 * along never leave this function. `default` is dropped because the picker
 * already has its own "use the default model" entry.
 */
export function parseClaudeInitialize(message: unknown): AgentModel[] {
  const outer = isRecord(message) && isRecord(message.response) ? message.response : null
  if (outer?.subtype === 'error') throw new Error(`claude refused the handshake: ${String(outer.error ?? 'unknown error')}`)
  const body = outer && isRecord(outer.response) ? outer.response : null
  if (!body || !Array.isArray(body.models)) throw new Error('claude handshake has no models array')

  const seen = new Set<string>()
  const models: AgentModel[] = []
  for (const entry of body.models) {
    if (!isRecord(entry) || typeof entry.value !== 'string') continue
    const id = entry.value.trim()
    if (!id || id === 'default' || seen.has(id)) continue
    seen.add(id)
    const label = typeof entry.displayName === 'string' && entry.displayName.trim() ? entry.displayName.trim() : id
    const description = typeof entry.description === 'string' && entry.description.trim() ? entry.description.trim() : undefined
    const levels = entry.supportsEffort === true && Array.isArray(entry.supportedEffortLevels)
      ? entry.supportedEffortLevels.filter(isAgentEffort)
      : []
    models.push({ id, label, ...(description ? { description } : {}), efforts: levels })
  }
  if (models.length === 0) throw new Error('claude handshake lists no selectable models')
  return models
}

export async function fetchClaudeModels(open: OpenJsonLinesChannel = openClaude): Promise<AgentModel[]> {
  const channel = open()
  try {
    channel.send({ type: 'control_request', request_id: REQUEST_ID, request: { subtype: 'initialize' } })
    return parseClaudeInitialize(await channel.next(isOurResponse))
  } finally {
    channel.close()
  }
}
