import { AnimatePresence } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import {
  ChevronDown,
  FolderOpen,
  GitBranch,
  Loader2,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { DialogShell } from '@/components/ui/dialog-shell'
import {
  AgentModelFields,
  F,
  useAgentModels,
  useModelEfforts,
} from '@/components/new-task-dialog'
import {
  ProjectFolderPicker,
  isProjectMissing,
} from '@/components/project-folder-picker'
import {
  DEFAULT_TASK_EFFORT,
  TaskEffortSlider,
} from '@/components/task-effort-slider'
import { TaskAutoModeToggle } from '@/components/task-auto-mode-toggle'
import { cn } from '@/lib/utils'
import type {
  AgentCli,
  AgentCliId,
  AgentEffort,
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
}

interface EditTaskDialogProps {
  /** The task being edited, or null when the dialog is closed. */
  task: Task | null
  /** Board-wide Auto Mode, used for cards that carry no value of their own. */
  defaultAutoMode?: boolean
  detectAgents: () => Promise<AgentCli[]>
  pickFolder: () => Promise<string | null>
  loadRecentProjects: () => Promise<RecentProjectEntry[]>
  loadGitInfo: (projectPath: string) => Promise<GitInfo | null>
  saving: boolean
  error: string | null
  onSubmit: (payload: EditTaskPayload) => void
  onClose: () => void
}

export function EditTaskDialog({
  task,
  detectAgents,
  pickFolder,
  loadRecentProjects,
  loadGitInfo,
  saving,
  error,
  defaultAutoMode = true,
  onSubmit,
  onClose,
}: EditTaskDialogProps) {
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
  const [advancedOpen, setAdvancedOpen] = useState(true)
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

  const isDirty =
    title !== displayedTask.title ||
    description !== (displayedTask.description ?? '') ||
    agentCli !== (displayedTask.agentCli ?? 'claude') ||
    model !== (displayedTask.model ?? '') ||
    effort !== (displayedTask.effort ?? DEFAULT_TASK_EFFORT) ||
    autoMode !== (displayedTask.autoMode ?? defaultAutoMode) ||
    projectChanged ||
    baseBranch !== (displayedTask.baseBranch ?? '') ||
    branch.trim() !== displayedTask.branch

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
    title.trim().length > 0 &&
    !saving &&
    !loadingInfo &&
    (!projectChanged || (isRepo && !projectMissing))


  const handleSubmit = () => {
    if (!canSubmit) return
    onSubmit({
      title: title.trim(),
      description: description.trim(),
      agentCli,
      model,
      effort,
      autoMode,
      ...(projectPath ? { projectPath, baseBranch: baseBranch || null } : {}),
      branch: branch.trim(),
    })
  }

  return (
    <AnimatePresence>
      {task && (
        <DialogShell
          key={displayedTask.id}
      title="編輯任務"
      description="更新任務內容與 agent 設定。"
      saving={saving}
      onClose={handleClose}
      showHeader
      contentClassName="max-w-2xl"
      footer={
        <>
          <div />
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={handleClose} disabled={saving}>
              取消
            </Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className={cn(saving && 'opacity-80')}
            >
              {saving && <Loader2 className="animate-spin" />}
              {saving ? '儲存中…' : '儲存變更'}
            </Button>
          </div>
        </>
      }
    >
      {confirmClose && (
        <div className="mb-4 flex items-center justify-between rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-base">
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

      <div className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-base font-medium">任務標題</span>
          <input
            autoFocus
            name="edit-task-title"
            autoComplete="off"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例如：實作登入頁面"
            className={F}
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-base font-medium">詳細描述（選填）</span>
          <textarea
            name="edit-task-description"
            autoComplete="off"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="描述這個任務的目標、需求或背景脈絡…"
            className={cn(F, 'resize-y')}
          />
        </label>

        <TaskEffortSlider
          value={effort}
          onChange={setEffort}
          levels={effortLevels}
          disabled={saving}
        />

        <TaskAutoModeToggle
          value={autoMode}
          onChange={setAutoMode}
          disabled={saving}
        />

        <div className="space-y-1.5">
          <span className="flex items-center gap-1.5 text-sm font-medium uppercase tracking-wide text-muted-foreground">
            <FolderOpen className="size-3" />
            專案資料夾
          </span>
          <ProjectFolderPicker
            projectPath={projectPath}
            recentProjects={recentProjects}
            disabled={saving || loadingInfo}
            onSelect={(path) => void selectProject(path)}
            onBrowse={() => void handleBrowse()}
          />
          {loadingInfo && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              偵測 Git 狀態中…
            </p>
          )}
          {projectChanged && !projectMissing && !loadingInfo && !isRepo && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm">
              這個資料夾不是 Git repository，請改選一個 Git 專案。
            </p>
          )}
        </div>

        {isRepo && hasRemote && (
          <label className="block space-y-1.5">
            <span className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
              <GitBranch className="size-3" />
              基準分支 (Base Branch)
            </span>
            <select
              name="edit-base-branch"
              value={baseBranch}
              onChange={(e) => setBaseBranch(e.target.value)}
              disabled={saving || loadingInfo}
              className={F}
            >
              {baseBranch && !(gitInfo?.branches ?? []).includes(baseBranch) && (
                <option value={baseBranch}>{baseBranch}</option>
              )}
              {(gitInfo?.branches ?? []).map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="block space-y-1.5">
          <span className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            <GitBranch className="size-3" />
            分支名稱
          </span>
          <input
            name="edit-branch"
            autoComplete="off"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder="例如 feature/login-fix"
            disabled={saving}
            className={F}
          />
          <span className="block text-sm text-muted-foreground">
            分支會在卡片開始執行時才建立並推到 origin。
          </span>
        </label>

        {hasWorktree && gitFieldsChanged && (
          <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-sm text-warning">
            這張卡已經有 worktree。儲存後會移除它與本地分支，下次開始執行時再重新建立；
            worktree 有未完成的變更時無法儲存。origin 上已推送的分支不會被刪除。
          </p>
        )}

        {/* Advanced — agents, workspace (mirrors the new-task dialog). */}
        <div className="rounded-lg border border-border/50">
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-3 text-left text-base font-medium transition-colors outline-none hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <span>Advanced</span>
            <ChevronDown
              className={cn(
                'size-4 text-muted-foreground transition-transform motion-reduce:transform-none motion-reduce:transition-none',
                advancedOpen && 'rotate-180'
              )}
            />
          </button>
          {advancedOpen && (
            <div className="space-y-4 border-t border-border/50 p-4">
              <AgentModelFields
                title="Agent"
                agents={agents}
                detectTimedOut={detectTimedOut}
                onRetry={() => setDetectKey((k) => k + 1)}
                agentCli={agentCli}
                onAgentChange={handleAgentChange}
                model={model}
                onModelChange={setModel}
                models={models}
              />
            </div>
          )}
        </div>

        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-base">
            {error}
          </p>
        )}
      </div>
        </DialogShell>
      )}
    </AnimatePresence>
  )
}
