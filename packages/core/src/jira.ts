import { adfToMarkdown } from './jira-adf'
import { defaultAcliRunner, getJiraAuthStatus, type AcliRunner, type JiraAuthStatus } from './jira-auth'

export interface JiraRef { key: string; url: string; site: string }
export type JiraStatusCategory = 'new' | 'indeterminate' | 'done'
export interface JiraAttachment { id: string; filename: string; size: number | null; url: string }
export interface JiraTicket {
  key: string
  url: string
  projectKey: string
  summary: string
  status: { name: string; category: JiraStatusCategory }
  issueType: string
  priority: string | null
  storyPoints: number | null
  dueDate: string | null
  sprint: string | null
  parentKey: string | null
  attachments: JiraAttachment[]
  description: string
  createdAt: string
  updatedAt: string
}
export interface JiraInbox {
  status: 'ok' | 'acli-missing' | 'unauthenticated'
  site?: string
  email?: string
  fetchedAt: number
  tickets: JiraTicket[]
  error?: string
}

type Raw = Record<string, unknown>
const asRaw = (v: unknown): Raw => v && typeof v === 'object' && !Array.isArray(v) ? v as Raw : {}
const nameOf = (v: unknown): string => typeof v === 'string' ? v : String(asRaw(v).name ?? '')
export const JIRA_INBOX_JQL = 'assignee = currentUser() AND (statusCategory != Done OR sprint in openSprints()) ORDER BY updated DESC'
export const DEFAULT_POINT_FIELDS = ['customfield_10033', 'customfield_10016']
export const JIRA_CACHE_TTL_MS = 5 * 60 * 1000

export function buildSearchArgs(): string[] {
  return ['jira', 'workitem', 'search', '--jql', JIRA_INBOX_JQL, '--fields',
    'key,summary,status,issuetype,priority,description',
    '--json', '--paginate', '--limit', '200']
}

export function buildViewArgs(key: string, pointFields = DEFAULT_POINT_FIELDS): string[] {
  return ['jira', 'workitem', 'view', key, '--fields',
    [...new Set(['duedate', 'parent', 'attachment', 'created', 'updated', 'project', 'customfield_10020', ...pointFields])].join(','), '--json']
}

function attachmentsOf(value: unknown, site: string): JiraAttachment[] {
  if (!Array.isArray(value) || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.atlassian\.net$/.test(site)) return []
  return value.flatMap((item) => {
    const attachment = asRaw(item)
    const id = String(attachment.id ?? '')
    const filename = attachment.filename
    if (!/^\d+$/.test(id) || typeof filename !== 'string' || !filename.trim()) return []
    return [{
      id, filename,
      size: typeof attachment.size === 'number' && Number.isFinite(attachment.size) && attachment.size >= 0 ? attachment.size : null,
      url: `https://${site}/rest/api/3/attachment/content/${id}`,
    }]
  })
}

export function isJiraRef(value: unknown): value is JiraRef {
  const v = asRaw(value)
  return typeof v.key === 'string' && /^[A-Z][A-Z0-9_]+-\d+$/.test(v.key)
    && typeof v.site === 'string' && /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.atlassian\.net$/.test(v.site)
    && v.url === `https://${v.site}/browse/${v.key}`
}

