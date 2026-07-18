#!/usr/bin/env node
/**
 * mcp-server.mjs — VibeFlow's built-in agent-memory MCP server.
 *
 * A dependency-free stdio JSON-RPC 2.0 MCP server (node builtins only) that
 * mirrors the desktop `memory.py` tool surface. It reads/writes the sqlite
 * store by shelling out to the system `sqlite3` CLI (same approach the app's
 * read-only `memory.ts` already uses — no native sqlite dependency), so a
 * plain external `node` can run it from outside the asar bundle.
 *
 * VibeFlow launches Claude with `--mcp-config` pointing at the same
 * install-root `agent_memory.db` used by the Python agent-memory server, so app
 * and CLI sessions share one memory store.
 *
 * Tools (mirror memory.py): memory_find_related_tasks, memory_get_task_detail,
 * memory_get_artifact, memory_save_checkpoint, memory_link_tasks.
 */
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'

const SERVER_NAME = 'agent_memory'
const SERVER_VERSION = '1.0.0'
const DEFAULT_PROTOCOL = '2024-11-05'
const COMPRESS_THRESHOLD = Number(process.env.AGENT_MEMORY_COMPRESS_AT || '12')

const DB_FILE = 'agent_memory.db'

function expandHome(p) {
  if (p === '~') return os.homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2))
  return p
}

function rootDbPath(root) {
  return path.join(root, DB_FILE)
}

function discoverAgentMemoryRoot() {
  if (process.env.AGENT_MEMORY_ROOT) return path.resolve(expandHome(process.env.AGENT_MEMORY_ROOT))
  const home = os.homedir()
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

// --db <path> tells the server which unified store to use. Without it, prefer
// the same install-root path used by the Python agent-memory server.
function argDb() {
  const i = process.argv.indexOf('--db')
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]
  if (process.env.AGENT_MEMORY_DB) return path.resolve(expandHome(process.env.AGENT_MEMORY_DB))
  const root = discoverAgentMemoryRoot()
  return root ? rootDbPath(root) : DB_FILE
}
const DB_PATH = argDb()

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT,
  status TEXT DEFAULT 'in_progress', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS task_tags (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id));
CREATE TABLE IF NOT EXISTS checkpoints (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL, outcome TEXT, decisions TEXT, open_items TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY, checkpoint_id TEXT NOT NULL REFERENCES checkpoints(id) ON DELETE CASCADE,
  description TEXT, content TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS task_links (
  from_task TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  to_task TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  relation TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL,
  PRIMARY KEY (from_task, to_task, relation));
CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(id UNINDEXED, title, summary);
CREATE INDEX IF NOT EXISTS idx_checkpoints_task ON checkpoints(task_id, seq);
CREATE INDEX IF NOT EXISTS idx_artifacts_cp ON artifacts(checkpoint_id);
CREATE INDEX IF NOT EXISTS idx_links_from ON task_links(from_task);
CREATE INDEX IF NOT EXISTS idx_links_to ON task_links(to_task);
`

// ---- sqlite3 CLI plumbing --------------------------------------------------
function sqlite3(sql, { json = false } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-batch']
    if (json) args.push('-json')
    args.push('-cmd', 'PRAGMA foreign_keys=ON;', DB_PATH)
    const child = spawn('sqlite3', args)
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(err.trim() || `sqlite3 exited ${code}`))
    )
    child.stdin.write(sql)
    child.stdin.end()
  })
}

async function queryJson(sql) {
  const out = (await sqlite3(sql, { json: true })).trim()
  return out ? JSON.parse(out) : []
}

function now() {
  return new Date().toISOString()
}
function id(prefix) {
  return `${prefix}-${randomBytes(6).toString('hex')}`
}
// SQL string literal with single-quote escaping.
function s(v) {
  return `'${String(v ?? '').replace(/'/g, "''")}'`
}
function jsonLit(v) {
  return s(JSON.stringify(v ?? []))
}
function parseJsonArr(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const p = JSON.parse(raw)
    return Array.isArray(p) ? p : []
  } catch {
    return []
  }
}

// ---- memory operations (mirror memory.py) ----------------------------------
async function findRelatedTasks({ query = '', tags = [], limit = 5 }) {
  const hits = new Map()
  if (query) {
    const tokens = query
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => `"${t.replace(/"/g, '""')}"`)
    const ftsQuery = tokens.length ? tokens.join(' OR ') : query
    let rows
    try {
      rows = await queryJson(
        `SELECT t.id, t.title, t.summary, t.status FROM tasks_fts f
         JOIN tasks t ON t.id = f.id WHERE tasks_fts MATCH ${s(ftsQuery)} LIMIT ${limit * 2};`
      )
    } catch {
      const like = s(`%${query}%`)
      rows = await queryJson(
        `SELECT id, title, summary, status FROM tasks
         WHERE title LIKE ${like} OR summary LIKE ${like} LIMIT ${limit * 2};`
      )
    }
    for (const r of rows) hits.set(r.id, r)
  }
  if (tags && tags.length) {
    const inList = tags.map((t) => s(String(t).toLowerCase())).join(',')
    const rows = await queryJson(
      `SELECT DISTINCT t.id, t.title, t.summary, t.status FROM tasks t
       JOIN task_tags tt ON tt.task_id = t.id JOIN tags g ON g.id = tt.tag_id
       WHERE g.name IN (${inList}) LIMIT ${limit * 2};`
    )
    for (const r of rows) hits.set(r.id, r)
  }
  const results = [...hits.values()].slice(0, limit)
  for (const r of results) {
    const tagRows = await queryJson(
      `SELECT g.name FROM tags g JOIN task_tags tt ON tt.tag_id = g.id
       WHERE tt.task_id = ${s(r.id)};`
    )
    r.tags = tagRows.map((t) => t.name)
  }
  return { results }
}

