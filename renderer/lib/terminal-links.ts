import type { Terminal } from '@xterm/xterm'
import { findTerminalFiles } from './terminal-file-links'

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

/** Register once per terminal. Read the logical line across xterm wrap boundaries. */
export function registerTerminalFiles(term: Terminal, onFile: (path: string) => void) {
  return term.registerLinkProvider({
    provideLinks(lineNumber, callback) {
      const buffer = term.buffer.active
      let first = lineNumber - 1
      let last = first
      while (first > 0 && buffer.getLine(first)?.isWrapped) first--
      while (last + 1 < buffer.length && buffer.getLine(last + 1)?.isWrapped) last++
      let text = ''
      const starts: { x: number; y: number }[] = []
      const ends: { x: number; y: number }[] = []
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
      callback(findTerminalFiles(text).map((match) => ({
        text: match.path,
        range: { start: starts[match.start], end: ends[match.end - 1] },
        activate: () => onFile(match.path),
        hover: () => showTerminalLink(term, match.path),
        leave: () => hideTerminalLink(term),
      })))
    },
  })
}

export function showTerminalLink(term: Terminal, uri: string): void {
  if (term.element) term.element.title = uri
}

export function hideTerminalLink(term: Terminal): void {
  term.element?.removeAttribute('title')
}
