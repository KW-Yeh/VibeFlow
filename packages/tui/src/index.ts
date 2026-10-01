import { spawnSync } from 'child_process'
import path from 'path'
import React, { useEffect, useState } from 'react'
import { Box, Text, render, useApp, useInput, useStdout } from 'ink'
import type { VibeFlowApi } from '../../core/src/client'
import type { BoardState, ColumnId, Task } from '../../core/src/store'
import { TMUX_SOCKET } from '../../core/src/tmux-backend'

const h = React.createElement

const COLUMNS: ColumnId[] = ['backlog', 'in_progress', 'done']
const COLUMN_TITLES: Record<ColumnId, string> = {
  backlog: 'Backlog',
  in_progress: 'In Progress',
  done: 'Done',
}

/** Ctrl+] leaves a pty passthrough, as in telnet. */
export const DETACH_KEY = '\x1d'

/**
 * Where Ctrl+] is in a chunk of terminal input, or -1. Besides the plain byte
 * this matches its win32-input-mode encoding, `ESC [ Vk;Sc;29;1;Cs;Rc _`
 * (key down, character 0x1d). A Windows console switches to that encoding
 * when a ConPTY session it shows asks for it, which ours does.
 */
export function findDetachKey(text: string): number {
  const plain = text.indexOf(DETACH_KEY)
  const m = /\x1b\[\d+;\d+;29;1;\d+;\d+_/.exec(text)
  if (plain < 0) return m ? m.index : -1
  return m ? Math.min(plain, m.index) : plain
}

/**
 * Terminal modes a passthrough session may have switched on (win32 input,
 * focus reports, bracketed paste, mouse, alternate screen, hidden cursor),
 * turned back off before the board draws again.
 */
export const RESET_TERMINAL_MODES =
  '\x1b[?9001l\x1b[?1004l\x1b[?2004l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1049l\x1b[?25h'

/** Clear the screen before the board draws again, so nothing of the diff or terminal is left above it. */
export const CLEAR_SCREEN = '\x1b[2J\x1b[H'

/** What `q` does here, as the help page says it. */
export function quitHelp(backend: 'pty' | 'tmux', isHost: boolean): string {
  if (backend === 'tmux') return 'q         離開（agent 在 tmux 中會繼續執行）'
  if (isHost) return 'q         離開（這個 TUI 就是 host，執行中的 agent 會一起結束）'
  return 'q         離開（agent 由執行中的 host 持有，會繼續執行）'
}

/**
 * Environment for the diff pager. Git runs less as `LESS=FRX` when LESS is
 * unset, which quits at once on a one-screen diff and returns to the board
 * before it can be read; plain `R` keeps less open until `q`.
 */
export function diffEnv(base: NodeJS.ProcessEnv, hasDelta: boolean): NodeJS.ProcessEnv {
  const env = { ...base }
  if (hasDelta) env.GIT_PAGER = 'delta --side-by-side --paging=always'
  else if (env.LESS === undefined) env.LESS = 'R'
  return env
}

export interface TuiOptions {
  api: VibeFlowApi
  /** Where TmuxBackend keeps its config (`<dir>/tmux.conf`). */
  userDataDir: string
  /** Open the Web UI in a browser (`w`). */
  openWeb?: () => void
  /** True when this process is the host: quitting ends pty-backed agents. */
  isHost: boolean
}

export type TuiAction =
  | { type: 'quit' }
  | { type: 'attach'; task: Task }
  | { type: 'diff'; task: Task }

export interface Selection {
  column: number
  index: number
}

/** Selection after the board changed under it: same column, index clamped. */
export function clampSelection(board: BoardState, sel: Selection): Selection {
  const column = Math.max(0, Math.min(COLUMNS.length - 1, sel.column))
  const size = board[COLUMNS[column]].length
  return { column, index: size === 0 ? 0 : Math.max(0, Math.min(size - 1, sel.index)) }
}

/**
 * Move a card one column. Returns the new board plus what core must do for
 * the move to mean what it means in the Web UI: starting a Backlog card
 * launches its agent, finishing cleans the worktree up, and sending a running
 * card back wipes its run.
 */
export function moveCard(
  board: BoardState,
  sel: Selection,
  direction: -1 | 1,
  now = Date.now()
): { board: BoardState; task: Task; to: ColumnId; effect: 'launch' | 'cleanup' | 'reset' | null } | null {
  const from = COLUMNS[sel.column]
  const to = COLUMNS[sel.column + direction]
  const task = board[from][sel.index]
  if (!to || !task) return null
  const moved = from === 'backlog' && to === 'in_progress' ? { ...task, launchedAt: now } : task
  const next: BoardState = {
    backlog: board.backlog.filter((t) => t.id !== task.id),
    in_progress: board.in_progress.filter((t) => t.id !== task.id),
    done: board.done.filter((t) => t.id !== task.id),
  }
  next[to] = [moved, ...next[to]]
  const effect =
    from === 'backlog' && to === 'in_progress'
      ? 'launch'
      : to === 'done'
        ? 'cleanup'
        : from === 'in_progress' && to === 'backlog'
          ? 'reset'
          : null
  return { board: next, task: moved, to, effect }
}

function truncate(text: string, width: number): string {
  if (width <= 1) return ''
  return text.length > width ? `${text.slice(0, width - 1)}…` : text
}

interface BoardViewProps {
  opts: TuiOptions
  initial: Selection
  initialMessage?: string
  onAction: (action: TuiAction, sel: Selection) => void
}

function BoardView({ opts, initial, initialMessage, onAction }: BoardViewProps) {
  const { api } = opts
  const { exit } = useApp()
  const { stdout } = useStdout()
  const [board, setBoard] = useState<BoardState | null>(null)
  const [sel, setSel] = useState<Selection>(initial)
  const [running, setRunning] = useState<Set<string>>(new Set())
  const [backend, setBackend] = useState<'pty' | 'tmux'>('pty')
  const [message, setMessage] = useState(initialMessage ?? '')
  const [confirm, setConfirm] = useState<{ prompt: string; run: () => void } | null>(null)
  const [help, setHelp] = useState(false)

  useEffect(() => {
    let alive = true
    void api.getState().then((s) => alive && setBoard(s.board))
    const off = api.onStateChanged((s) => setBoard(s.board))
    const poll = async () => {
      try {
        const info = await api.term.list()
        if (!alive) return
        setBackend(info.backend)
        setRunning(new Set(info.sessions.map((k) => k.split(':')[0])))
      } catch {
        // host restarting; next tick retries
      }
    }
    void poll()
    const timer = setInterval(poll, 3000)
    return () => {
      alive = false
      off()
      clearInterval(timer)
    }
  }, [api])

  useEffect(() => {
    if (board) setSel((s) => clampSelection(board, s))
  }, [board])

  const selected = board ? board[COLUMNS[sel.column]][sel.index] : undefined

  const leave = (action: TuiAction) => {
    onAction(action, sel)
    exit()
  }

  const applyMove = async (direction: -1 | 1) => {
    if (!board) return
    const move = moveCard(board, sel, direction)
    if (!move) return
    const doMove = async () => {
      try {
        if (move.effect === 'reset') {
          // Same as the Web UI: wipe the run, then put the card at the head of Backlog.
          const { state, task } = await api.resetTaskRun(move.task.id)
          const b = state.board
          const without = (list: Task[]) => list.filter((t) => t.id !== task.id)
          const next = { backlog: [task, ...without(b.backlog)], in_progress: without(b.in_progress), done: without(b.done) }
          setBoard((await api.setBoard(next)).board)
        } else {
          setBoard((await api.setBoard(move.board)).board)
        }
        setSel({ column: sel.column + direction, index: 0 })
        if (move.effect === 'launch') {
          await api.term.start({ taskId: move.task.id, launch: {} })
          setMessage(`已啟動「${move.task.title}」的 agent。Enter 可進入終端。`)
        } else if (move.effect === 'cleanup') {
          setBoard((await api.cleanupTask(move.task.id)).board)
          setMessage(`「${move.task.title}」已完成，worktree 與分支已清理。`)
        }
      } catch (err) {
        setMessage(`失敗：${(err as Error).message}`)
      }
    }
    if (move.effect === 'cleanup') {
      setConfirm({ prompt: `完成「${move.task.title}」？會移除 worktree 與本機分支（y/n）`, run: doMove })
    } else if (move.effect === 'reset') {
      setConfirm({ prompt: `退回 Backlog 會丟棄這次執行的所有變更，確定？（y/n）`, run: doMove })
    } else {
      await doMove()
    }
  }

  useInput((input, key) => {
    if (confirm) {
      const c = confirm
      setConfirm(null)
      if (input === 'y' || input === 'Y') void c.run()
      else setMessage('已取消')
      return
    }
    if (help) {
      setHelp(false)
      return
    }
    if (!board) return
    setMessage('')
    if (input === 'q' || (key.ctrl && input === 'c')) {
      if (opts.isHost && backend === 'pty' && running.size > 0) {
        setConfirm({
          prompt: `有 ${running.size} 個 agent 執行中；沒有 tmux 時離開會一併結束它們，確定？（y/n）`,
          run: () => leave({ type: 'quit' }),
        })
        return
      }
      leave({ type: 'quit' })
      return
    }
    if (input === '?') return setHelp(true)
    if (input === 'h' || key.leftArrow) return setSel((s) => clampSelection(board, { column: s.column - 1, index: s.index }))
    if (input === 'l' || key.rightArrow) return setSel((s) => clampSelection(board, { column: s.column + 1, index: s.index }))
    if (input === 'k' || key.upArrow) return setSel((s) => clampSelection(board, { ...s, index: s.index - 1 }))
    if (input === 'j' || key.downArrow) return setSel((s) => clampSelection(board, { ...s, index: s.index + 1 }))
    if (input === 'H') return void applyMove(-1)
    if (input === 'L') return void applyMove(1)
    if (input === 'w') {
      if (opts.openWeb) {
        opts.openWeb()
        setMessage('已在瀏覽器開啟 Web UI')
      }
      return
    }
    if (!selected) return
    if (key.return) {
      if (!selected.worktreePath && !selected.projectPath) return setMessage('這張卡沒有工作目錄')
      if (COLUMNS[sel.column] === 'done') return setMessage('已完成的卡片沒有終端')
      return leave({ type: 'attach', task: selected })
    }
    if (input === 'd') {
      if (!selected.worktreePath) return setMessage('這張卡已沒有 worktree，無法看 diff')
      return leave({ type: 'diff', task: selected })
    }
  })

  const width = stdout.columns || 100
  const colWidth = Math.max(20, Math.floor(width / 3) - 1)

  if (!board) return h(Text, null, '讀取看板中…')

  if (help) {
    return h(
      Box,
      { flexDirection: 'column', borderStyle: 'round', paddingX: 1 },
      h(Text, { bold: true }, 'VibeFlow TUI'),
      h(Text, null, 'h/l ←/→   切換欄'),
      h(Text, null, 'j/k ↑/↓   選擇卡片'),
      h(Text, null, 'H/L       移動卡片（Backlog→In Progress 會啟動 agent；→Done 會清理 worktree）'),
      h(Text, null, 'Enter     進入卡片的終端'),
      h(
        Text,
        null,
        backend === 'tmux'
          ? '          tmux：Ctrl+b d 回到看板（在 tmux 裡執行時按 Ctrl+b Ctrl+b d）'
          : '          Ctrl+] 回到看板'
      ),
      h(Text, null, 'd         看 diff（有 delta 時為 side-by-side）'),
      h(Text, null, 'w         在瀏覽器開啟 Web UI'),
      h(Text, null, quitHelp(backend, opts.isHost)),
      h(Text, { dimColor: true }, '按任意鍵返回')
    )
  }

  const columns = COLUMNS.map((col, ci) => {
    const tasks = board[col]
    const active = ci === sel.column
    return h(
      Box,
      {
        key: col,
        flexDirection: 'column',
        width: colWidth,
        borderStyle: 'round',
        borderColor: active ? 'cyan' : 'gray',
        paddingX: 1,
      },
      h(Text, { bold: true, color: active ? 'cyan' : undefined }, `${COLUMN_TITLES[col]} (${tasks.length})`),
      ...(tasks.length === 0
        ? [h(Text, { key: 'empty', dimColor: true }, '—')]
        : tasks.map((t, ti) => {
            const isSel = active && ti === sel.index
            const mark = running.has(t.id) ? '● ' : '  '
            return h(
              Box,
              { key: t.id, flexDirection: 'column' },
              h(Text, { inverse: isSel, color: running.has(t.id) ? 'green' : undefined }, truncate(`${mark}${t.title}`, colWidth - 4)),
              isSel ? h(Text, { dimColor: true }, truncate(`  ${t.projectName ?? ''} · ${t.branch}`, colWidth - 4)) : null
            )
          }))
    )
  })

  return h(
    Box,
    { flexDirection: 'column' },
    h(Box, { flexDirection: 'row' }, ...columns),
    confirm
      ? h(Text, { color: 'yellow' }, confirm.prompt)
      : message
        ? h(Text, { color: 'yellow' }, message)
        : h(
            Text,
            { dimColor: true },
            `h/l 切欄 · j/k 選卡 · H/L 移動 · Enter 終端 · d diff · w Web · ? 說明 · q 離開   [${backend}]`
          )
  )
}

/** Resolve after the board view exits with an action. */
function showBoard(opts: TuiOptions, initial: Selection, initialMessage?: string): Promise<{ action: TuiAction; sel: Selection }> {
  return new Promise((resolve) => {
    let result: { action: TuiAction; sel: Selection } = { action: { type: 'quit' }, sel: initial }
    const instance = render(
      h(BoardView, {
        opts,
        initial,
        initialMessage,
        onAction: (action, sel) => {
          result = { action, sel }
        },
      }),
      { exitOnCtrlC: false }
    )
    void instance.waitUntilExit().then(() => resolve(result))
  })
}

function hasCommand(cmd: string, args: string[]): boolean {
  return spawnSync(cmd, args, { stdio: 'ignore' }).status === 0
}

/** `git diff <base>` through git's pager, side by side via delta when it is installed. */
export function showDiff(task: Task): void {
  const base = task.baseBranch ?? 'HEAD'
  const env = diffEnv(process.env, hasCommand('delta', ['--version']))
  spawnSync('git', ['-C', task.worktreePath!, '-c', 'color.ui=always', 'diff', base], {
    stdio: 'inherit',
    env,
  })
}

/**
 * Hand the terminal to tmux for the card's session. Inside VibeFlow's own
 * tmux server we switch clients instead of nesting. Inside any other tmux
 * server a nested attach is the only way to reach ours.
 */
function tmuxAttach(opts: TuiOptions, sessionName: string): void {
  const conf = path.join(opts.userDataDir, 'tmux.conf')
  const inOurServer = (process.env.TMUX ?? '').split(',')[0].endsWith(`/${TMUX_SOCKET}`)
  const args = inOurServer
    ? ['-L', TMUX_SOCKET, '-f', conf, 'switch-client', '-t', `=${sessionName}`]
    : ['-L', TMUX_SOCKET, '-f', conf, 'attach-session', '-t', `=${sessionName}`]
  spawnSync('tmux', args, { stdio: 'inherit', env: { ...process.env, TMUX: inOurServer ? process.env.TMUX : '' } })
}

/**
 * Without tmux, pipe the core-held pty straight to this terminal: output in,
 * keystrokes out, Ctrl+] to return. Works the same whether core is in this
 * process or behind a WebSocket.
 */
function ptyPassthrough(api: VibeFlowApi, key: string, scrollback: string | null): Promise<string | undefined> {
  return new Promise((resolve) => {
    const stdin = process.stdin
    const stdout = process.stdout
    stdout.write('\x1b[2J\x1b[H')
    if (scrollback) stdout.write(scrollback)
    const offData = api.term.onData(({ sessionKey, data }) => {
      if (sessionKey === key) stdout.write(data)
    })
    const done = (note?: string) => {
      offData()
      offExit()
      stdin.off('data', onInput)
      stdout.off('resize', onResize)
      if (stdin.isTTY) stdin.setRawMode(false)
      stdin.pause()
      stdout.write(RESET_TERMINAL_MODES)
      resolve(note)
    }
    const offExit = api.term.onExit(({ sessionKey, exitCode }) => {
      if (sessionKey === key) done(`［session 已結束，exit ${exitCode}］`)
    })
    const onInput = (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      const at = findDetachKey(text)
      if (at >= 0) {
        if (at > 0) api.term.input(key, text.slice(0, at))
        done()
        return
      }
      api.term.input(key, text)
    }
    const onResize = () => api.term.resize(key, stdout.columns, stdout.rows)
    if (stdin.isTTY) stdin.setRawMode(true)
    stdin.resume()
    stdin.on('data', onInput)
    stdout.on('resize', onResize)
    onResize()
  })
}

async function openTerminal(opts: TuiOptions, task: Task): Promise<string | undefined> {
  const { api } = opts
  const key = task.id
  const info = await api.term.list()
  let peek = await api.term.peek(key)
  if (!peek.alive) {
    // Nothing running: resume the pinned conversation of a started card when
    // there is one, else give a shell in the worktree.
    const resumable = task.launchedAt != null && (await api.term.sessionExists(task.id))
    await api.term.start({
      taskId: task.id,
      launch: resumable ? { resume: true } : undefined,
      cols: process.stdout.columns,
      rows: process.stdout.rows,
    })
    peek = { alive: true, scrollback: null }
  }
  if (info.backend === 'tmux') {
    tmuxAttach(opts, `vf-${key.replace(/[^A-Za-z0-9_-]/g, '_')}`)
    return undefined
  }
  return ptyPassthrough(api, key, peek.scrollback)
}

/** Run the board until the user quits. */
export async function runTui(opts: TuiOptions): Promise<void> {
  let sel: Selection = { column: 1, index: 0 }
  let message: string | undefined
  for (;;) {
    const result = await showBoard(opts, sel, message)
    sel = result.sel
    message = undefined
    const { action } = result
    if (action.type === 'quit') return
    try {
      if (action.type === 'attach') message = await openTerminal(opts, action.task)
      else if (action.type === 'diff') showDiff(action.task)
    } catch (err) {
      message = `失敗：${(err as Error).message}`
    }
    process.stdout.write(CLEAR_SCREEN)
  }
}
