export interface TerminalFileMatch {
  path: string
  /** UTF-16 offsets in the logical (possibly wrapped) terminal line. */
  start: number
  end: number
}

/** Candidate detection only; core validates existence on an explicit click. */
export function findTerminalFiles(text: string): TerminalFileMatch[] {
  const matches: TerminalFileMatch[] = []
  const tokens = /"[^"\r\n]+"|'[^'\r\n]+'|[^\s"'<>`]+/g
  for (const token of text.matchAll(tokens)) {
    let value = token[0]
    let start = token.index
    if (value.startsWith('"') || value.startsWith("'")) {
      value = value.slice(1, -1)
      start++
    } else {
      // Markdown links and surrounding prose punctuation aren't part of paths.
      const markdown = value.indexOf('](')
      if (markdown >= 0) { start += markdown + 2; value = value.slice(markdown + 2) }
      const prefix = value.match(/^[([{]+/)?.[0].length ?? 0
      start += prefix
      value = value.slice(prefix).replace(/[)\]},;.!?]+$/, '')
    }
    if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^file:\/\//i.test(value) && !/^[a-z]:[\\/]/i.test(value)) continue
    const fullLength = value.length
    value = value.replace(/:\d+(?::\d+)?$/, '')
    const explicit = /^(?:file:\/\/|\/|~[\\/]|\.{1,2}[\\/]|[a-z]:[\\/])/i.test(value)
    const filename = /^[\p{L}\p{N}_@.+-][^\s:]*\.[a-z][a-z\d]{0,15}$/iu.test(value) && !value.includes('@')
    if (!value || (!explicit && !filename)) continue
    matches.push({ path: value, start, end: start + fullLength })
  }
  return matches
}