async function getTaskDetail({ task_id }) {
  const tasks = await queryJson(`SELECT * FROM tasks WHERE id = ${s(task_id)};`)
  if (!tasks.length) return { error: `no task ${task_id}` }
  const out = tasks[0]
  const cps = await queryJson(
    `SELECT * FROM checkpoints WHERE task_id = ${s(task_id)} ORDER BY seq;`
  )
  out.checkpoints = []
  for (const cp of cps) {
    cp.decisions = parseJsonArr(cp.decisions)
    cp.open_items = parseJsonArr(cp.open_items)
    cp.artifacts = await queryJson(
      `SELECT id, description FROM artifacts WHERE checkpoint_id = ${s(cp.id)};`
    )
    out.checkpoints.push(cp)
  }
  out.links = await queryJson(
    `SELECT to_task, relation, note FROM task_links WHERE from_task = ${s(task_id)};`
  )
  return out
}

async function getArtifact({ artifact_id }) {
  const rows = await queryJson(`SELECT * FROM artifacts WHERE id = ${s(artifact_id)};`)
  return rows.length ? rows[0] : { error: `no artifact ${artifact_id}` }
}

async function saveCheckpoint(p) {
  const {
    task_id,
    title,
    summary,
    outcome,
    decisions = [],
    open_items = [],
    artifacts = [],
    tags = [],
    status = 'in_progress',
  } = p
  const ts = now()
  const cpId = id('cp')

  const tagStmts = (tags || [])
    .map((t) => String(t).trim().toLowerCase())
    .filter(Boolean)
    .flatMap((name) => [
      `INSERT OR IGNORE INTO tags(name) VALUES(${s(name)});`,
      `INSERT OR IGNORE INTO task_tags(task_id, tag_id)
         SELECT ${s(task_id)}, id FROM tags WHERE name = ${s(name)};`,
    ])

  const artStmts = (artifacts || []).map(
    (a) =>
      `INSERT INTO artifacts(id, checkpoint_id, description, content, created_at)
       VALUES(${s(id('art'))}, ${s(cpId)}, ${s(a.description || '')}, ${s(a.content || '')}, ${s(ts)});`
  )

  const script = `
${SCHEMA}
BEGIN;
INSERT INTO tasks(id, title, summary, status, created_at, updated_at)
  VALUES(${s(task_id)}, ${s(title)}, ${s(summary)}, ${s(status)}, ${s(ts)}, ${s(ts)})
  ON CONFLICT(id) DO UPDATE SET
    title = excluded.title, summary = excluded.summary,
    status = excluded.status, updated_at = excluded.updated_at;
DELETE FROM tasks_fts WHERE id = ${s(task_id)};
INSERT INTO tasks_fts(id, title, summary) VALUES(${s(task_id)}, ${s(title)}, ${s(summary)});
${tagStmts.join('\n')}
INSERT INTO checkpoints(id, task_id, seq, outcome, decisions, open_items, created_at)
  SELECT ${s(cpId)}, ${s(task_id)}, COALESCE(MAX(seq), 0) + 1,
         ${s(outcome)}, ${jsonLit(decisions)}, ${jsonLit(open_items)}, ${s(ts)}
  FROM checkpoints WHERE task_id = ${s(task_id)};
${artStmts.join('\n')}
COMMIT;
`
  await sqlite3(script)

  const seqRows = await queryJson(`SELECT seq FROM checkpoints WHERE id = ${s(cpId)};`)
  const countRows = await queryJson(
    `SELECT COUNT(*) AS c FROM checkpoints WHERE task_id = ${s(task_id)};`
  )
  const seq = seqRows.length ? seqRows[0].seq : 1
  const count = countRows.length ? countRows[0].c : 1
  return { task_id, checkpoint_id: cpId, seq, compressed: count >= COMPRESS_THRESHOLD }
}

async function linkTasks({ from_task, to_task, relation, note = '' }) {
  await sqlite3(`
${SCHEMA}
INSERT OR REPLACE INTO task_links(from_task, to_task, relation, note, created_at)
  VALUES(${s(from_task)}, ${s(to_task)}, ${s(relation)}, ${s(note)}, ${s(now())});
`)
  return { from: from_task, to: to_task, relation }
}

