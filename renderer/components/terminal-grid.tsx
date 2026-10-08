import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { StandaloneTerminal } from '@/components/standalone-terminal'
import { ProjectFolderPicker, isProjectMissing } from '@/components/project-folder-picker'
import { DialogShell } from '@/components/ui/dialog-shell'
import { ViewTabs, type BoardView } from '@/components/ui/view-tabs'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import type { RecentProjectEntry } from '@/lib/types'
import { basenameFromPath } from '@/lib/workspace-path'

export interface GridTerminal {
  sessionKey: string
  title: string
  projectPath: string
  taskId?: string
}

export function TerminalGrid({
  view,
  onViewChange,
  terminals,
  recentProjects,
  onCreate,
  onRename,
  onClose,
  onBrowse,
}: {
  view: BoardView
  onViewChange: (view: BoardView) => void
  terminals: GridTerminal[]
  recentProjects: RecentProjectEntry[]
  onCreate: (projectPath: string) => void
  onRename: (sessionKey: string, title: string) => void
  onClose: (sessionKey: string) => void
  onBrowse: () => Promise<string | null>
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
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
        <div className="grid min-h-0 flex-1 grid-cols-1 auto-rows-[minmax(320px,1fr)] gap-4 overflow-y-auto p-4 lg:grid-cols-2">
          {terminals.map((terminal) => (
            <section key={terminal.sessionKey} className="flex min-h-[320px] min-w-0 flex-col overflow-hidden rounded-md border border-border bg-card">
              <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
                <input
                  aria-label={`編輯 Terminal 標題：${terminal.title}`}
                  title="點擊編輯標題"
                  value={terminal.title}
                  onChange={(event) => onRename(terminal.sessionKey, event.target.value)}
                  onBlur={() => { if (!terminal.title.trim()) onRename(terminal.sessionKey, basenameFromPath(terminal.projectPath)) }}
                  className="min-w-0 flex-1 rounded-sm bg-transparent px-1 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
              <div className="truncate border-b border-border px-3 py-1 font-mono text-xs text-muted-foreground" title={terminal.projectPath}>
                {terminal.projectPath}
              </div>
              <StandaloneTerminal
                sessionKey={terminal.sessionKey}
                projectPath={terminal.projectPath}
                taskId={terminal.taskId}
              />
            </section>
          ))}
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
