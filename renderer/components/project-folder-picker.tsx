import { FolderOpen, TriangleAlert } from 'lucide-react'

import { fieldClass } from '@/components/ui/field'
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
}: {
  projectPath: string | null
  recentProjects: RecentProjectEntry[]
  disabled: boolean
  onSelect: (projectPath: string) => void
  onBrowse: () => void
}) {
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

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <select
          name="project-folder"
          aria-label="專案資料夾"
          value={projectPath ?? ''}
          onChange={(e) => e.target.value && onSelect(e.target.value)}
          disabled={disabled || options.length === 0}
          className={cn(fieldClass, 'min-w-0 flex-1', missing && 'border-destructive/60')}
        >
          <option value="" disabled>
            {options.length > 0 ? '選擇使用過的專案…' : '尚無使用過的專案，請點右側按鈕選取'}
          </option>
          {options.map((p) => (
            <option key={p.path} value={p.path} title={p.path}>
              {p.name}
              {(nameCounts.get(p.name) ?? 0) > 1 ? ` — ${parentDir(p.path)}` : ''}
              {p.missing ? '（路徑遺失）' : ''}
            </option>
          ))}
        </select>
        <IconButton
          aria-label="從資料夾選擇專案"
          title="從資料夾選擇專案"
          onClick={onBrowse}
          disabled={disabled}
          tone="primary"
          className="rounded-md border border-border p-2"
        >
          <FolderOpen className="size-4" />
        </IconButton>
      </div>
      {projectPath && !missing && (
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
