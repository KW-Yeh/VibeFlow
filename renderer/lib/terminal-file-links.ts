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

export interface TerminalTextPosition {
  line: number
  /** UTF-16 offset within that logical line. */
  offset: number
}

export interface TerminalSpanCandidate {
  path: string
  start: TerminalTextPosition
  /** Exclusive. */
  end: TerminalTextPosition
}

const PATH_START = /(?<=^|[\s"'`(<[])(?:file:\/\/|~[\\/]|\.{1,2}[\\/]|[a-z]:[\\/]|\/(?!\/)|[\p{L}\p{N}_@.+-]+[\\/])/giu
const WORD_END = /[\s"'`<>]/
const MAX_WORDS = 12
const MAX_LINE_BREAKS = 3
const MAX_PATH_LENGTH = 1024

/**
 * Paths an agent printed unquoted with spaces, or that its own renderer broke
 * onto the next line (hard newline plus indentation, which xterm doesn't mark as
 * wrapped). Every join is ambiguous, so these are only guesses: a caller must
 * keep just the ones that exist, see pickSpanningFiles.
 */
export function spanningFileCandidates(lines: string[]): TerminalSpanCandidate[] {
  const seen = new Set<string>()
  const out: TerminalSpanCandidate[] = []
  const walk = (start: TerminalTextPosition, line: number, from: number, prefix: string, words: number, breaks: number) => {
    const text = lines[line]
    let to = from
    while (to < text.length && !WORD_END.test(text[to])) to++
    const raw = prefix + text.slice(from, to)
    if (to > from && (breaks > 0 || prefix.includes(' '))) {
      const trimmed = raw.replace(/[)\]},;.!?]+$/, '')
      const path = trimmed.replace(/:\d+(?::\d+)?$/, '')
      const key = `${start.line}:${start.offset}:${path}`
      if (path && !seen.has(key)) {
        seen.add(key)
        out.push({ path, start, end: { line, offset: to - (raw.length - trimmed.length) } })
      }
    }
    if (++words >= MAX_WORDS || raw.length >= MAX_PATH_LENGTH) return
    if (to < text.length) {
      if (text[to] === ' ' && to + 1 < text.length && !WORD_END.test(text[to + 1])) walk(start, line, to + 1, `${raw} `, words, breaks)
      return
    }
    if (breaks >= MAX_LINE_BREAKS || line + 1 >= lines.length) return
    const indent = lines[line + 1].match(/^\s*/)![0].length
    if (indent >= lines[line + 1].length) return
    walk(start, line + 1, indent, raw, words, breaks + 1)
    walk(start, line + 1, indent, `${raw} `, words, breaks + 1)
  }
  lines.forEach((text, line) => {
    for (const match of text.matchAll(PATH_START)) {
      walk({ line, offset: match.index }, line, match.index, '', 0, 0)
    }
  })
  return out
}

const before = (a: TerminalTextPosition, b: TerminalTextPosition) => a.line < b.line || (a.line === b.line && a.offset < b.offset)

/** The longest existing candidate wins wherever candidates overlap. */
export function pickSpanningFiles(candidates: TerminalSpanCandidate[], existing: Iterable<string>): TerminalSpanCandidate[] {
  const found = new Set(existing)
  const size = (c: TerminalSpanCandidate) => c.path.length
  const picked: TerminalSpanCandidate[] = []
  for (const candidate of candidates.filter((c) => found.has(c.path)).sort((a, b) => size(b) - size(a))) {
    if (picked.every((p) => !before(candidate.start, p.end) || !before(p.start, candidate.end))) picked.push(candidate)
  }
  return picked
}
