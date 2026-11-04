import { useState } from 'react'
import { CornerDownLeft, FolderOpen, TriangleAlert } from 'lucide-react'

import { fieldClass } from '@/components/ui/field'
import { Select } from '@/components/ui/select'
import { IconButton } from '@/components/ui/icon-button'
import { cn } from '@/lib/utils'
import { basenameFromPath as basename } from '@/lib/workspace-path'
import type { RecentProjectEntry } from '@/lib/types'

/** Whether `projectPath` is a recorded project whose folder no longer exists. */
export function isProjectMissing(
  recentProjects: RecentProjectEntry[],
  projectPath: string | null
): boolean {
  return Boolean(projectPath && recentProjects.find((p) => p.path === projectPath)?.missing)
}

function parentDir(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, '')
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return idx > 0 ? trimmed.slice(0, idx) : trimmed
}

export function ProjectFolderPicker({
  projectPath,
  recentProjects,
  disabled,
  onSelect,
  onBrowse,
  compact = false,
}: {
  projectPath: string | null
  recentProjects: RecentProjectEntry[]
  disabled: boolean
  onSelect: (projectPath: string) => void
  onBrowse: () => void
  /** Sidebar density: smaller controls, and the chosen path as a tooltip only. */
  compact?: boolean
}) {
  const control = compact ? 'h-8 px-2 py-1 text-sm' : undefined
  const sideButton = compact ? 'rounded-md border border-border p-1.5' : 'rounded-md border border-border p-2'
  const currentName = projectPath ? basename(projectPath) : null
  // A lost entry sharing the chosen folder's name is that same project before
  // it moved; the next recorded use replaces it, so don't offer it meanwhile.
  const options = recentProjects.filter(
    (p) => !(p.missing && p.name === currentName && p.path !== projectPath)
  )
  if (projectPath && !options.some((p) => p.path === projectPath)) {
    options.unshift({ path: projectPath, name: currentName ?? projectPath, lastUsedAt: 0, missing: false })
  }
  const nameCounts = new Map<string, number>()
  for (const p of options) nameCounts.set(p.name, (nameCounts.get(p.name) ?? 0) + 1)

  const missing = isProjectMissing(recentProjects, projectPath)
  const [typedPath, setTypedPath] = useState('')
  const applyTypedPath = () => {
    const next = typedPath.trim()
    if (!next) return
    onSelect(next)
    setTypedPath('')
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Select
          name="project-folder"
          aria-label="專案資料夾"
          title={projectPath ?? undefined}
          value={projectPath ?? ''}
          onChange={onSelect}
          disabled={disabled || options.length === 0}
          placeholder={options.length > 0 ? '選擇使用過的專案…' : '尚無使用過的專案，請點右側按鈕選取'}
          className={cn('min-w-0 flex-1', control, missing && 'border-destructive/60')}
          options={options.map((p) => ({
            value: p.path,
            title: p.path,
            label: `${p.name}${(nameCounts.get(p.name) ?? 0) > 1 ? ` — ${parentDir(p.path)}` : ''}${p.missing ? '（路徑遺失）' : ''}`,
          }))}
        />
        <IconButton
          aria-label="從資料夾選擇專案"
          title="從資料夾選擇專案"
          onClick={onBrowse}
          disabled={disabled}
          tone="primary"
          className={sideButton}
        >
          <FolderOpen className="size-4" />
        </IconButton>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          name="project-path"
          aria-label="輸入專案資料夾路徑"
          placeholder={compact ? '或輸入絕對路徑後按 Enter' : '或輸入資料夾的絕對路徑，按 Enter 套用'}
          value={typedPath}
          onChange={(e) => setTypedPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              applyTypedPath()
            }
          }}
          disabled={disabled}
          spellCheck={false}
          className={cn(fieldClass, 'min-w-0 flex-1 font-mono text-sm', control)}
        />
        <IconButton
          aria-label="套用輸入的路徑"
          title="套用輸入的路徑"
          onClick={applyTypedPath}
          disabled={disabled || typedPath.trim() === ''}
          className={sideButton}
        >
          <CornerDownLeft className="size-4" />
        </IconButton>
      </div>
      {projectPath && !missing && !compact && (
        <p className="truncate text-sm text-muted-foreground" title={projectPath}>
          {projectPath}
        </p>
      )}
      {missing && (
        <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" />
          <span>
            找不到 <code className="break-all text-foreground">{projectPath}</code>
            ，專案可能已被移動或刪除。請點右側資料夾按鈕重新選取，之後選單會改用新的路徑。
          </span>
        </p>
      )}
    </div>
  )
}
