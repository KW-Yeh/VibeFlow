import { execFile } from 'child_process'
import os from 'os'
import { promisify } from 'util'
import { buildEnv } from './env'

const pexec = promisify(execFile)

/**
 * Meaningful branch naming for task worktrees.
 *
 * Priority:
 *   1. eBug code in the title/description (e.g. WCL260522-0002) → `fix/<code>`
 *   2. Jira ticket key (e.g. WR-4832)                           → `feature/<key>`
 *   3. Card title → short English slug → `feature/<slug>` (or `fix/<slug>`
 *      when the wording hints at a bug fix). Non-English titles are
 *      translated via a headless `claude -p` call when available.
 *   4. Anything else falls back to the legacy `vf-<taskId>` (caller's job).
 */

/** eBug codes like WCL260522-0002: 2-4 letters + 6-digit date + serial. */
const EBUG_RE = /\b([A-Z]{2,4}\d{6}-\d{3,4})\b/
/** Jira issue keys like WR-4832: an uppercase project key + issue number. */
const JIRA_RE = /\b([A-Z][A-Z0-9]{1,9}-\d{1,6})\b/

/** Wording that suggests the task is a bug fix rather than a feature. */
const FIX_HINT_RE =
  /\b(fix|bug|bugfix|hotfix|patch|crash|regression)\b|修復|修正|錯誤|崩潰|閃退|壞掉/i

const MAX_SLUG_LENGTH = 48
const MAX_SLUG_WORDS = 6

/** Normalize free text into a lowercase hyphen slug; null when nothing usable. */
export function slugify(text: string): string | null {
  const words = text
    .toLowerCase()
    // Keep ASCII letters/digits only — CJK and symbols become separators.
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_SLUG_WORDS)
  if (words.length === 0) return null
  const slug = words.join('-').slice(0, MAX_SLUG_LENGTH).replace(/-+$/, '')
  // Require at least one letter and a minimally descriptive length.
  if (slug.length < 3 || !/[a-z]/.test(slug)) return null
  return slug
}

/** Pick `fix` or `feature` from the card's wording. */
function branchPrefix(title: string, description?: string): 'fix' | 'feature' {
  return FIX_HINT_RE.test(`${title}\n${description ?? ''}`) ? 'fix' : 'feature'
}

/**
 * Derive a branch name WITHOUT any LLM call: ticket codes first, then a local
 * slug of the title (works when the title already contains English words).
 * Returns null when nothing meaningful can be derived locally.
 */
export function buildCandidateBranch(
  title: string,
  description?: string
): string | null {
  const text = `${title}\n${description ?? ''}`

  // eBug before Jira: an eBug code (WCL260522-0002) also matches the looser
  // Jira pattern, so the more specific format must win.
  const ebug = text.match(EBUG_RE)
  if (ebug) return `fix/${ebug[1]}`

  const jira = text.match(JIRA_RE)
  if (jira) return `feature/${jira[1]}`

  const slug = slugify(title)
  if (slug) return `${branchPrefix(title, description)}/${slug}`

  return null
}

/**
 * Translate a (typically Chinese) title into an English slug via a headless
 * `claude -p` call. Best-effort: returns null on missing CLI, timeout, or
 * unusable output — task creation must never fail because of this step.
 */
async function translateTitleToSlug(title: string): Promise<string | null> {
  const prompt =
    'Translate this software task title into a short English git branch slug: ' +
    '2-6 lowercase words joined by hyphens, no prefix, no quotes, no explanation. ' +
    `Output ONLY the slug.\nTitle: ${title}`
  try {
    const { stdout } = await pexec(
      'claude',
      ['-p', prompt, '--model', 'haiku'],
      {
        cwd: os.tmpdir(), // neutral cwd — don't pick up any project's CLAUDE.md
        timeout: 20_000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, PATH: buildEnv().PATH },
      }
    )
    // Take the last non-empty line and re-sanitize — never trust raw output
    // as a git ref component.
    const lines = stdout
      .toString()
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    const last = lines[lines.length - 1]
    if (!last) return null
    return slugify(last)
  } catch {
    return null
  }
}

/**
 * Generate the preferred branch name for a new task. Returns null when no
 * meaningful name could be derived — the caller falls back to `vf-<taskId>`.
 * Uniqueness against existing branches is handled later by provisionWorktree.
 */
export async function generateBranchName(
  title: string,
  description?: string
): Promise<string | null> {
  const local = buildCandidateBranch(title, description)
  if (local) return local

  // Title has no usable ASCII (e.g. pure Chinese) — ask claude to translate.
  const translated = await translateTitleToSlug(title)
  if (translated) return `${branchPrefix(title, description)}/${translated}`

  return null
}
