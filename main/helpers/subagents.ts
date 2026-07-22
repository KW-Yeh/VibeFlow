import fs from 'fs'
import path from 'path'

/** Lifecycle of a sub-agent spawned by the main agent's Task tool. */
export type SubAgentStatus = 'running' | 'completed' | 'error'

/**
 * One sub-agent run, reconstructed from the Task tool's PreToolUse / PostToolUse
 * hook events. The prompt is captured when the sub-agent is spawned (PreToolUse);
 * the result + terminal status arrive when it finishes (PostToolUse).
 */
export interface SubAgentRun {
  /** Stable id derived from event order — deterministic across re-reads. */
  id: string
  /** Full prompt the sub-agent received (from the Task tool input). */
  prompt: string
  /** Short task description set on the Task call, if any. */
  description?: string
  /** Sub-agent type/persona requested (e.g. "Explore"), if any. */
  subagentType?: string
  status: SubAgentStatus
  /** Final output text the sub-agent returned (present once completed). */
  result?: string
  /** Epoch ms the sub-agent was spawned (from the PreToolUse event file). */
  startedAt?: number
  /** Epoch ms the sub-agent finished (from the PostToolUse event file). */
  endedAt?: number
}

/**
 * Directory (relative to the session cwd) the Claude hooks append one JSON file
 * per Task-tool event into. One file per event sidesteps the byte-interleaving
 * a shared append-only log would suffer under parallel sub-agents.
 * Must match the literal in renderer/lib/claude.ts (the --settings hook command).
 */
export const SUBAGENTS_DIR = '.vibeflow-subagents'

/** A single Task-tool hook event, normalized from the raw hook JSON. */
interface HookEvent {
  kind: 'pre' | 'post'
  prompt: string
  description?: string
  subagentType?: string
  result?: string
  /** Explicit failure flag from the tool response, when present. */
  failed?: boolean
  /** Epoch ms parsed from the event filename (best-effort). */
  ts?: number
}

/** Coerce an unknown tool result/response into a display string. */
function extractResult(raw: unknown): string | undefined {
  if (raw == null) return undefined
  if (typeof raw === 'string') return raw
  if (typeof raw === 'object') {
    const obj = raw as { output?: unknown; content?: unknown }
    if (typeof obj.output === 'string') return obj.output
    if (typeof obj.content === 'string') return obj.content
    try {
      return JSON.stringify(raw)
    } catch {
      return undefined
    }
  }
  return String(raw)
}

/** Did the tool response signal failure? Undefined when unknown. */
function extractFailed(raw: unknown): boolean | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const obj = raw as { success?: unknown; error?: unknown; is_error?: unknown }
  if (obj.success === false) return true
  if (obj.is_error === true) return true
  if (typeof obj.error === 'string' && obj.error.length > 0) return true
  return undefined
}

/** Parse one hook event file; null when it isn't a usable Task event. */
function parseEvent(raw: string, ts?: number): HookEvent | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!data || typeof data !== 'object') return null
  const obj = data as {
    hook_event_name?: unknown
    tool_name?: unknown
    tool_input?: unknown
    tool_response?: unknown
    tool_result?: unknown
  }
  const eventName =
    typeof obj.hook_event_name === 'string' ? obj.hook_event_name : ''
  const kind: 'pre' | 'post' | null =
    eventName === 'PreToolUse' ? 'pre' : eventName === 'PostToolUse' ? 'post' : null
  if (!kind) return null

  const input = (obj.tool_input ?? {}) as {
    prompt?: unknown
    description?: unknown
    subagent_type?: unknown
  }
  const prompt = typeof input.prompt === 'string' ? input.prompt : ''
  const response = obj.tool_response ?? obj.tool_result

  return {
    kind,
    prompt,
    description:
      typeof input.description === 'string' ? input.description : undefined,
    subagentType:
      typeof input.subagent_type === 'string' ? input.subagent_type : undefined,
    result: kind === 'post' ? extractResult(response) : undefined,
    failed: kind === 'post' ? extractFailed(response) : undefined,
    ts,
  }
}

