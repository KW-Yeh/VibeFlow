import { useEffect, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { StandaloneTerminal } from '@/components/standalone-terminal'
import { ProjectFolderPicker, isProjectMissing } from '@/components/project-folder-picker'
import { DialogShell } from '@/components/ui/dialog-shell'
import { ViewTabs, type BoardView } from '@/components/ui/view-tabs'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import type { RecentProjectEntry, StandaloneTerminalEntry } from '@/lib/types'
import { basenameFromPath } from '@/lib/workspace-path'
import { cn } from '@/lib/utils'

export type GridTerminal = StandaloneTerminalEntry

export function TerminalGrid({
  view,
  onViewChange,
  terminals,
  taskWorktreePaths,
  focusedSessionKey,
  recentProjects,
  onCreate,
  onRename,
  onStarted,
  onClose,
  onBrowse,
}: {
  view: BoardView
  onViewChange: (view: BoardView) => void
  terminals: GridTerminal[]
  taskWorktreePaths: Record<string, string>
  focusedSessionKey: string | null
  recentProjects: RecentProjectEntry[]
  onCreate: (projectPath: string) => void
  onRename: (sessionKey: string, title: string) => void
  /** Core has saved this pane: its start returned. */
  onStarted: (sessionKey: string) => void
  onClose: (sessionKey: string) => void
  onBrowse: () => Promise<string | null>
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const terminalRefs = useRef(new Map<string, HTMLElement>())

  useEffect(() => {
    if (view !== 'terminals' || !focusedSessionKey) return
    const target = terminalRefs.current.get(focusedSessionKey)
    target?.scrollIntoView({ block: 'center' })
    target?.focus({ preventScroll: true })
  }, [focusedSessionKey, view])

  return (
    <div className="@container flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-5">
        <ViewTabs value={view} onChange={onViewChange} />
        <Button size="sm" aria-label="新增 Terminal" onClick={() => setPickerOpen(true)}>
          <Plus className="size-4" /><span className="hidden sm:inline">新增 Terminal</span>
        </Button>
      </div>

      {terminals.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
          <p>尚未開啟 Terminal</p>
          <p className="text-sm">選擇專案或資料夾，即可在該目錄開啟獨立終端機。</p>
        </div>
      ) : (
        <div className="grid min-h-0 w-full flex-1 auto-rows-[360px] grid-cols-1 content-start gap-4 overflow-y-auto p-4 @min-[728px]:grid-cols-2 @min-[1084px]:grid-cols-3">
          {terminals.map((terminal) => {
            const directory = terminal.taskId
              ? taskWorktreePaths[terminal.taskId] ?? terminal.projectPath
              : terminal.projectPath
            return (
              <section
                key={terminal.sessionKey}
                ref={(node) => {
                  if (node) terminalRefs.current.set(terminal.sessionKey, node)
                  else terminalRefs.current.delete(terminal.sessionKey)
                }}
                tabIndex={-1}
                aria-label={`Terminal：${terminal.title}`}
                className={cn(
                  'flex h-[360px] w-full min-w-0 flex-col overflow-hidden rounded-md border bg-card outline-none',
                  focusedSessionKey === terminal.sessionKey ? 'border-primary ring-2 ring-primary/30' : 'border-border'
                )}
              >
                <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
                  <TerminalTitleInput
                    title={terminal.title}
                    fallback={basenameFromPath(terminal.projectPath)}
                    onCommit={(title) => onRename(terminal.sessionKey, title)}
                  />
                  <IconButton
                    aria-label={`關閉 Terminal：${terminal.title}`}
                    title="關閉並釋放 Terminal"
                    onClick={() => onClose(terminal.sessionKey)}
                    className="size-7 shrink-0"
                  >
                    <X className="size-4" />
                  </IconButton>
                </div>
                <div className="truncate border-b border-border px-3 py-1 font-mono text-xs text-muted-foreground" title={directory}>
                  {directory}
                </div>
                <StandaloneTerminal
                  sessionKey={terminal.sessionKey}
                  title={terminal.title}
                  onStarted={() => onStarted(terminal.sessionKey)}
                  projectPath={terminal.projectPath}
                  displayPath={directory}
                  taskId={terminal.taskId}
                />
              </section>
            )
          })}
        </div>
      )}

      {pickerOpen && (
        <DialogShell title="新增 Terminal" onClose={() => setPickerOpen(false)} contentClassName="max-w-lg rounded-lg p-5">
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">選擇專案或資料夾</h2>
            <ProjectFolderPicker
              projectPath={selectedPath}
              recentProjects={recentProjects}
              disabled={false}
              onSelect={setSelectedPath}
              onBrowse={() => { void onBrowse().then((path) => { if (path) setSelectedPath(path) }) }}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setPickerOpen(false)}>取消</Button>
              <Button
                size="sm"
                disabled={!selectedPath || isProjectMissing(recentProjects, selectedPath)}
                onClick={() => {
                  if (!selectedPath) return
                  onCreate(selectedPath)
                  setSelectedPath(null)
                  setPickerOpen(false)
                }}
              >
                開啟 Terminal
              </Button>
            </div>
          </div>
        </DialogShell>
      )}
    </div>
  )
}

/** Edits locally and saves once on blur or Enter, so typing does not rewrite the store per key. */
function TerminalTitleInput({
  title,
  fallback,
  onCommit,
}: {
  title: string
  fallback: string
  onCommit: (title: string) => void
}) {
  const [draft, setDraft] = useState(title)
  const [editing, setEditing] = useState(false)
  const value = editing ? draft : title
  const commit = () => {
    setEditing(false)
    const next = draft.trim() || fallback
    if (next !== title) onCommit(next)
  }
  return (
    <input
      aria-label={`編輯 Terminal 標題：${title}`}
      title="點擊編輯標題"
      value={value}
      onFocus={() => { setDraft(title); setEditing(true) }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
      className="min-w-0 flex-1 rounded-sm bg-transparent px-1 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    />
  )
}
