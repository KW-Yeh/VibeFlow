import { useId, useState } from 'react'
import { AnimatePresence, LayoutGroup } from 'motion/react'
import { ChevronRight, FolderOpen, GitBranch, GitCompare, Layers, Network, Trash2 } from 'lucide-react'

import type { SlaveEntry } from '@/components/board-columns'
import { MarkdownContent } from '@/components/markdown-content'
import { TaskFormDialog, PropertyGroup, PropertyNote } from '@/components/task-form-layout'
import { TaskProgressDetail } from '@/components/task-progress'
import { DoneCommitDiffContent } from '@/components/commit-diff'
import { SlavesContent, TaskOutcomeSection } from '@/components/task-workspace-panel'
import { HoldButton } from '@/components/ui/hold-button'
import { TabIndicator } from '@/components/ui/tab-indicator'
import { cn } from '@/lib/utils'
import type { Task } from '@/lib/types'

type DoneTab = 'task' | 'slaves' | 'diff'

const TAB_LABEL: Record<DoneTab, string> = {
  task: '任務與成果',
  slaves: 'Slaves',
  diff: 'Git diff',
}

/**
 * A finished card's account of the work: its prompt, what it came to and its
 * commits. The worktree and artifacts are gone by now, so everything here is
 * read from the stored card; a commit's changes are fetched only when opened.
 */
export function DoneTaskSheet({
  task,
  slaves,
  master,
  onSelectTask,
  onDelete,
  onClose,
}: {
  task: Task | null
  slaves: SlaveEntry[]
  master: Task | null
  onSelectTask: (taskId: string) => void
  onDelete: () => void
  onClose: () => void
}) {
  return (
    <AnimatePresence>
      {task && (
        <DoneTaskSheetBody
          key={task.id}
          task={task}
          slaves={slaves}
          master={master}
          onSelectTask={onSelectTask}
          onDelete={onDelete}
          onClose={onClose}
        />
      )}
    </AnimatePresence>
  )
}

