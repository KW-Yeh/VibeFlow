import { useEffect, useRef } from 'react'
import type { Terminal as XTerm } from '@xterm/xterm'

import { Button } from '@/components/ui/button'
import { Sparkles } from 'lucide-react'

interface TaskTerminalProps {
  taskId: string
  /** Working directory: the task's worktree, or the project root as fallback. */
  cwd: string | null
}

export function TaskTerminal({ taskId, cwd }: TaskTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)

  useEffect(() => {
    let disposed = false
    let offData: (() => void) | undefined
    let offExit: (() => void) | undefined
    let resizeObs: ResizeObserver | undefined

    void (async () => {
      const { Terminal } = await import('@xterm/xterm')
      const { FitAddon } = await import('@xterm/addon-fit')
      if (disposed || !containerRef.current) return

      const term = new Terminal({
        fontSize: 12,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        cursorBlink: true,
        theme: { background: '#0a0a0a', foreground: '#e5e5e5' },
      })
      const fit = new FitAddon()
      term.loadAddon(fit)
      term.open(containerRef.current)
      fit.fit()
      termRef.current = term

      const api = typeof window !== 'undefined' ? window.vibeflow : undefined
      if (!api) {
        term.writeln('⚠️  Electron bridge 無法使用（僅在 app 內可開啟終端）。')
        return
      }
      if (!cwd) {
        term.writeln('⚠️  尚未設定工作目錄，請先選擇專案或建立任務。')
        return
      }

      await api.term.start(taskId, cwd)
      offData = api.term.onData(({ taskId: id, data }) => {
        if (id === taskId) term.write(data)
      })
      offExit = api.term.onExit(({ taskId: id, exitCode }) => {
        if (id === taskId) term.writeln(`\r\n[process exited: ${exitCode}]`)
      })
      term.onData((data) => api.term.input(taskId, data))

      resizeObs = new ResizeObserver(() => {
        try {
          fit.fit()
          api.term.resize(taskId, term.cols, term.rows)
        } catch {
          // ignore transient resize errors
        }
      })
      resizeObs.observe(containerRef.current)
      api.term.resize(taskId, term.cols, term.rows)
    })()

    return () => {
      disposed = true
      offData?.()
      offExit?.()
      resizeObs?.disconnect()
      window.vibeflow?.term.kill(taskId)
      termRef.current?.dispose()
      termRef.current = null
    }
  }, [taskId, cwd])

  const launchClaude = () => {
    window.vibeflow?.term.input(taskId, 'claude\r')
  }

  return (
    <div className="mt-2 overflow-hidden rounded-md bg-black">
      <div className="flex items-center justify-between bg-white/[0.06] px-2 py-1">
        <span className="min-w-0 truncate font-mono text-[10px] text-muted-foreground">
          {cwd ?? '(no cwd)'}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 shrink-0 px-2 text-[10px]"
          onClick={launchClaude}
        >
          <Sparkles className="size-3" />
          啟動 Claude
        </Button>
      </div>
      <div ref={containerRef} className="h-64 w-full overflow-hidden p-1" />
    </div>
  )
}
