type Node = Record<string, unknown>

function record(value: unknown): Node | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Node : null
}

function children(node: Node): unknown[] {
  return Array.isArray(node.content) ? node.content : []
}

function render(node: unknown, depth = 0): string {
  if (typeof node === 'string') return node
  const item = record(node)
  if (!item) return ''
  const type = item.type
  const body = () => children(item).map((child) => render(child, depth)).join('')
  const attrs = record(item.attrs)
  if (type === 'text') {
    let value = typeof item.text === 'string' ? item.text : ''
    for (const mark of Array.isArray(item.marks) ? item.marks : []) {
      const m = record(mark)
      if (m?.type === 'strong') value = `**${value}**`
      if (m?.type === 'em') value = `*${value}*`
      if (m?.type === 'strike') value = `~~${value}~~`
      if (m?.type === 'code') value = `\`${value}\``
      if (m?.type === 'link' && typeof record(m.attrs)?.href === 'string') value = `[${value}](${record(m.attrs)?.href})`
    }
    return value
  }
  if (type === 'hardBreak') return '  \n'
  if (type === 'rule') return '\n---\n\n'
  if (type === 'mention') return `@${String(attrs?.text ?? attrs?.id ?? '')}`
  if (type === 'emoji') return String(attrs?.shortName ?? '')
  if (type === 'inlineCard' || type === 'blockCard') return `[${String(attrs?.url ?? '連結')}](${String(attrs?.url ?? '')})`
  if (type === 'media' || type === 'mediaSingle') return '[附件]'
  if (type === 'paragraph') return `${body()}\n\n`
  if (type === 'heading') return `${'#'.repeat(Math.min(6, Math.max(1, Number(attrs?.level) || 1)))} ${body()}\n\n`
  if (type === 'blockquote') return body().trim().split('\n').map((line) => `> ${line}`).join('\n') + '\n\n'
  if (type === 'codeBlock') return `\n\`\`\`${String(attrs?.language ?? '')}\n${children(item).map((child) => render(child)).join('').trimEnd()}\n\`\`\`\n\n`
  if (type === 'bulletList' || type === 'orderedList') {
    return children(item).map((child, index) => {
      const content = render(child, depth + 1).trim().replace(/\n\n/g, '\n')
      const prefix = type === 'orderedList' ? `${index + 1}. ` : '- '
      return `${'  '.repeat(depth)}${prefix}${content}\n`
    }).join('') + '\n'
  }
  if (type === 'listItem') return body()
  if (type === 'table') {
    const rows = children(item).map((row) => {
      const cells = children(record(row) ?? {}).map((cell) => render(cell).trim().replace(/\|/g, '\\|').replace(/\n+/g, ' '))
      return `| ${cells.join(' | ')} |`
    })
    if (rows.length === 0) return ''
    const width = children(record(children(item)[0]) ?? {}).length
    rows.splice(1, 0, `| ${Array(width).fill('---').join(' | ')} |`)
    return rows.join('\n') + '\n\n'
  }
  return body()
}

export function adfToMarkdown(value: unknown): string {
  return render(value).trim()
}