function DoneTaskSheetBody({
  task,
  slaves,
  master,
  onSelectTask,
  onDelete,
  onClose,
}: {
  task: Task
  slaves: SlaveEntry[]
  master: Task | null
  onSelectTask: (taskId: string) => void
  onDelete: () => void
  onClose: () => void
}) {
  const isMaster = task.role === 'master'
  const [picked, setPicked] = useState<DoneTab | null>(null)
  const tabBaseId = useId()

  const commits = isMaster ? [] : (task.outcome?.commits ?? [])
  const tabs: DoneTab[] = isMaster
    ? slaves.length > 0 ? ['slaves', 'task'] : ['task']
    : commits.length > 0 ? ['task', 'diff'] : ['task']
  const activeTab = picked && tabs.includes(picked) ? picked : tabs[0]

  const content = (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <h2 className="break-words text-2xl font-semibold tracking-tight">{task.title}</h2>
      {tabs.length > 1 && (
        <LayoutGroup id={`${tabBaseId}-tabs`}>
          <div role="tablist" aria-label="任務檢視" className="flex w-fit rounded-md border border-border/70 p-0.5">
            {tabs.map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                id={`${tabBaseId}-${tab}`}
                aria-selected={activeTab === tab}
                aria-controls={`${tabBaseId}-panel`}
                onClick={() => setPicked(tab)}
                className={cn(
                  'relative isolate shrink-0 rounded-sm px-2 py-0.5 text-xs outline-none transition-colors motion-reduce:transition-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  activeTab === tab ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {activeTab === tab && (
                  <TabIndicator layoutId="done-sheet-tab" className="inset-0 -z-10 rounded-sm bg-primary/15" />
                )}
                {TAB_LABEL[tab]}
                {tab === 'slaves' && <span className="ml-1 tabular-nums text-muted-foreground/80">{slaves.length}</span>}
                {tab === 'diff' && <span className="ml-1 tabular-nums text-muted-foreground/80">{commits.length}</span>}
              </button>
            ))}
          </div>
        </LayoutGroup>
      )}
      <div
        role="tabpanel"
        id={`${tabBaseId}-panel`}
        aria-labelledby={`${tabBaseId}-${activeTab}`}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {activeTab === 'diff' ? (
          <DoneCommitDiffContent taskId={task.id} commits={commits} prNumber={task.outcome?.pr?.number} />
        ) : activeTab === 'slaves' ? (
          <SlavesContent slaves={slaves} progressById={{}} onSelectTask={onSelectTask} />
        ) : (
          <div className="space-y-4">
            {task.description ? (
              <MarkdownContent source={task.description} />
            ) : (
              <p className="text-sm text-muted-foreground">沒有描述。</p>
            )}
            {task.outcome && <TaskOutcomeSection outcome={task.outcome} />}
          </div>
        )}
      </div>
    </div>
  )

  const sidebar = (
    <>
      <PropertyGroup label="位置">
        <div className="space-y-1.5 px-1 text-sm text-muted-foreground">
          {isMaster ? (
            <div className="flex items-start gap-2">
              <FolderOpen className="mt-0.5 size-3.5 shrink-0" />
              <span className="min-w-0 break-all font-mono text-xs">{task.worktreePath ?? task.workDir ?? '—'}</span>
            </div>
          ) : (
            <>
              {task.projectName && (
                <div className="flex items-center gap-2">
                  <Layers className="size-3.5 shrink-0" />
                  <span className="min-w-0 truncate">{task.projectName}</span>
                </div>
              )}
              <div className="flex items-start gap-2">
                <GitBranch className="mt-0.5 size-3.5 shrink-0" />
                <span className="min-w-0 break-all">{task.branch}</span>
              </div>
              {task.baseBranch && (
                <div className="flex items-start gap-2">
                  <GitCompare className="mt-0.5 size-3.5 shrink-0" />
                  <span className="min-w-0 break-all">base: {task.baseBranch}</span>
                </div>
              )}
            </>
          )}
        </div>
      </PropertyGroup>
      {master && (
        <PropertyGroup label="隸屬於">
          <button
            type="button"
            onClick={() => onSelectTask(master.id)}
            title="開啟 master 卡片"
            className="flex w-full items-center gap-2 rounded-md border border-master/30 bg-master/5 p-2.5 text-left text-sm outline-none transition-colors motion-reduce:transition-none hover:bg-master/10 focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <Network className="size-3.5 shrink-0 text-master" />
            <span className="min-w-0 flex-1 truncate font-medium">{master.title}</span>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </PropertyGroup>
      )}
      {task.usage && (
        <PropertyGroup label="用量">
          <TaskProgressDetail usage={task.usage} />
        </PropertyGroup>
      )}
      <PropertyNote>已完成的卡片無法編輯。</PropertyNote>
    </>
  )

  return (
    <TaskFormDialog
      title="任務詳情"
      header={
        <>
          <span className="text-sm text-muted-foreground">任務詳情 · Done</span>
          <span
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-sm',
              isMaster ? 'border-master/40 text-master' : 'border-border text-muted-foreground'
            )}
          >
            {isMaster ? <Network className="size-3.5" /> : <GitBranch className="size-3.5" />}
            {isMaster ? 'Master' : '一般任務'}
          </span>
        </>
      }
      saving={false}
      onClose={onClose}
      content={content}
      sidebar={sidebar}
      actions={
        <HoldButton
          onConfirm={onDelete}
          aria-label={`按住刪除任務「${task.title}」`}
          title={`按住以刪除任務「${task.title}」`}
          className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full px-3 text-sm text-destructive transition-colors motion-reduce:transition-none hover:bg-destructive/15 disabled:opacity-50"
        >
          <Trash2 className="size-3.5" />
          刪除
        </HoldButton>
      }
    />
  )
}