// ---- MCP tool registry -----------------------------------------------------
const DB_DESC =
  'Optional absolute path to the memory db. Omit to use the server-configured unified store.'

const TOOLS = [
  {
    name: 'memory_find_related_tasks',
    description:
      'Search prior tasks for relevant past work BEFORE starting. Returns light records (title, one-line summary, tags) only — never checkpoint or document bodies.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text describing the task to match.' },
        tags: { type: 'array', items: { type: 'string' } },
        limit: { type: 'integer', minimum: 1, maximum: 20, default: 5 },
        db_path: { type: 'string', description: DB_DESC },
      },
    },
    handler: findRelatedTasks,
  },
  {
    name: 'memory_get_task_detail',
    description:
      "Load a prior task's rolling summary, all checkpoints (outcomes, decisions, open items) and artifact POINTERS (id + description only). Call after find_related_tasks surfaces a relevant task.",
    inputSchema: {
      type: 'object',
      required: ['task_id'],
      properties: {
        task_id: { type: 'string', minLength: 1 },
        db_path: { type: 'string', description: DB_DESC },
      },
    },
    handler: getTaskDetail,
  },
  {
    name: 'memory_get_artifact',
    description:
      'Load the FULL body of one large artifact by id. The only path that pulls heavy content into context; call only when a specific artifact pointer is actually needed.',
    inputSchema: {
      type: 'object',
      required: ['artifact_id'],
      properties: {
        artifact_id: { type: 'string', minLength: 1 },
        db_path: { type: 'string', description: DB_DESC },
      },
    },
    handler: getArtifact,
  },
  {
    name: 'memory_save_checkpoint',
    description:
      'Seal a stage of work when handing off or ending a session. Keep decisions + reasons; DROP trial-and-error. Put large outputs in `artifacts`, not inline in `outcome`. Returns {task_id, checkpoint_id, seq, compressed}.',
    inputSchema: {
      type: 'object',
      required: ['task_id', 'title', 'summary', 'outcome'],
      properties: {
        task_id: { type: 'string', description: 'Stable id for this task across sessions/agents.' },
        title: { type: 'string' },
        summary: { type: 'string', description: 'One-line current state of the WHOLE task.' },
        outcome: { type: 'string', description: 'What THIS stage achieved.' },
        decisions: {
          type: 'array',
          items: {
            type: 'object',
            properties: { choice: { type: 'string' }, reason: { type: 'string' } },
          },
        },
        open_items: { type: 'array', items: { type: 'string' } },
        artifacts: {
          type: 'array',
          items: {
            type: 'object',
            properties: { description: { type: 'string' }, content: { type: 'string' } },
          },
        },
        tags: { type: 'array', items: { type: 'string' } },
        status: { type: 'string', description: 'in_progress | done | archived' },
        db_path: { type: 'string', description: DB_DESC },
      },
    },
    handler: saveCheckpoint,
  },
  {
    name: 'memory_link_tasks',
    description:
      'Record a STABLE relationship between two tasks (depends_on | supersedes | derived_from | blocks | relates_to). Not for topical similarity — that is found by find_related_tasks.',
    inputSchema: {
      type: 'object',
      required: ['from_task', 'to_task', 'relation'],
      properties: {
        from_task: { type: 'string' },
        to_task: { type: 'string' },
        relation: { type: 'string' },
        note: { type: 'string' },
        db_path: { type: 'string', description: DB_DESC },
      },
    },
    handler: linkTasks,
  },
]
const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]))

// ---- JSON-RPC over stdio ---------------------------------------------------
function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n')
}
function reply(id, result) {
  send({ jsonrpc: '2.0', id, result })
}
function replyError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

async function handle(req) {
  const { id: rid, method, params } = req
  const isNotification = rid === undefined || rid === null

  if (method === 'initialize') {
    reply(rid, {
      protocolVersion: params?.protocolVersion || DEFAULT_PROTOCOL,
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    })
    return
  }
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') return
  if (method === 'ping') {
    if (!isNotification) reply(rid, {})
    return
  }
  if (method === 'tools/list') {
    reply(rid, {
      tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    })
    return
  }
  if (method === 'tools/call') {
    const tool = TOOL_BY_NAME.get(params?.name)
    if (!tool) return replyError(rid, -32602, `unknown tool ${params?.name}`)
    try {
      const result = await tool.handler(params.arguments || {})
      reply(rid, { content: [{ type: 'text', text: JSON.stringify(result) }] })
    } catch (err) {
      reply(rid, {
        content: [{ type: 'text', text: `memory error: ${err?.message || err}` }],
        isError: true,
      })
    }
    return
  }
  if (!isNotification) replyError(rid, -32601, `method not found: ${method}`)
}

const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  let req
  try {
    req = JSON.parse(trimmed)
  } catch {
    return // ignore non-JSON noise
  }
  handle(req).catch((err) => process.stderr.write(`handler crash: ${err?.stack || err}\n`))
})