/** Best-effort epoch ms from a `<epoch>-<pid>-<rand>.json` filename. */
function timestampFromName(name: string): number | undefined {
  const match = /^(\d+)/.exec(name)
  if (!match) return undefined
  const secs = Number(match[1])
  return Number.isFinite(secs) ? secs * 1000 : undefined
}

/** Fold the ordered event stream into the set of sub-agent runs. */
function reduceRuns(events: HookEvent[]): SubAgentRun[] {
  const runs: SubAgentRun[] = []
  let seq = 0
  for (const ev of events) {
    if (ev.kind === 'pre') {
      runs.push({
        id: `sa-${seq++}`,
        prompt: ev.prompt,
        description: ev.description,
        subagentType: ev.subagentType,
        status: 'running',
        startedAt: ev.ts,
      })
      continue
    }
    // PostToolUse: complete the earliest still-running run. Prefer a prompt
    // match (robust under parallel sub-agents); fall back to the earliest
    // running run when the post event carries no prompt to match on.
    let target = runs.find(
      (r) => r.status === 'running' && ev.prompt && r.prompt === ev.prompt
    )
    if (!target) {
      target = runs.find((r) => r.status === 'running')
    }
    if (!target) {
      // A completion with no matching spawn (spawn event missed/mid-write).
      target = {
        id: `sa-${seq++}`,
        prompt: ev.prompt,
        description: ev.description,
        subagentType: ev.subagentType,
        status: 'running',
        startedAt: ev.ts,
      }
      runs.push(target)
    }
    target.status = ev.failed ? 'error' : 'completed'
    target.result = ev.result
    target.endedAt = ev.ts
  }
  return runs
}

/** Read + reconstruct all sub-agent runs from the event dir under `cwd`. */
export function readSubAgents(cwd: string): SubAgentRun[] {
  const dir = path.join(cwd, SUBAGENTS_DIR)
  let names: string[]
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.json'))
  } catch {
    return []
  }
  const events: HookEvent[] = []
  for (const name of names) {
    let raw: string
    try {
      raw = fs.readFileSync(path.join(dir, name), 'utf8')
    } catch {
      continue
    }
    const ev = parseEvent(raw, timestampFromName(name))
    if (ev) events.push(ev)
  }
  // Order by event timestamp, then filename, so the fold is deterministic.
  events.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0))
  return reduceRuns(events)
}

interface WatchEntry {
  dir: string
  lastJson: string | null
  sync: () => void
}

/** Active sub-agent watchers keyed by session key (= taskId). */
const watchers = new Map<string, WatchEntry>()

/**
 * Poll-watch a session's sub-agent event dir and invoke `onUpdate` whenever the
 * reconstructed run set changes. `fs.watchFile` tolerates the dir not existing
 * yet (created lazily by the first hook). Re-watching a session key replaces
 * the prior watcher. Runs are session-only — main does NOT persist them to the store.
 */
export function watchSubAgents(
  sessionKey: string,
  cwd: string,
  onUpdate: (runs: SubAgentRun[]) => void
): void {
  unwatchSubAgents(sessionKey)
  const dir = path.join(cwd, SUBAGENTS_DIR)
  const sync = () => {
    const runs = readSubAgents(cwd)
    const json = JSON.stringify(runs)
    if (json === entry.lastJson) return
    // Skip the initial empty emit (no sub-agents yet) to avoid IPC noise.
    if (runs.length === 0 && entry.lastJson === null) {
      entry.lastJson = json
      return
    }
    entry.lastJson = json
    onUpdate(runs)
  }
  const entry: WatchEntry = { dir, lastJson: null, sync }
  watchers.set(sessionKey, entry)

  fs.watchFile(dir, { interval: 800 }, sync)
  sync() // pick up pre-existing events immediately (e.g. on resume)
}

/** Stop watching a session's sub-agent dir (PTY exited/killed, task cleaned up). */
export function unwatchSubAgents(sessionKey: string): void {
  const entry = watchers.get(sessionKey)
  if (entry) {
    fs.unwatchFile(entry.dir)
    watchers.delete(sessionKey)
  }
}

export function unwatchAllSubAgents(): void {
  for (const key of Array.from(watchers.keys())) {
    unwatchSubAgents(key)
  }
}
