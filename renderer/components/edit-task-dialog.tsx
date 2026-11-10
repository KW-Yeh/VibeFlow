import { AnimatePresence } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { GitBranch, Loader2, Network, Play, SquareArrowOutUpRight, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { fieldClass as F } from '@/components/ui/field'
import { HoldButton } from '@/components/ui/hold-button'
import {
  ProjectFolderPicker,
  isProjectMissing,
} from '@/components/project-folder-picker'
import { DEFAULT_TASK_EFFORT } from '@/components/task-effort-slider'
import { Select } from '@/components/ui/select'
import {
  PropertyGroup,
  PropertyNote,
  PropertyRow,
  ROW_FIELD,
  RunSettingsGroup,
  TaskFormDialog,
  useAgentModels,
  useModelEfforts,
} from '@/components/task-form-layout'
import { cn } from '@/lib/utils'
import type {
  AgentCli,
  AgentCliId,
  AgentEffort,
  ColumnId,
  GitInfo,
  RecentProjectEntry,
  Task,
} from '@/lib/types'

export interface EditTaskPayload {
  title: string
  description: string
  agentCli: AgentCliId
  model: string
  effort: AgentEffort
  autoMode: boolean
  projectPath?: string
  baseBranch?: string | null
  /** Blank keeps the card's current branch. */
  branch?: string
  /** Master to belong to; null takes the card out of its master; absent keeps it. */
  masterId?: string | null
}

const COLUMN_LABEL: Record<ColumnId, string> = {
  backlog: 'Backlog',
  in_progress: 'In Progress',
  done: 'Done',
}

interface EditTaskDialogProps {
  /** The card shown, or null when the sheet is closed. */
  task: Task | null
  /** Only a Backlog card is editable; core refuses the others. */
  column: ColumnId
  onDelete: () => void
  onOpenWorkspace: () => void
  /** Board-wide Auto Mode, used for cards that carry no value of their own. */
  defaultAutoMode?: boolean
  detectAgents: () => Promise<AgentCli[]>
  pickFolder: () => Promise<string | null>
  loadRecentProjects: () => Promise<RecentProjectEntry[]>
  loadGitInfo: (projectPath: string) => Promise<GitInfo | null>
  saving: boolean
  error: string | null
  /** Master cards an ordinary card can be put under. */
  masters?: Array<{ id: string; title: string }>
  onSubmit: (payload: EditTaskPayload) => void
  /** Start a Backlog card; `edits` are saved first when the form holds any. */
  onStart: (edits: EditTaskPayload | null) => void
  onClose: () => void
}

export function EditTaskDialog({
  task,
  column,
  onDelete,
  onOpenWorkspace,
  detectAgents,
  pickFolder,
  loadRecentProjects,
  loadGitInfo,
  saving,
  error,
  defaultAutoMode = true,
  masters = [],
  onSubmit,
  onStart,
  onClose,
}: EditTaskDialogProps) {
  const [masterId, setMasterId] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [agentCli, setAgentCli] = useState<AgentCliId>('claude')
  const [model, setModel] = useState('')
  const [effort, setEffort] = useState<AgentEffort>(DEFAULT_TASK_EFFORT)
  const models = useAgentModels(agentCli)
  const effortLevels = useModelEfforts(models, agentCli, model, effort, setEffort)
  const [autoMode, setAutoMode] = useState(true)
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const [baseBranch, setBaseBranch] = useState('')
  const [branch, setBranch] = useState('')
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null)
  const [loadingInfo, setLoadingInfo] = useState(false)
  const [projectChanged, setProjectChanged] = useState(false)
  const [recentProjects, setRecentProjects] = useState<RecentProjectEntry[]>([])

  const [agents, setAgents] = useState<AgentCli[] | null>(null)
  const [detectTimedOut, setDetectTimedOut] = useState(false)
  const [detectKey, setDetectKey] = useState(0)
  const [confirmClose, setConfirmClose] = useState(false)
  const taskSnapshotRef = useRef<Task | null>(null)
  const displayedTask = task ?? taskSnapshotRef.current

  useEffect(() => {
    if (task) taskSnapshotRef.current = task
  }, [task])

  // Seed the fields from the task whenever a new one is opened.
  useEffect(() => {
    if (!task) return
    setTitle(task.title)
    setDescription(task.description ?? '')
    setAgentCli(task.agentCli ?? 'claude')
    setModel(task.model ?? '')
    setEffort(task.effort ?? DEFAULT_TASK_EFFORT)
    setAutoMode(task.autoMode ?? defaultAutoMode)
    setProjectPath(task.projectPath ?? null)
    setBaseBranch(task.baseBranch ?? '')
    setBranch(task.branch)
    setMasterId(task.masterId ?? '')
    setGitInfo(null)
    setLoadingInfo(false)
    setProjectChanged(false)
    setConfirmClose(false)
  }, [task, defaultAutoMode])

  useEffect(() => {
    if (!task) return
    let active = true
    void loadRecentProjects().then((list) => {
      if (active) setRecentProjects(list)
    })
    return () => {
      active = false
    }
  }, [task, loadRecentProjects])

  // The base branch list of the card's current project; a newly picked project
  // replaces it in selectProject.
  useEffect(() => {
    if (!task?.projectPath) return
    let active = true
    setLoadingInfo(true)
    void loadGitInfo(task.projectPath)
      .then((info) => {
        if (active) setGitInfo(info)
      })
      .finally(() => {
        if (active) setLoadingInfo(false)
      })
    return () => {
      active = false
    }
  }, [task, loadGitInfo])

  // Detect installed agent CLIs when the dialog opens (and on retry).
  useEffect(() => {
    if (!task) return
    let active = true
    setDetectTimedOut(false)
    setAgents(null)
    const timeoutId = setTimeout(() => {
      if (active) setDetectTimedOut(true)
    }, 6000)
    void detectAgents().then((found) => {
      if (!active) return
      clearTimeout(timeoutId)
      setAgents(found)
    })
    return () => {
      active = false
      clearTimeout(timeoutId)
    }
  }, [task, detectAgents, detectKey])

  if (!displayedTask) return null

  // Only Backlog cards are edited. One that already has a worktree (from an
  // earlier run) gives it up when its git fields change; core refuses if it
  // holds changes.
  const hasWorktree = Boolean(displayedTask.worktreePath)
  const readOnly = column !== 'backlog'

  const isDirty = !readOnly && (
    title !== displayedTask.title ||
    description !== (displayedTask.description ?? '') ||
    agentCli !== (displayedTask.agentCli ?? 'claude') ||
    model !== (displayedTask.model ?? '') ||
    effort !== (displayedTask.effort ?? DEFAULT_TASK_EFFORT) ||
    autoMode !== (displayedTask.autoMode ?? defaultAutoMode) ||
    projectChanged ||
    baseBranch !== (displayedTask.baseBranch ?? '') ||
    branch.trim() !== displayedTask.branch ||
    masterId !== (displayedTask.masterId ?? ''))

  const handleClose = () => {
    if (saving) return
    if (isDirty) {
      setConfirmClose(true)
    } else {
      onClose()
    }
  }

  const handleAgentChange = (next: AgentCliId) => {
    setAgentCli(next)
    setModel('')
  }
  const projectMissing = isProjectMissing(recentProjects, projectPath)

  const selectProject = async (picked: string, knownToExist = false) => {
    setProjectPath(picked)
    setProjectChanged(picked !== displayedTask.projectPath)
    setGitInfo(null)
    if (!knownToExist && isProjectMissing(recentProjects, picked)) return
    setLoadingInfo(true)
    try {
      const info = await loadGitInfo(picked)
      setGitInfo(info)
      setBaseBranch(info?.defaultBase ?? '')
    } finally {
      setLoadingInfo(false)
    }
  }

  const handleBrowse = async () => {
    const picked = await pickFolder()
    if (!picked) return
    // The picked folder exists, so a stale "missing" flag on it must go.
    setRecentProjects((list) =>
      list.map((p) => (p.path === picked ? { ...p, missing: false } : p))
    )
    await selectProject(picked, true)
  }

  const isRepo = gitInfo?.isRepo ?? true
  const hasRemote = gitInfo?.hasRemote ?? false
  const gitFieldsChanged =
    projectChanged ||
    baseBranch !== (displayedTask.baseBranch ?? '') ||
    (branch.trim() !== '' && branch.trim() !== displayedTask.branch)

  const canSubmit =
    !readOnly &&
    title.trim().length > 0 &&
    !saving &&
    !loadingInfo &&
    (!projectChanged || (isRepo && !projectMissing))


  const isMaster = displayedTask?.role === 'master'

  const editsPayload = (): EditTaskPayload => {
    const shared = { title: title.trim(), description: description.trim(), agentCli, model, effort, autoMode }
    if (isMaster) return shared
    return {
      ...shared,
      ...(projectPath ? { projectPath, baseBranch: baseBranch || null } : {}),
      branch: branch.trim(),
      ...(masterId !== (displayedTask?.masterId ?? '') ? { masterId: masterId || null } : {}),
    }
  }

  const handleSubmit = () => {
    if (canSubmit) onSubmit(editsPayload())
  }

  const handleStart = () => {
    if (canSubmit) onStart(isDirty ? editsPayload() : null)
  }

  const content = (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {confirmClose && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <span className="text-warning">有未儲存的變更，確定要離開？</span>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setConfirmClose(false)}
              className="rounded-md px-2 py-0.5 text-sm text-muted-foreground outline-none transition-colors motion-reduce:transition-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              繼續編輯
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-2 py-0.5 text-sm text-destructive outline-none transition-colors motion-reduce:transition-none hover:bg-destructive/15 focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              放棄離開
            </button>
          </div>
        </div>
      )}
      <input
        autoFocus={!readOnly}
        readOnly={readOnly}
        name="edit-task-title"
        aria-label="任務標題"
        autoComplete="off"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit()
        }}
        placeholder="任務標題，例如：實作登入頁面"
        className="w-full rounded-sm bg-transparent text-2xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground/60 focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />
      <textarea
        readOnly={readOnly}
        name="edit-task-description"
        aria-label="詳細描述"
        autoComplete="off"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit()
        }}
        placeholder="描述這個任務的目標、需求或背景脈絡…"
        className={cn(F, 'min-h-32 flex-1 resize-none text-sm leading-6')}
      />
      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {error}
        </p>
      )}
    </div>
  )

  const locationGroup = !isMaster && (
    <PropertyGroup label="位置">
      <div className="space-y-1 px-1">
        <span className="text-sm text-muted-foreground">專案</span>
        <ProjectFolderPicker
          compact
          projectPath={projectPath}
          recentProjects={recentProjects}
          disabled={readOnly || saving || loadingInfo}
          onSelect={(path) => void selectProject(path)}
          onBrowse={() => void handleBrowse()}
        />
      </div>
      {loadingInfo && (
        <PropertyNote>
          <span className="flex items-center gap-1.5">
            <Loader2 className="size-3 animate-spin" />
            偵測 Git 狀態中…
          </span>
        </PropertyNote>
      )}
      {projectChanged && !projectMissing && !loadingInfo && !isRepo && (
        <PropertyNote tone="danger">這個資料夾不是 Git repository，請改選一個 Git 專案。</PropertyNote>
      )}
      {isRepo && hasRemote && (
        <PropertyRow label="基準分支">
          <Select
            name="edit-base-branch"
            aria-label="基準分支"
            value={baseBranch}
            onChange={setBaseBranch}
            disabled={readOnly || saving || loadingInfo}
            className={ROW_FIELD}
            options={[
              ...(baseBranch && !(gitInfo?.branches ?? []).includes(baseBranch) ? [baseBranch] : []),
              ...(gitInfo?.branches ?? []),
            ].map((b) => ({ value: b, label: b }))}
          />
        </PropertyRow>
      )}
      <PropertyRow label="分支">
        <input
          name="edit-branch"
          autoComplete="off"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          placeholder="例如 feature/login-fix"
          disabled={readOnly || saving}
          className={ROW_FIELD}
        />
      </PropertyRow>
      {hasWorktree && gitFieldsChanged ? (
        <PropertyNote tone="warning">
          這張卡已經有 worktree。儲存後會移除它與本地分支，下次開始執行時再重新建立；有未完成的變更時無法儲存。origin 上已推送的分支不會被刪除。
        </PropertyNote>
      ) : !readOnly ? (
        <PropertyNote>分支在卡片開始執行時才建立並推到 origin。</PropertyNote>
      ) : null}
      {masters.length > 0 && (
        <PropertyRow label="隸屬於">
          <Select
            name="edit-master-id"
            aria-label="隸屬於"
            value={masterId}
            onChange={setMasterId}
            disabled={readOnly || saving}
            className={ROW_FIELD}
            options={[{ value: '', label: '無' }, ...masters.map((m) => ({ value: m.id, label: m.title }))]}
          />
        </PropertyRow>
      )}
    </PropertyGroup>
  )

  return (
    <AnimatePresence>
      {task && (
        <TaskFormDialog
          key={displayedTask.id}
          title={readOnly ? '任務詳情' : '編輯任務'}
          header={
            <>
              <span className="text-sm text-muted-foreground">
                {readOnly ? '任務詳情' : '編輯任務'} · {COLUMN_LABEL[column]}
              </span>
              <span
                title="建立後不能更改角色"
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
          saving={saving}
          onClose={handleClose}
          content={content}
          sidebar={
            <>
              {locationGroup}
              <RunSettingsGroup
                agents={agents}
                detectTimedOut={detectTimedOut}
                onRetry={() => setDetectKey((k) => k + 1)}
                agentCli={agentCli}
                onAgentChange={handleAgentChange}
                model={model}
                onModelChange={setModel}
                models={models}
                effort={effort}
                onEffortChange={setEffort}
                effortLevels={effortLevels}
                autoMode={autoMode}
                onAutoModeChange={setAutoMode}
                disabled={readOnly || saving}
              />
              {readOnly && (
<PropertyNote>執行中的卡片無法編輯，請到工作區查看進度。</PropertyNote>
              )}
            </>
          }
          actions={
            <>
              <HoldButton
                onConfirm={onDelete}
                disabled={saving}
                aria-label={`按住刪除任務「${displayedTask.title}」`}
                title={`按住以刪除任務「${displayedTask.title}」（清理 worktree）`}
                className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full px-3 text-sm text-destructive transition-colors motion-reduce:transition-none hover:bg-destructive/15 disabled:opacity-50"
              >
                <Trash2 className="size-3.5" />
                刪除
              </HoldButton>
              {readOnly ? (
                <Button size="sm" onClick={onOpenWorkspace} className="flex-1 rounded-full">
                  <SquareArrowOutUpRight />
                  前往工作區
                </Button>
              ) : (
                <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSubmit}
                disabled={!canSubmit}
                className={cn('flex-1 rounded-full', saving && 'opacity-80')}
              >
                {saving && <Loader2 className="animate-spin" />}
                {saving ? '儲存中…' : '儲存變更'}
              </Button>
              <Button
                size="sm"
                onClick={handleStart}
                disabled={!canSubmit}
                title={isDirty ? '儲存變更並開始執行' : '開始執行'}
                className="flex-1 rounded-full"
              >
                <Play />
                開始
              </Button>
                </>
              )}
            </>
          }
        />
      )}
    </AnimatePresence>
  )
}
