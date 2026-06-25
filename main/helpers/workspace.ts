import { mkdir, readFile, stat, writeFile } from 'fs/promises'
import { basename, dirname, join } from 'path'

/** Agent-read/write knowledge file. The .html sibling is a rendered view of this. */
export const CONTEXT_MD = 'context.md'
export const CONTEXT_HTML = 'context.html'

export interface WorkspaceScan {
  folderExists: boolean
  hasContextFile: boolean
}

/** Lowercase + spaces→underscores. Leaves other characters untouched. */
export function slugifyProjectName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '_')
}

/** Sibling workspace folder for a project: `<parent>/<slug>-workspace`. */
export function defaultWorkspacePath(projectPath: string): string {
  return join(dirname(projectPath), `${slugifyProjectName(basename(projectPath))}-workspace`)
}

export async function scanWorkspace(folderPath: string): Promise<WorkspaceScan> {
  let folderExists = false
  try {
    folderExists = (await stat(folderPath)).isDirectory()
  } catch {
    return { folderExists: false, hasContextFile: false }
  }
  let hasContextFile = false
  try {
    await stat(join(folderPath, CONTEXT_MD))
    hasContextFile = true
  } catch {
    hasContextFile = false
  }
  return { folderExists, hasContextFile }
}

function contextMdTemplate(name: string): string {
  return `# Workspace: ${name}

此文件是 VibeFlow 為此 workspace 維護的長期知識目錄（由 agent 讀寫）。
請在此補充背景說明、重要慣例、決策與檔案結構摘要，未來其他任務會先讀取此文件。
\`context.html\` 是本檔的渲染檢視，由系統自動產生，請勿手動編輯。

## 背景說明

（待補充）

## 重要慣例

（待補充）
`
}

/**
 * Ensure both context files exist in `folderPath`. Creates the folder and a
 * `context.md` template if missing, then (re)renders `context.html` from the md.
 */
export async function ensureContextFiles(folderPath: string): Promise<void> {
  await mkdir(folderPath, { recursive: true })
  const mdPath = join(folderPath, CONTEXT_MD)
  let md: string
  try {
    md = await readFile(mdPath, 'utf-8')
  } catch {
    md = contextMdTemplate(basename(folderPath))
    await writeFile(mdPath, md, 'utf-8')
  }
  await writeFile(join(folderPath, CONTEXT_HTML), renderContextHtml(md, basename(folderPath)), 'utf-8')
}

/** Re-render `context.html` from the current `context.md`. No-op when md is absent. */
export async function regenerateContextHtml(folderPath: string): Promise<void> {
  let md: string
  try {
    md = await readFile(join(folderPath, CONTEXT_MD), 'utf-8')
  } catch {
    return
  }
  await writeFile(join(folderPath, CONTEXT_HTML), renderContextHtml(md, basename(folderPath)), 'utf-8')
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function renderInline(s: string): string {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
}

// ponytail: minimal block-level markdown — headings, fenced code, lists, paragraphs.
// Enough for the template + typical agent notes; swap for a md lib only if richer output is needed.
function mdToHtml(md: string): string {
  const lines = md.split('\n')
  const out: string[] = []
  let list: 'ul' | 'ol' | null = null
  const closeList = () => {
    if (list) { out.push(`</${list}>`); list = null }
  }
  for (let i = 0; i < lines.length; ) {
    const line = lines[i]
    if (/^```/.test(line)) {
      closeList()
      const buf: string[] = []
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) buf.push(lines[i])
      i++ // skip closing fence
      out.push(`<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>`)
      continue
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      closeList()
      out.push(`<h${heading[1].length}>${renderInline(heading[2])}</h${heading[1].length}>`)
      i++; continue
    }
    const ul = line.match(/^\s*[-*]\s+(.*)$/)
    if (ul) {
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul' }
      out.push(`<li>${renderInline(ul[1])}</li>`)
      i++; continue
    }
    const ol = line.match(/^\s*\d+\.\s+(.*)$/)
    if (ol) {
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol' }
      out.push(`<li>${renderInline(ol[1])}</li>`)
      i++; continue
    }
    if (line.trim() === '') { closeList(); i++; continue }
    closeList()
    out.push(`<p>${renderInline(line)}</p>`)
    i++
  }
  closeList()
  return out.join('\n')
}

export function renderContextHtml(md: string, name: string): string {
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<title>Workspace: ${escapeHtml(name)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, sans-serif; font-size: 14px; line-height: 1.65; padding: 1.25rem 2rem; color: #cdd6f4; background: #1e1e2e; }
  h1, h2, h3, h4, h5, h6 { color: #89b4fa; }
  h1 { font-size: 1.4rem; }
  h2 { font-size: 1.15rem; border-bottom: 1px solid #313244; padding-bottom: 0.25rem; }
  code { background: #313244; border-radius: 4px; padding: 0.1em 0.35em; font-family: ui-monospace, Menlo, Monaco, monospace; font-size: 0.88em; }
  pre { background: #11111b; border-radius: 6px; padding: 0.9em 1em; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  a { color: #89dceb; }
  ul, ol { padding-left: 1.4em; }
</style>
</head>
<body>
${mdToHtml(md)}
</body>
</html>`
}
