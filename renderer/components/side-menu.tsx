import { motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'
import {
  FolderOpen,
  Inbox,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  Smartphone,
  SquareKanban,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { SECTION_LABEL } from '@/components/ui/section-label'
import type { BoardView } from '@/components/ui/view-tabs'
import { createEnterVariants, MOTION_DURATION, MOTION_EASING } from '@/lib/motion'

export interface SideMenuProject {
  name: string
  /** Open Issues / PRs that involve me; null = not on GitHub or not loaded yet. */
  issues: number | null
  prs: number | null
}

interface SideMenuProps {
  collapsed: boolean
  onToggleCollapse: () => void
  view: BoardView
  onSelectView: (view: BoardView) => void
  taskCount: number
  /** Open Issues + PRs across every project; null until the first load. */
  githubCount: number | null
  projects: SideMenuProject[]
  /** Project the Issues & PRs view is narrowed to. */
  /** Projects ticked in the Issues & PRs project filter. */
  activeProjects: string[]
  onSelectProject: (name: string) => void
  onNewTask: () => void
  onRemoteShare?: () => void
  remoteActive?: boolean
  onOpenSettings: () => void
}

const ROW =
  'flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors motion-reduce:transition-none'

function rowTone(active: boolean): string {
  return active
    ? 'bg-primary/15 font-medium text-primary'
    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
}

function projectCounts(project: SideMenuProject): string {
  if (project.issues === null || project.prs === null) return '—'
  return `${project.issues} · ${project.prs}`
}

function SidebarModeContent({
  mode,
  className,
  children,
}: {
  mode: 'collapsed' | 'expanded'
  className?: string
  children: ReactNode
}) {
  const reducedMotion = useReducedMotion() ?? false

  return (
    <motion.div
      key={mode}
      initial="hidden"
      animate="visible"
      variants={createEnterVariants({
        timing: 'micro',
        reducedMotion,
      })}
      className={className}
    >
      {children}
    </motion.div>
  )
}

/** Settings-related controls docked at the bottom of the sidebar. */
function SettingsDock({
  collapsed,
  onRemoteShare,
  remoteActive,
  onOpenSettings,
}: {
  collapsed: boolean
  onRemoteShare?: () => void
  remoteActive?: boolean
  onOpenSettings: () => void
}) {
  if (collapsed) {
    return (
      <SidebarModeContent
        mode="collapsed"
        className="flex flex-col items-center gap-1 border-t border-border p-2"
      >
        {onRemoteShare && (
          <IconButton
            aria-label="遠端控制"
            onClick={onRemoteShare}
            title="遠端控制"
            className={cn(
              'size-8',
              remoteActive && 'text-primary hover:text-primary'
            )}
          >
            <Smartphone className="size-4" />
          </IconButton>
        )}
        <IconButton
          aria-label="設定 System Prompt"
          onClick={onOpenSettings}
          title="設定（System Prompt）"
          className="size-8"
        >
          <Settings className="size-4" />
        </IconButton>
      </SidebarModeContent>
    )
  }

  return (
    <SidebarModeContent
      mode="expanded"
      className="border-t border-border p-2"
    >
      <div className="flex items-center gap-1 px-1">
        {onRemoteShare && (
          <IconButton
            aria-label="遠端控制"
            onClick={onRemoteShare}
            title="遠端控制"
            className={cn(
              remoteActive
                ? 'text-primary hover:text-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Smartphone className="size-4" />
          </IconButton>
        )}
        <IconButton
          aria-label="設定 System Prompt"
          onClick={onOpenSettings}
          title="設定（System Prompt）"
        >
          <Settings className="size-4" />
        </IconButton>
      </div>
    </SidebarModeContent>
  )
}

export function SideMenu({
  collapsed,
  onToggleCollapse,
  view,
  onSelectView,
  taskCount,
  githubCount,
  projects,
  activeProjects,
  onSelectProject,
  onNewTask,
  onRemoteShare,
  remoteActive,
  onOpenSettings,
}: SideMenuProps) {
  const reducedMotion = useReducedMotion() ?? false
  const contentVariants = createEnterVariants({
    timing: 'micro',
    reducedMotion,
  })

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 48 : 320 }}
      transition={{
        duration: reducedMotion ? 0 : MOTION_DURATION.spatial,
        ease: MOTION_EASING.enter,
      }}
      className="flex flex-shrink-0 flex-col overflow-x-clip border-r border-border bg-card text-card-foreground"
    >
      {/* Top: app name + collapse toggle */}
      <div
        className={cn(
          'flex h-12 shrink-0 items-center border-b border-border px-3',
          collapsed ? 'justify-center' : 'justify-between'
        )}
      >
        {!collapsed && (
          <motion.span
            initial="hidden"
            animate="visible"
            variants={contentVariants}
            className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-foreground"
          >
            <img src="/logo.svg" alt="" className="size-5" />
            VibeFlow
          </motion.span>
        )}
        <IconButton
          aria-label={collapsed ? '展開選單' : '收合選單'}
          onClick={onToggleCollapse}
          title={collapsed ? '展開選單' : '收合選單'}
          className="group p-1"
        >
          {collapsed ? (
            <>
              {/* The rail has room for one control: the logo, which turns into the expand icon on hover or focus. */}
              <img src="/logo.svg" alt="" className="size-5 group-hover:hidden group-focus-visible:hidden" />
              <PanelLeftOpen className="hidden size-4 group-hover:block group-focus-visible:block" />
            </>
          ) : (
            <PanelLeftClose className="size-4" />
          )}
        </IconButton>
      </div>

      {/* New task */}
      <SidebarModeContent
        mode={collapsed ? 'collapsed' : 'expanded'}
        className={cn(
          'shrink-0 px-2 pt-3',
          collapsed ? 'flex justify-center' : 'w-full'
        )}
      >
        {collapsed ? (
          <IconButton
            aria-label="新增任務"
            onClick={onNewTask}
            title="新增任務"
            className="size-8 p-1.5"
          >
            <Plus className="size-4" />
          </IconButton>
        ) : (
          <Button
            size="sm"
            className="w-full rounded-md active:scale-95"
            onClick={onNewTask}
          >
            <Plus />
            新增任務
          </Button>
        )}
      </SidebarModeContent>

      <div className={cn('flex flex-1 flex-col py-3', collapsed ? 'items-center gap-1 overflow-hidden px-2' : 'overflow-y-auto')}>
        {collapsed ? (
          <SidebarModeContent mode="collapsed" className="flex flex-col items-center gap-1">
            <IconButton
              aria-label="看板"
              title="看板"
              onClick={() => onSelectView('board')}
              className={cn('size-8', view === 'board' && 'text-primary hover:text-primary')}
            >
              <SquareKanban className="size-4" />
            </IconButton>
            <IconButton
              aria-label="工作項目"
              title="工作項目"
              onClick={() => onSelectView('github')}
              className={cn('size-8', view === 'github' && 'text-primary hover:text-primary')}
            >
              <Inbox className="size-4" />
            </IconButton>
          </SidebarModeContent>
        ) : (
          <motion.div
            key="expanded-nav"
            initial="hidden"
            animate="visible"
            variants={contentVariants}
            className="space-y-4 px-2"
          >
            <nav aria-label="檢視" className="space-y-0.5">
              <div className={cn(SECTION_LABEL, 'mb-1 px-2')}>檢視</div>
              <button
                type="button"
                aria-current={view === 'board' ? 'page' : undefined}
                onClick={() => onSelectView('board')}
                className={cn(ROW, 'focus-visible:ring-[3px] focus-visible:ring-ring/50', rowTone(view === 'board'))}
              >
                <SquareKanban className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">看板</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{taskCount}</span>
              </button>
              <button
                type="button"
                aria-current={view === 'github' ? 'page' : undefined}
                onClick={() => onSelectView('github')}
                className={cn(ROW, 'focus-visible:ring-[3px] focus-visible:ring-ring/50', rowTone(view === 'github'))}
              >
                <Inbox className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">工作項目</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {githubCount ?? '—'}
                </span>
              </button>
            </nav>

            <div className="space-y-0.5">
              <div className={cn(SECTION_LABEL, 'mb-1 flex items-center px-2')}>
                <span className="flex-1">專案</span>
                <span className="normal-case tracking-normal text-muted-foreground/70">Issue · PR</span>
              </div>
              {projects.length === 0 ? (
                <p className="px-2 py-1 text-sm text-muted-foreground">尚無專案</p>
              ) : (
                projects.map((project) => {
                  const active = view === 'github' && activeProjects.includes(project.name)
                  return (
                    <button
                      key={project.name}
                      type="button"
                      aria-pressed={active}
                      title={
                        project.issues === null
                          ? `${project.name}（沒有 GitHub origin 或尚未載入）`
                          : `只看 ${project.name} 的 Issue 與 PR`
                      }
                      onClick={() => onSelectProject(project.name)}
                      className={cn(ROW, 'focus-visible:ring-[3px] focus-visible:ring-ring/50', rowTone(active))}
                    >
                      <FolderOpen className="size-3.5 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{project.name}</span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {projectCounts(project)}
                      </span>
                    </button>
                  )
                })
              )}
            </div>
          </motion.div>
        )}
      </div>

      <SettingsDock
        collapsed={collapsed}
        onRemoteShare={onRemoteShare}
        remoteActive={remoteActive}
        onOpenSettings={onOpenSettings}
      />
    </motion.aside>
  )
}
