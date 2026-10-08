import type { Terminal } from '@xterm/xterm'

export function openTerminalLink(uri: string): void {
  try {
    const url = new URL(uri)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return
    window.open(url.href, '_blank', 'noopener,noreferrer')
  } catch {
    // Terminal output can contain arbitrary text, including malformed URLs.
  }
}

export function showTerminalLink(term: Terminal, uri: string): void {
  if (term.element) term.element.title = uri
}

export function hideTerminalLink(term: Terminal): void {
  term.element?.removeAttribute('title')
}
