import { useCallback, useEffect, useRef } from 'react'
import type { Terminal as XTerm } from '@xterm/xterm'

import { Button } from '@/components/ui/button'
import { Sparkles } from 'lucide-react'

interface TaskTerminalProps {
  taskId: string
  /** Working directory: the task's worktree, or the project root as fallback. */
  cwd: string | null
  /**
   * Shell command to launch once the PTY is ready (e.g. the Claude auto-run).
   * Sent at most once per distinct `launchNonce` value.
   */
  launchCommand?: string | null
  /** Bump to request a (re-)launch of `launchCommand`. */
  launchNonce?: number
  /** Fired when the user clicks the in-terminal launch button. */
  onLaunchRequest?: () => void
  /** Launch-button label (e.g. 「啟動 Claude Code」); defaults to 啟動 Agent. */
  launchLabel?: string
  /**
   * When true (card is Done), the terminal is view-only: no PTY is started,
   * keystrokes are not forwarded, and the launch affordance is hidden. Existing
   * scrollback from the live session is preserved for review.
   */
  readOnly?: boolean
}

export function TaskTerminal({
  taskId,
  cwd,
  launchCommand,
  launchNonce = 0,
  onLaunchRequest,
  launchLabel,
  readOnly = false,
}: TaskTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)

  // PTY readiness + de-dupe of launch sends. Refs (not state) so the async
  // PTY-start flow and the nonce effect read the latest values without
  // re-running the heavy terminal-init effect.
  const readyRef = useRef(false)
  const sentNonceRef = useRef(-1)
  const launchCmdRef = useRef<string | null | undefined>(launchCommand)
  const launchNonceRef = useRef(launchNonce)
  launchCmdRef.current = launchCommand
  launchNonceRef.current = launchNonce
  // cwd / readOnly via refs so the init effect can depend on [taskId] only —
  // when a card moves to Done its cwd changes (worktree → project root); we must
  // NOT re-run init (which would dispose the buffer and spawn a fresh shell).
  const cwdRef = useRef<string | null>(cwd)
  cwdRef.current = cwd
  const readOnlyRef = useRef(readOnly)

  const maybeLaunch = useCallback(() => {
    if (!readyRef.current || readOnlyRef.current) return
    const cmd = launchCmdRef.current
    if (!cmd) return
    const nonce = launchNonceRef.current
    if (sentNonceRef.current === nonce) return
    sentNonceRef.current = nonce
    window.vibeflow?.term.input(taskId, cmd)
  }, [taskId])

  // Keep the read-only flag (and xterm's stdin gate) in sync without remounting.
  useEffect(() => {
    readOnlyRef.current = readOnly
    if (termRef.current) termRef.current.options.disableStdin = readOnly
  }, [readOnly])

  useEffect(() => {
    let disposed = false
    readyRef.current = false
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
        disableStdin: readOnlyRef.current,
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
      // A Done card mounted fresh (e.g. after reload): show a note, no PTY.
      if (readOnlyRef.current) {
        term.writeln('ℹ️  任務已完成 — 終端為唯讀，僅供查閱訊息。')
        return
      }
      const startCwd = cwdRef.current
      if (!startCwd) {
        term.writeln('⚠️  尚未設定工作目錄，請先選擇專案或建立任務。')
        return
      }

      await api.term.start(taskId, startCwd)
      offData = api.term.onData(({ taskId: id, data }) => {
        if (id === taskId) term.write(data)
      })
      offExit = api.term.onExit(({ taskId: id, exitCode }) => {
        if (id === taskId) term.writeln(`\r\n[process exited: ${exitCode}]`)
      })
      // Forward keystrokes only while the card is interactive (not Done).
      term.onData((data) => {
        if (!readOnlyRef.current) api.term.input(taskId, data)
      })

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

      // PTY is live: send any armed launch command (e.g. auto-run on expand).
      readyRef.current = true
      maybeLaunch()
    })()

    return () => {
      disposed = true
      readyRef.current = false
      offData?.()
      offExit?.()
      resizeObs?.disconnect()
      window.vibeflow?.term.kill(taskId)
      termRef.current?.dispose()
      termRef.current = null
    }
  }, [taskId, maybeLaunch])

  // Re-launch when the parent bumps the nonce while already mounted.
  useEffect(() => {
    maybeLaunch()
  }, [launchCommand, launchNonce, maybeLaunch])

  return (
    // Height is owned by the card (fixed expanded height per column): the
    // terminal fills whatever space is left after the steps/description block.
    <div className="mt-2 flex min-h-36 w-full flex-1 flex-col overflow-hidden rounded-md bg-black">
      <div className="flex shrink-0 items-center justify-between bg-white/[0.06] px-2 py-1">
        <span className="min-w-0 truncate font-mono text-[10px] text-muted-foreground">
          {cwd ?? '(no cwd)'}
        </span>
        {readOnly ? (
          <span className="shrink-0 px-2 text-[10px] uppercase tracking-wide text-muted-foreground">
            唯讀
          </span>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 px-2 text-[10px]"
            onClick={onLaunchRequest}
            disabled={!onLaunchRequest}
          >
            <Sparkles className="size-3" />
            {launchLabel ?? '啟動 Agent'}
          </Button>
        )}
      </div>
      <div
        ref={containerRef}
        className="min-h-0 w-full flex-1 overflow-hidden p-1"
      />
    </div>
  )
}
