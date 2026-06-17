import { readdir, stat, writeFile } from 'fs/promises'
import { basename, join } from 'path'

export const CONTEXT_FILE = 'context.html'

// Folders to skip when building the directory tree
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.vibeflow', 'dist', 'build', '.next',
  'out', 'coverage', '.cache', '__pycache__', '.venv', 'venv',
])

export interface WorkspaceScan {
  folderExists: boolean
  hasContextFile: boolean
}

export async function scanWorkspace(folderPath: string): Promise<WorkspaceScan> {
  let folderExists = false
  let hasContextFile = false
  try {
    const s = await stat(folderPath)
    folderExists = s.isDirectory()
  } catch {
    return { folderExists: false, hasContextFile: false }
  }
  if (folderExists) {
    try {
      await stat(join(folderPath, CONTEXT_FILE))
      hasContextFile = true
    } catch {
      hasContextFile = false
    }
  }
  return { folderExists, hasContextFile }
}

interface TreeNode {
  name: string
  isDir: boolean
  children?: TreeNode[]
}

async function buildTree(dirPath: string, depth: number): Promise<TreeNode[]> {
  if (depth <= 0) return []
  let entries: string[]
  try {
    entries = await readdir(dirPath)
  } catch {
    return []
  }
  const nodes: TreeNode[] = []
  for (const name of entries.sort()) {
    if (name.startsWith('.') && name !== '.env.example') continue
    const fullPath = join(dirPath, name)
    try {
      const s = await stat(fullPath)
      if (s.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue
        const children = await buildTree(fullPath, depth - 1)
        nodes.push({ name, isDir: true, children })
      } else {
        nodes.push({ name, isDir: false })
      }
    } catch {
      // skip unreadable entries
    }
  }
  return nodes
}

function renderTree(nodes: TreeNode[], indent = 0): string {
  return nodes
    .map((n) => {
      const pad = '  '.repeat(indent)
      if (n.isDir) {
        const sub = n.children?.length ? '\n' + renderTree(n.children, indent + 1) : ''
        return `${pad}<li class="dir">${escapeHtml(n.name)}/${sub ? `<ul>${sub}</ul>` : ''}</li>`
      }
      return `${pad}<li class="file">${escapeHtml(n.name)}</li>`
    })
    .join('\n')
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export async function generateContextHtml(folderPath: string): Promise<void> {
  const name = basename(folderPath)
  const tree = await buildTree(folderPath, 3)
  const treeHtml = tree.length ? `<ul>${renderTree(tree)}</ul>` : '<p>(空資料夾)</p>'

  const html = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<title>Workspace: ${escapeHtml(name)}</title>
<style>
  body { font-family: monospace; font-size: 14px; padding: 1rem 2rem; color: #cdd6f4; background: #1e1e2e; }
  h1 { font-size: 1.2rem; margin-bottom: 0.25rem; }
  .meta { color: #6c7086; font-size: 12px; margin-bottom: 1.5rem; }
  ul { list-style: none; padding-left: 1.2rem; margin: 0; }
  li.dir { color: #89b4fa; }
  li.file { color: #cdd6f4; }
  li.dir::before { content: "📁 "; }
  li.file::before { content: "📄 "; }
  section { margin-top: 1.5rem; }
  h2 { font-size: 1rem; color: #a6e3a1; border-bottom: 1px solid #313244; padding-bottom: 0.25rem; }
</style>
</head>
<body>
<h1>Workspace: ${escapeHtml(name)}</h1>
<p class="meta">路徑：${escapeHtml(folderPath)}</p>

<section>
<h2>目錄結構</h2>
${treeHtml}
</section>

<section>
<h2>說明</h2>
<p>此文件由 VibeFlow 自動生成，作為 Agent 的知識目錄。
請在此處補充關於此 Workspace 的背景說明、重要慣例與常用資源，Agent 在執行任務前會讀取此文件。</p>
</section>
</body>
</html>`

  await writeFile(join(folderPath, CONTEXT_FILE), html, 'utf-8')
}
