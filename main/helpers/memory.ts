import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

/** File name of the single, shared agent-memory sqlite store. */
export const MEMORY_DB_FILE = 'agent_memory.db'

function expandHome(p: string, home: string): string {
  if (p === '~') return home
  if (p.startsWith(`~${path.sep}`) || p.startsWith('~/')) return path.join(home, p.slice(2))
  return p
}

function rootDbPath(root: string): string {
  return path.join(root, MEMORY_DB_FILE)
}

function discoverAgentMemoryRoot(home: string): string | null {
  const explicitRoot = process.env.AGENT_MEMORY_ROOT?.trim()
  if (explicitRoot) return path.resolve(expandHome(explicitRoot, home))

  const candidates = [
    path.join(home, 'agent-memory'),
    path.join(home, 'Desktop', 'agent-memory'),
    path.join(home, 'Documents', 'agent-memory'),
  ]
  return (
    candidates.find((root) =>
      fs.existsSync(path.join(root, 'core', 'mcp_server.py')) ||
      fs.existsSync(rootDbPath(root))
    ) ?? null
  )
}

/**
 * Absolute path to the one agent-memory db shared across every workspace,
 * project, CLI, and app. It prefers AGENT_MEMORY_DB / AGENT_MEMORY_ROOT, then
 * discovers a local agent-memory install root. The Electron userData path is
 * only a fallback for users who run VibeFlow before installing agent-memory.
 */
export async function unifiedMemoryDbPath(): Promise<string> {
  const { app } = await import('electron')
  const explicitDb = process.env.AGENT_MEMORY_DB?.trim()
  if (explicitDb) return path.resolve(expandHome(explicitDb, app.getPath('home')))

  const root = discoverAgentMemoryRoot(app.getPath('home'))
  if (root) return rootDbPath(root)

  return path.join(app.getPath('userData'), MEMORY_DB_FILE)
}

/**
 * Absolute path to the bundled stdio MCP memory server script. In dev it lives
 * in the repo (`main/memory/mcp-server.mjs`, relative to the app root); packaged
 * it is copied outside the asar via electron-builder `extraResources` so an
 * external `node` can execute it.
 */
export async function memoryServerPath(): Promise<string> {
  const { app } = await import('electron')
  if (app.isPackaged) return path.join(process.resourcesPath, 'mcp-server.mjs')
  return path.join(app.getAppPath(), 'main', 'memory', 'mcp-server.mjs')
}

/** What the renderer needs to inject the built-in memory MCP server at launch. */
export interface MemoryLaunchInfo {
  serverPath: string
  dbPath: string
}

/** Resolve the built-in memory server + unified db paths for a launch command. */
export async function memoryLaunchInfo(): Promise<MemoryLaunchInfo> {
  const [serverPath, dbPath] = await Promise.all([memoryServerPath(), unifiedMemoryDbPath()])
  return { serverPath, dbPath }
}

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

/** A prior task surfaced by FTS similarity to the current one. */
export interface RelatedTask {
  id: string
  title: string
  summary: string | null
  status: string | null
}

/** One explicit task_links edge, with the neighbour's title resolved. */
export interface MemoryTaskLink {
  otherId: string
  otherTitle: string | null
  relation: string
  note: string | null
  direction: 'outgoing' | 'incoming'
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
 * from the shared unified db. The memory task id is the VibeFlow branch name
 * (see the progress protocol). Returns [] when the db is absent, the task has
 * no checkpoints, or sqlite3 is unavailable.
 */
export async function getCheckpoints(
  memoryTaskId: string
): Promise<MemoryCheckpoint[]> {
  return getCheckpointsFromDb(await unifiedMemoryDbPath(), memoryTaskId)
}

/** getCheckpoints against an explicit db path (testable without Electron). */
export async function getCheckpointsFromDb(
  dbPath: string,
  memoryTaskId: string
): Promise<MemoryCheckpoint[]> {
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

/**
 * Other tasks in the unified store that are textually similar to this one
 * (FTS over title/summary, seeded from the current task's own title+summary,
 * excluding itself). Now that the store is unified this naturally spans every
 * workspace/project. Returns [] on any failure.
 */
export async function getRelatedTasks(memoryTaskId: string): Promise<RelatedTask[]> {
  return getRelatedTasksFromDb(await unifiedMemoryDbPath(), memoryTaskId)
}

export async function getRelatedTasksFromDb(
  dbPath: string,
  memoryTaskId: string,
  limit = 5
): Promise<RelatedTask[]> {
  const id = sqlQuote(memoryTaskId)
  try {
    const self = await query<{ title: string; summary: string | null }>(
      dbPath,
      `SELECT title, summary FROM tasks WHERE id = ${id};`
    )
    if (self.length === 0) return []
    const seed = `${self[0].title ?? ''} ${self[0].summary ?? ''}`.trim()
    const tokens = seed.split(/\s+/).filter(Boolean)
    if (tokens.length === 0) return []
    // FTS5 OR of the seed tokens so partial overlap still matches; excludes self.
    const ftsQuery = tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(' OR ')
    let rows: RelatedTask[]
    try {
      rows = await query<RelatedTask>(
        dbPath,
        `SELECT t.id, t.title, t.summary, t.status FROM tasks_fts f
         JOIN tasks t ON t.id = f.id
         WHERE tasks_fts MATCH ${sqlQuote(ftsQuery)} AND t.id != ${id} LIMIT ${limit};`
      )
    } catch {
      const like = sqlQuote(`%${seed}%`)
      rows = await query<RelatedTask>(
        dbPath,
        `SELECT id, title, summary, status FROM tasks
         WHERE id != ${id} AND (title LIKE ${like} OR summary LIKE ${like}) LIMIT ${limit};`
      )
    }
    return rows
  } catch {
    return []
  }
}

/**
 * Explicit task_links edges touching this task, in both directions, with the
 * neighbour task's title resolved. Returns [] on any failure.
 */
export async function getTaskLinks(memoryTaskId: string): Promise<MemoryTaskLink[]> {
  return getTaskLinksFromDb(await unifiedMemoryDbPath(), memoryTaskId)
}

export async function getTaskLinksFromDb(
  dbPath: string,
  memoryTaskId: string
): Promise<MemoryTaskLink[]> {
  const id = sqlQuote(memoryTaskId)
  try {
    const rows = await query<{
      other_id: string
      other_title: string | null
      relation: string
      note: string | null
      direction: 'outgoing' | 'incoming'
    }>(
      dbPath,
      `SELECT l.to_task AS other_id, t.title AS other_title, l.relation, l.note,
              'outgoing' AS direction
         FROM task_links l LEFT JOIN tasks t ON t.id = l.to_task
        WHERE l.from_task = ${id}
       UNION ALL
       SELECT l.from_task AS other_id, t.title AS other_title, l.relation, l.note,
              'incoming' AS direction
         FROM task_links l LEFT JOIN tasks t ON t.id = l.from_task
        WHERE l.to_task = ${id};`
    )
    return rows.map((r) => ({
      otherId: r.other_id,
      otherTitle: r.other_title,
      relation: r.relation,
      note: r.note,
      direction: r.direction,
    }))
  } catch {
    return []
  }
}