export function toTicket(raw: unknown, site: string, pointFields = DEFAULT_POINT_FIELDS): JiraTicket | null {
  const row = asRaw(raw)
  const fields = asRaw(row.fields)
  const source = Object.keys(fields).length ? fields : row
  const key = row.key
  if (typeof key !== 'string' || !/^[A-Z][A-Z0-9_]+-\d+$/.test(key)) return null
  const status = asRaw(source.status)
  const category = asRaw(status.statusCategory)
  const categoryKey = String(category.key ?? category.name ?? '').toLowerCase()
  const points = pointFields.map((field) => source[field]).find((v) => typeof v === 'number' && Number.isFinite(v))
  const sprintValue = source.customfield_10020
  const sprintList = Array.isArray(sprintValue) ? sprintValue : sprintValue ? [sprintValue] : []
  const activeSprint = sprintList.map(asRaw).find((s) => String(s.state ?? '').toLowerCase() === 'active')
  const parent = asRaw(source.parent)
  return {
    key, url: `https://${site}/browse/${key}`, projectKey: String(asRaw(source.project).key ?? key.split('-')[0]),
    summary: String(source.summary ?? ''),
    status: { name: nameOf(source.status), category: categoryKey === 'done' ? 'done' : categoryKey === 'indeterminate' || categoryKey === 'in progress' ? 'indeterminate' : 'new' },
    issueType: nameOf(source.issuetype), priority: nameOf(source.priority) || null,
    storyPoints: typeof points === 'number' ? points : null,
    dueDate: typeof source.duedate === 'string' ? source.duedate : null,
    sprint: typeof activeSprint?.name === 'string' ? activeSprint.name : null,
    parentKey: typeof parent.key === 'string' ? parent.key : null,
    attachments: attachmentsOf(source.attachment, site),
    description: adfToMarkdown(source.description), createdAt: String(source.created ?? ''), updatedAt: String(source.updated ?? ''),
  }
}

function searchRows(output: string): unknown[] {
  const parsed: unknown = JSON.parse(output)
  if (Array.isArray(parsed)) return parsed
  const body = asRaw(parsed)
  if (Array.isArray(body.issues)) return body.issues
  if (Array.isArray(body.values)) return body.values
  throw new Error('無法辨識 acli Jira search 的 JSON 格式')
}

async function enrichRows(rows: unknown[], run: AcliRunner, pointFields: string[]): Promise<{ rows: unknown[]; failed: number }> {
  const enriched = Array.from(rows)
  let next = 0
  let failed = 0
  async function worker() {
    while (next < rows.length) {
      const index = next++
      const row = asRaw(rows[index])
      if (typeof row.key !== 'string') continue
      try {
        const detail = asRaw(JSON.parse(await run(buildViewArgs(row.key, pointFields))))
        enriched[index] = { ...row, fields: { ...asRaw(row.fields), ...asRaw(detail.fields) } }
      } catch {
        // Keep the search result when an individual detail request fails.
        failed++
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, rows.length) }, () => worker()))
  return { rows: enriched, failed }
}

export function createJiraService(options: {
  run?: AcliRunner
  authStatus?: () => Promise<JiraAuthStatus>
  pointFields?: () => string[]
  now?: () => number
}) {
  const run = options.run ?? defaultAcliRunner
  const authStatus = options.authStatus ?? (() => getJiraAuthStatus(run))
  const now = options.now ?? Date.now
  let cache: { at: number; site: string; value: Promise<JiraInbox> } | null = null
  return {
    clear() { cache = null },
    async inbox(opts: { force?: boolean } = {}): Promise<JiraInbox> {
      const auth = await authStatus()
      if (!auth.installed) return { status: 'acli-missing', fetchedAt: 0, tickets: [] }
      if (!auth.authenticated || !auth.site) return { status: 'unauthenticated', fetchedAt: 0, tickets: [] }
      if (cache && cache.site === auth.site && !opts.force && now() - cache.at < JIRA_CACHE_TTL_MS) return cache.value
      const at = now()
      const pointFields = options.pointFields?.() ?? DEFAULT_POINT_FIELDS
      const value: Promise<JiraInbox> = run(buildSearchArgs()).then(async (output) => {
        const detail = await enrichRows(searchRows(output), run, pointFields)
        return {
          status: 'ok' as const, site: auth.site, email: auth.email, fetchedAt: at,
          tickets: detail.rows.map((row) => toTicket(row, auth.site!, pointFields)).filter((ticket): ticket is JiraTicket => ticket !== null),
          ...(detail.failed ? { error: `${detail.failed} 張 Jira ticket 的詳細欄位讀取失敗；清單仍可查看。` } : {}),
        }
      }).catch((err) => ({
        status: 'ok' as const, site: auth.site, email: auth.email, fetchedAt: at, tickets: [],
        error: String((err as { stderr?: string; message?: string }).stderr || (err as Error).message || err),
      }))
      cache = { at, site: auth.site, value }
      return value
    },
  }
}
