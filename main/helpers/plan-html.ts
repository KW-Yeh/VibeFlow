import fs from 'fs/promises'
import path from 'path'
import { agentPlanPath } from './progress'

/**
 * Filesystem-safe name for the preserved plan.html: `<title>-<createdAt>.html`.
 * Unlike the runtime PLAN.md/progress/review files, this is NOT cleared when the
 * task completes — it stays in the workspace folder as a durable record.
 */
export function planHtmlFileName(title: string, createdAt: number): string {
  const safe =
    title
      .trim()
      .replace(/[/\\:*?"<>|]/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 80) || 'plan'
  return `${safe}-${createdAt}.html`
}

// ── Inline-level markdown transforms ─────────────────────────────────────────

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function inline(raw: string): string {
  // Escape HTML first, then apply markdown patterns.
  let s = escHtml(raw)
  // Bold
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  // Italic (only single asterisk)
  s = s.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>')
  // Inline code – already escaped
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>')
  // Strikethrough
  s = s.replace(/~~(.+?)~~/g, '<del>$1</del>')
  // Links [text](url)
  s = s.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>'
  )
  return s
}

// ── Block-level conversion ────────────────────────────────────────────────────

function mdToHtml(md: string): string {
  const lines = md.split('\n')
  const out: string[] = []

  let inCode = false
  let codeLang = ''
  let codeLines: string[] = []

  let inUl = false       // plain unordered list
  let inTaskUl = false   // task-list unordered list
  let inOl = false

  const closeList = () => {
    if (inUl) { out.push('</ul>'); inUl = false }
    if (inTaskUl) { out.push('</ul>'); inTaskUl = false }
    if (inOl) { out.push('</ol>'); inOl = false }
  }

  for (const line of lines) {
    // ── Fenced code block ──────────────────────────────────────────────────
    if (/^```/.test(line)) {
      if (inCode) {
        const escaped = codeLines.map(escHtml).join('\n')
        const langAttr = codeLang ? ` class="language-${escHtml(codeLang)}"` : ''
        out.push(`<pre><code${langAttr}>${escaped}</code></pre>`)
        inCode = false
        codeLang = ''
        codeLines = []
      } else {
        closeList()
        codeLang = line.slice(3).trim()
        inCode = true
      }
      continue
    }

    if (inCode) {
      codeLines.push(line)
      continue
    }

    // ── ATX heading ───────────────────────────────────────────────────────
    const hm = line.match(/^(#{1,6})\s+(.+)/)
    if (hm) {
      closeList()
      const lvl = Math.min(hm[1].length, 6)
      out.push(`<h${lvl}>${inline(hm[2].trim())}</h${lvl}>`)
      continue
    }

    // ── Horizontal rule ───────────────────────────────────────────────────
    if (/^[-*_]{3,}\s*$/.test(line.trim())) {
      closeList()
      out.push('<hr>')
      continue
    }

    // ── Task list item ────────────────────────────────────────────────────
    const taskm = line.match(/^(\s*)-\s+\[([x ])\]\s?(.*)/)
    if (taskm) {
      if (inUl) { out.push('</ul>'); inUl = false }
      if (inOl) { out.push('</ol>'); inOl = false }
      if (!inTaskUl) { out.push('<ul class="task-list">'); inTaskUl = true }
      const done = taskm[2] === 'x'
      const cls = done ? ' class="done"' : ''
      const chk = done ? ' checked' : ''
      out.push(
        `<li${cls}><input type="checkbox" disabled${chk}><span>${inline(taskm[3])}</span></li>`
      )
      continue
    }

    // ── Unordered list ────────────────────────────────────────────────────
    const ulm = line.match(/^(\s*)-\s+(.*)/)
    if (ulm) {
      if (inTaskUl) { out.push('</ul>'); inTaskUl = false }
      if (inOl) { out.push('</ol>'); inOl = false }
      if (!inUl) { out.push('<ul>'); inUl = true }
      out.push(`<li>${inline(ulm[2])}</li>`)
      continue
    }

    // ── Ordered list ──────────────────────────────────────────────────────
    const olm = line.match(/^\d+\.\s+(.*)/)
    if (olm) {
      if (inUl) { out.push('</ul>'); inUl = false }
      if (inTaskUl) { out.push('</ul>'); inTaskUl = false }
      if (!inOl) { out.push('<ol>'); inOl = true }
      out.push(`<li>${inline(olm[1])}</li>`)
      continue
    }

    // ── Blank line ────────────────────────────────────────────────────────
    if (!line.trim()) {
      closeList()
      continue
    }

    // ── Paragraph ─────────────────────────────────────────────────────────
    closeList()
    out.push(`<p>${inline(line)}</p>`)
  }

  closeList()
  return out.join('\n')
}

// ── Full HTML document ────────────────────────────────────────────────────────

function wrapDocument(body: string): string {
  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Plan</title>
<style>
:root { color-scheme: light; }
*, *::before, *::after { box-sizing: border-box; }
body {
  margin: 0;
  padding: 1.25rem 1.5rem 2rem;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  font-size: 12.5px;
  line-height: 1.65;
  background: #ffffff;
  color: #1d1d1f;
}
h1, h2, h3, h4, h5, h6 {
  color: #1d1d1f;
  font-weight: 600;
  margin: 1.4em 0 0.35em;
  padding-bottom: 0.25em;
  border-bottom: 1px solid #e0e0e0;
}
h1 { font-size: 1.35em; }
h2 { font-size: 1.15em; }
h3 { font-size: 1em; border-bottom: none; }
h4, h5, h6 { font-size: 0.9em; border-bottom: none; }
h1:first-child, h2:first-child, h3:first-child { margin-top: 0; }
p { margin: 0.5em 0; }
ul, ol { margin: 0.4em 0; padding-left: 1.4em; }
li { margin: 0.2em 0; }
ul.task-list { list-style: none; padding-left: 0; }
ul.task-list li {
  display: flex;
  align-items: baseline;
  gap: 0.45em;
  padding: 0.1em 0;
}
ul.task-list li input[type="checkbox"] {
  accent-color: #0066cc;
  flex-shrink: 0;
  margin: 0;
  cursor: default;
}
ul.task-list li.done span { color: #7a7a7a; text-decoration: line-through; }
code {
  background: #f5f5f7;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  padding: 0.1em 0.35em;
  font-size: 0.88em;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
pre {
  background: #f5f5f7;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  padding: 0.9em 1em;
  overflow-x: auto;
  margin: 0.75em 0;
}
pre code {
  background: none;
  border: none;
  padding: 0;
  font-size: inherit;
}
strong { color: #1d1d1f; font-weight: 600; }
em { font-style: italic; }
del { color: #7a7a7a; }
a { color: #0066cc; text-underline-offset: 2px; }
a:hover { text-decoration: none; }
hr { border: none; border-top: 1px solid #e0e0e0; margin: 1.2em 0; }
blockquote {
  border-left: 3px solid #e0e0e0;
  margin: 0.5em 0;
  padding: 0.25em 0.75em;
  color: #7a7a7a;
}
</style>
</head>
<body>
${body}
</body>
</html>`
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Read a task's PLAN.md (now living in `workspacePath` as `<worktree-dir>.PLAN.md`,
 * not inside the worktree), convert to a styled HTML document, write the
 * preserved `<title>-<createdAt>.html` into `workspacePath`, and return the HTML
 * string. Returns null when PLAN.md does not exist or is empty.
 */
export async function generatePlanHtml(
  workspacePath: string,
  worktreePath: string,
  title: string,
  createdAt: number
): Promise<string | null> {
  const planPath = agentPlanPath(workspacePath, worktreePath)
  let md: string
  try {
    md = await fs.readFile(planPath, 'utf8')
  } catch {
    return null
  }
  if (!md.trim()) return null

  const html = wrapDocument(mdToHtml(md))
  await fs.writeFile(
    path.join(workspacePath, planHtmlFileName(title, createdAt)),
    html,
    'utf8'
  )
  return html
}
