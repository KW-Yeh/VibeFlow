import { useEffect, useRef } from 'react'
import type { Terminal as XTerm } from '@xterm/xterm'
import { inputJiraAuthLogin } from '@/lib/api'
import { hideTerminalLink, openTerminalLink, showTerminalLink } from '@/lib/terminal-links'

export function JiraAuthTerminal({ output, active }: { output: string; active: boolean }) {
  const container = useRef<HTMLDivElement>(null)
  const terminal = useRef<XTerm | null>(null)
  const written = useRef('')
  const activeRef = useRef(active)
  const outputRef = useRef(output)
  activeRef.current = active
  outputRef.current = output

  useEffect(() => {
    let disposed = false
    let resize: ResizeObserver | null = null
    let current: XTerm | null = null
    void Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit'), import('@xterm/addon-web-links')]).then(([{ Terminal }, { FitAddon }, { WebLinksAddon }]) => {
      if (disposed || !container.current) return
      const term = new Terminal({
        convertEol: true,
        cursorBlink: true,
        fontSize: 12,
        rows: 12,
        theme: { background: '#111827' },
        linkHandler: {
          activate: (_event, uri) => openTerminalLink(uri),
          hover: (_event, uri) => showTerminalLink(term, uri),
          leave: () => hideTerminalLink(term),
        },
      })
      const fit = new FitAddon()
      term.loadAddon(fit)
      term.loadAddon(new WebLinksAddon((_event, uri) => openTerminalLink(uri), {
        hover: (_event, uri) => showTerminalLink(term, uri),
        leave: () => hideTerminalLink(term),
      }))
      term.open(container.current)
      fit.fit()
      resize = new ResizeObserver(() => fit.fit())
      resize.observe(container.current)
      term.onData((data) => { if (activeRef.current) void inputJiraAuthLogin(data) })
      current = term
      terminal.current = term
      written.current = ''
      if (outputRef.current) { term.write(outputRef.current); written.current = outputRef.current }
    })
    return () => {
      disposed = true
      resize?.disconnect()
      current?.dispose()
      terminal.current = null
    }
  }, [])

  useEffect(() => {
    const term = terminal.current
    if (!term) return
    if (!output.startsWith(written.current)) {
      term.reset()
      written.current = ''
    }
    const next = output.slice(written.current.length)
    if (next) term.write(next)
    written.current = output
  }, [output])

  return <div ref={container} className="h-48 w-full overflow-hidden rounded-sm border border-border bg-[#111827] p-1" tabIndex={0} aria-label="Atlassian CLI 登入終端" />
}
