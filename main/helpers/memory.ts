import { execFile } from 'child_process'
import path from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

/** File name of the agent-memory sqlite store kept at the workspace root. */
export const MEMORY_DB_FILE = 'agent_memory.db'

export interface MemoryDecision {
  choice: string
  reason: string
}

export interface MemoryArtifact {
  id: string
  description: string
}

/** One agent-memory checkpoint, flattened for display in the task panel. */
export interface MemoryCheckpoint {
  id: string
  seq: number
  outcome: string | null
  decisions: MemoryDecision[]
  openItems: string[]
  createdAt: string
  artifacts: MemoryArtifact[]
}

/** Run a query against the sqlite db via the system CLI and parse -json output. */
async function query<T>(dbPath: string, sql: string): Promise<T[]> {
  // ponytail: shell out to the built-in macOS `sqlite3` instead of adding a
  // native sqlite dependency — this is read-only display data on app machines.
  const { stdout } = await execFileAsync('sqlite3', ['-json', dbPath, sql])
  const text = stdout.trim()
  if (!text) return [] // sqlite3 -json prints nothing when there are no rows
  return JSON.parse(text) as T[]
}

function parseJsonArray<T>(raw: unknown): T[] {
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

function sqlQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/**
 * Read the agent-memory checkpoints (and their artifact summaries) for a task
 * from the workspace's `agent_memory.db`. The memory task id is the VibeFlow
 * branch name (see the progress protocol). Returns [] when the db is absent,
 * the task has no checkpoints, or sqlite3 is unavailable.
 */
export async function getCheckpoints(
  workspacePath: string,
  memoryTaskId: string
): Promise<MemoryCheckpoint[]> {
  const dbPath = path.join(workspacePath, MEMORY_DB_FILE)
  const id = sqlQuote(memoryTaskId)
  try {
    const rows = await query<{
      id: string
      seq: number
      outcome: string | null
      decisions: string | null
      open_items: string | null
      created_at: string
    }>(
      dbPath,
      `SELECT id, seq, outcome, decisions, open_items, created_at
       FROM checkpoints WHERE task_id = ${id} ORDER BY seq;`
    )
    if (rows.length === 0) return []

    const artifacts = await query<{
      id: string
      checkpoint_id: string
      description: string | null
    }>(
      dbPath,
      `SELECT a.id, a.checkpoint_id, a.description
       FROM artifacts a JOIN checkpoints c ON c.id = a.checkpoint_id
       WHERE c.task_id = ${id};`
    )
    const byCheckpoint = new Map<string, MemoryArtifact[]>()
    for (const a of artifacts) {
      const list = byCheckpoint.get(a.checkpoint_id) ?? []
      list.push({ id: a.id, description: a.description ?? '' })
      byCheckpoint.set(a.checkpoint_id, list)
    }

    return rows.map((r) => ({
      id: r.id,
      seq: r.seq,
      outcome: r.outcome,
      decisions: parseJsonArray<MemoryDecision>(r.decisions),
      openItems: parseJsonArray<string>(r.open_items),
      createdAt: r.created_at,
      artifacts: byCheckpoint.get(r.id) ?? [],
    }))
  } catch {
    return []
  }
}
