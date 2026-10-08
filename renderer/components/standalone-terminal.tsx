import { useEffect, useRef } from 'react'
import type { Terminal as XTerm } from '@xterm/xterm'
import { standaloneTermStart, termInput, termKill, termResize } from '@/lib/api'
import { fitColumnsWithinViewport } from '@/lib/terminal-fit'
import { hideTerminalLink, openTerminalLink, showTerminalLink } from '@/lib/terminal-links'

/** A plain shell owned by the terminal grid, independent of every task run. */
export function StandaloneTerminal({
  sessionKey,
  projectPath,
  taskId,
}: {
  sessionKey: string
  projectPath: string
  taskId?: string
}) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let disposed = false
    let term: XTerm | null = null
    let offData: (() => void) | undefined
    let offExit: (() => void) | undefined
    let observer: ResizeObserver | undefined
    let resizeTimer: ReturnType<typeof setTimeout> | undefined
    let started = false

    void (async () => {
      const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
        import('@xterm/addon-web-links'),
      ])
      if (disposed || !hostRef.current) return
      const instance = new Terminal({
        fontSize: 12,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        cursorBlink: true,
        theme: { background: '#191919', foreground: '#e6e6e6', cursor: '#4c9bf5' },
        linkHandler: {
          activate: (_event, uri) => openTerminalLink(uri),
          hover: (_event, uri) => showTerminalLink(instance, uri),
          leave: () => hideTerminalLink(instance),
        },
      })
      term = instance
      const fit = new FitAddon()
      instance.loadAddon(fit)
      instance.loadAddon(new WebLinksAddon((_event, uri) => openTerminalLink(uri), {
        hover: (_event, uri) => showTerminalLink(instance, uri),
        leave: () => hideTerminalLink(instance),
      }))
      instance.open(hostRef.current)

      const fitTerminal = () => {
        if (!hostRef.current || hostRef.current.clientWidth === 0 || hostRef.current.clientHeight === 0) return
        fit.fit()
        const screen = instance.element?.querySelector<HTMLElement>('.xterm-screen')
        const viewport = instance.element?.querySelector<HTMLElement>('.xterm-viewport')
        if (screen && viewport) {
          const cols = fitColumnsWithinViewport(
            instance.cols,
            screen.getBoundingClientRect().width,
            viewport.clientWidth
          )
          if (cols !== instance.cols) instance.resize(cols, instance.rows)
        }
      }
      await document.fonts.ready
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      if (disposed) return
      fitTerminal()

      const api = window.vibeflow
      if (!api) {
        instance.writeln('⚠️  未連線到 VibeFlow core，無法開啟終端。')
        return
      }
      offData = api.term.onData(({ sessionKey: id, data }) => {
        if (id === sessionKey) instance.write(data)
      })
      offExit = api.term.onExit(({ sessionKey: id, exitCode, intentional }) => {
        if (id === sessionKey && !intentional) instance.writeln(`\r\nℹ️  終端已結束（exit code: ${exitCode}）`)
      })
      try {
        const result = await standaloneTermStart({
          sessionKey,
          ...(taskId ? { taskId } : { projectPath }),
          cols: instance.cols,
          rows: instance.rows,
        })
        if (!result) throw new Error('未連線到 VibeFlow core')
        started = true
        if (disposed) {
          termKill(sessionKey)
          return
        }
        if (result.scrollback) instance.write(result.scrollback)
        instance.onData((data) => termInput(sessionKey, data))
        instance.focus()
      } catch (error) {
        if (!disposed) instance.writeln(`⚠️  無法開啟終端：${error instanceof Error ? error.message : String(error)}`)
      }
      observer = new ResizeObserver(() => {
        clearTimeout(resizeTimer)
        resizeTimer = setTimeout(() => {
          if (disposed) return
          const cols = instance.cols
          const rows = instance.rows
          fitTerminal()
          if (cols !== instance.cols || rows !== instance.rows) {
            termResize(sessionKey, instance.cols, instance.rows)
          }
        }, 100)
      })
      if (hostRef.current) observer.observe(hostRef.current)
    })()

    return () => {
      disposed = true
      offData?.()
      offExit?.()
      observer?.disconnect()
      clearTimeout(resizeTimer)
      if (started) termKill(sessionKey)
      term?.dispose()
    }
  }, [sessionKey, projectPath, taskId])

  return <div ref={hostRef} className="min-h-0 min-w-0 flex-1 overflow-hidden p-2" aria-label={`終端機：${projectPath}`} />
}
