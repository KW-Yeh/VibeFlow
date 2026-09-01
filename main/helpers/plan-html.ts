import fs from 'fs/promises'
import path from 'path'
import { agentPlanPath } from './progress'
import { renderMarkdownToHtml } from './markdown'

/**
 * Filesystem-safe name for the preserved plan.html: `<title>-<createdAt>.html`.
 * Unlike the runtime PLAN.md / progress files, this is NOT cleared when the
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

// ── Full HTML document ────────────────────────────────────────────────────────

/**
 * Wrap a rendered markdown fragment in a self-contained document.
 *
 * The CSS is inlined because this file is written to the workspace as a durable
 * record that has to open standalone, and is also shipped verbatim to the mobile
 * remote viewer. Class names here follow what remark-gfm/rehype-highlight emit —
 * `contains-task-list`, `task-list-item`, `footnotes`, `hljs-*` — so they must
 * change in step with the pipeline. The token colours mirror the renderer's
 * globals.css; change both together.
 */
function wrapDocument(body: string): string {
  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Plan</title>
<style>
:root { color-scheme: dark; }
*, *::before, *::after { box-sizing: border-box; }
body {
  margin: 0;
  padding: 1.25rem 1.5rem 2rem;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", Helvetica, Arial, sans-serif;
  font-size: 12.5px;
  line-height: 1.65;
  background: #191919;
  color: #ededed;
}
h1, h2, h3, h4, h5, h6 {
  color: #ededed;
  font-weight: 600;
  margin: 1.4em 0 0.35em;
  padding-bottom: 0.25em;
  border-bottom: 1px solid rgba(255,255,255,0.09);
}
h1 { font-size: 1.35em; }
h2 { font-size: 1.15em; }
h3 { font-size: 1em; border-bottom: none; }
h4, h5, h6 { font-size: 0.9em; border-bottom: none; }
h1:first-child, h2:first-child, h3:first-child { margin-top: 0; }
p { margin: 0.5em 0; }
ul, ol { margin: 0.4em 0; padding-left: 1.4em; }
li { margin: 0.2em 0; }
/* Nested lists sit tighter than the top level so depth reads structurally. */
li > ul, li > ol { margin: 0.2em 0; }
img { max-width: 100%; height: auto; border-radius: 5px; }
/* GFM task lists: remark-gfm marks the list "contains-task-list" and each item
   "task-list-item". Striking through completed items is not part of GFM — only
   the checkbox state is emitted — so it is expressed here off :has(). */
ul.contains-task-list { list-style: none; padding-left: 0; }
li.task-list-item {
  display: flex;
  align-items: baseline;
  gap: 0.45em;
  padding: 0.1em 0;
}
li.task-list-item input[type="checkbox"] {
  accent-color: #4c9bf5;
  flex-shrink: 0;
  margin: 0;
  cursor: default;
}
li.task-list-item:has(input[type="checkbox"]:checked) {
  color: #a1a1a1;
  text-decoration: line-through;
}
code {
  background: #212121;
  border: 1px solid rgba(255,255,255,0.09);
  border-radius: 5px;
  padding: 0.1em 0.35em;
  font-size: 0.88em;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
pre {
  background: #212121;
  border: 1px solid rgba(255,255,255,0.09);
  border-radius: 8px;
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
strong { color: #ededed; font-weight: 600; }
em { font-style: italic; }
del { color: #a1a1a1; }
a { color: #4c9bf5; text-underline-offset: 2px; }
a:hover { text-decoration: none; }
hr { border: none; border-top: 1px solid rgba(255,255,255,0.09); margin: 1.2em 0; }
blockquote {
  border-left: 3px solid rgba(255,255,255,0.09);
  margin: 0.5em 0;
  padding: 0.25em 0.75em;
  color: #a1a1a1;
}
/* Scroll wide tables instead of letting them push the page sideways. */
table {
  display: block;
  width: max-content;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
  font-size: 0.95em;
  margin: 0.75em 0;
}
th, td {
  border: 1px solid rgba(255,255,255,0.12);
  padding: 0.45em 0.65em;
  text-align: left;
  vertical-align: top;
}
th {
  background: #242424;
  color: #ededed;
  font-weight: 600;
}
tbody tr:nth-child(even) { background: rgba(255,255,255,0.025); }
/* GFM footnotes: a trailing <section class="footnotes"> whose heading carries
   Tailwind's sr-only class — not available here, so hide it explicitly. */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.footnotes {
  border-top: 1px solid rgba(255,255,255,0.09);
  margin-top: 1.75em;
  padding-top: 0.5em;
  font-size: 0.92em;
  color: #a1a1a1;
}
sup a { text-decoration: none; }
/* highlight.js tokens — palette built from the app's own accent/status colours
   so highlighted code stays inside the design system. Mirrored in
   renderer/styles/globals.css. */
.hljs-comment, .hljs-quote { color: #7f7f7f; font-style: italic; }
.hljs-keyword, .hljs-selector-tag, .hljs-literal, .hljs-section, .hljs-doctag,
.hljs-meta .hljs-keyword { color: #4c9bf5; }
.hljs-string, .hljs-regexp, .hljs-addition, .hljs-attr, .hljs-attr-value { color: #4ec98a; }
.hljs-number, .hljs-type, .hljs-built_in, .hljs-class .hljs-title,
.hljs-params { color: #e2b341; }
.hljs-title, .hljs-name, .hljs-attribute, .hljs-variable, .hljs-template-variable,
.hljs-symbol, .hljs-bullet { color: #9bd0ff; }
.hljs-deletion { color: #d43a3f; }
.hljs-meta { color: #a1a1a1; }
.hljs-emphasis { font-style: italic; }
.hljs-strong { font-weight: 600; }
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

  const html = wrapDocument(await renderMarkdownToHtml(md))
  await fs.writeFile(
    path.join(workspacePath, planHtmlFileName(title, createdAt)),
    html,
    'utf8'
  )
  return html
}
