import type { ILink, Terminal } from '@xterm/xterm'
import { existingTerminalFiles } from '@/lib/api'
import { findTerminalFiles, pickSpanningFiles, spanningFileCandidates } from './terminal-file-links'

export function openTerminalLink(uri: string, onFile?: (path: string) => void): void {
  try {
    const url = new URL(uri)
    if (url.protocol === 'file:') { onFile?.(uri); return }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return
    window.open(url.href, '_blank', 'noopener,noreferrer')
  } catch {
    // Terminal output can contain arbitrary text, including malformed URLs.
  }
}

type Cell = { x: number; y: number }
interface LogicalLine { first: number; last: number; text: string; starts: Cell[]; ends: Cell[] }

/** Join the rows xterm soft-wrapped into one line, keeping each character's cell. */
function readLogicalLine(term: Terminal, row: number): LogicalLine {
  const buffer = term.buffer.active
  let first = row
  let last = row
  while (first > 0 && buffer.getLine(first)?.isWrapped) first--
  while (last + 1 < buffer.length && buffer.getLine(last + 1)?.isWrapped) last++
  let text = ''
  const starts: Cell[] = []
  const ends: Cell[] = []
  for (let y = first; y <= last; y++) {
    const line = buffer.getLine(y)
    if (!line) continue
    for (let x = 0; x < line.length; x++) {
      const cell = line.getCell(x)
      if (!cell || cell.getWidth() === 0) continue
      const chars = cell.getChars() || ' '
      text += chars
      for (let i = 0; i < chars.length; i++) {
        starts.push({ x: x + 1, y: y + 1 })
        ends.push({ x: x + Math.max(1, cell.getWidth()), y: y + 1 })
      }
    }
  }
  return { first, last, text: text.trimEnd(), starts, ends }
}

/** Lines around the hovered one, so a path broken across agent-inserted newlines is seen whole. */
const CONTEXT_LINES = 3

/** Register once per terminal. */
export function registerTerminalFiles(term: Terminal, sessionKey: string, onFile: (path: string) => void) {
  const link = (path: string, start: Cell, end: Cell): ILink => ({
    text: path,
    range: { start, end },
    activate: () => onFile(path),
    hover: () => showTerminalLink(term, path),
    leave: () => hideTerminalLink(term),
  })
  return term.registerLinkProvider({
    provideLinks(lineNumber, callback) {
      const buffer = term.buffer.active
      const current = readLogicalLine(term, lineNumber - 1)
      const lines = [current]
      while (lines.length <= CONTEXT_LINES && lines[0].first > 0) lines.unshift(readLogicalLine(term, lines[0].first - 1))
      const index = lines.length - 1
      while (lines.length <= index + CONTEXT_LINES && lines[lines.length - 1].last + 1 < buffer.length) {
        lines.push(readLogicalLine(term, lines[lines.length - 1].last + 1))
      }
      const single = findTerminalFiles(current.text)
      const candidates = spanningFileCandidates(lines.map((line) => line.text))
        .filter((c) => c.start.line <= index && c.end.line >= index)
      const singleLinks = () => single.map((m) => link(m.path, current.starts[m.start], current.ends[m.end - 1]))
      if (!candidates.length) { callback(singleLinks()); return }
      void existingTerminalFiles(sessionKey, [...new Set(candidates.map((c) => c.path))]).then((existing) => {
        const spanning = pickSpanningFiles(candidates, existing ?? [])
        const covered = (offset: number) => spanning.some((c) =>
          (c.start.line < index || c.start.offset <= offset) && (c.end.line > index || offset < c.end.offset))
        callback([
          ...spanning.map((c) => link(c.path, lines[c.start.line].starts[c.start.offset], lines[c.end.line].ends[c.end.offset - 1])),
          ...singleLinks().filter((_, i) => !covered(single[i].start) && !covered(single[i].end - 1)),
        ])
      }, () => callback(singleLinks()))
    },
  })
}

export function showTerminalLink(term: Terminal, uri: string): void {
  if (term.element) term.element.title = uri
}

export function hideTerminalLink(term: Terminal): void {
  term.element?.removeAttribute('title')
}
