import { useEffect, useState } from 'react'
import {
  ChevronDown,
  FolderOpen,
  GitBranch,
  Loader2,
  Lock,
  ShieldCheck,
  UserRound,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { DialogShell } from '@/components/ui/dialog-shell'
import { RoleAvatar } from '@/components/roles-dialog'
import { AgentModelFields, F, FolderPickerZone } from '@/components/new-task-dialog'
import { cn } from '@/lib/utils'
import { basenameFromPath as basename } from '@/lib/workspace-path'
import type {
  AgentCli,
  AgentCliId,
  AgentConnections,
  GitInfo,
  Role,
  Task,
} from '@/lib/types'

export interface EditTaskPayload {
  title: string
  description: string
  roleId: string
  reviewerRoleId: string
  agentCli: AgentCliId
  model: string
  executionAgentCli: AgentCliId
  executionModel: string
  /** Present only when the project folder may change (not-yet-launched tasks). */
  projectPath?: string
  baseBranch?: string | null
}

interface EditTaskDialogProps {
  /** The task being edited, or null when the dialog is closed. */
  task: Task | null
  /** Roles available for assignment ('' = use the default, no role). */
  roles: Role[]
  detectAgents: () => Promise<AgentCli[]>
  agentConnections?: AgentConnections
  pickFolder: () => Promise<string | null>
  loadGitInfo: (projectPath: string) => Promise<GitInfo | null>
  onManageRoles?: () => void
  saving: boolean
  error: string | null
  onSubmit: (payload: EditTaskPayload) => void
  onClose: () => void
}

export function EditTaskDialog({
  task,
  roles,
  detectAgents,
  agentConnections,
  pickFolder,
  loadGitInfo,
  onManageRoles,
  saving,
  error,
  onSubmit,
  onClose,
}: EditTaskDialogProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [roleId, setRoleId] = useState('')
  const [agentCli, setAgentCli] = useState<AgentCliId>('claude')
  const [model, setModel] = useState('')
  const [executionAgentCli, setExecutionAgentCli] = useState<AgentCliId>('claude')
  const [executionModel, setExecutionModel] = useState('')
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const [baseBranch, setBaseBranch] = useState('')
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null)
  const [loadingInfo, setLoadingInfo] = useState(false)
  const [projectChanged, setProjectChanged] = useState(false)

  const [agents, setAgents] = useState<AgentCli[] | null>(null)
  const [detectTimedOut, setDetectTimedOut] = useState(false)
  const [detectKey, setDetectKey] = useState(0)
  const [advancedOpen, setAdvancedOpen] = useState(true)
  const [confirmClose, setConfirmClose] = useState(false)

  // Seed the fields from the task whenever a new one is opened.
  useEffect(() => {
    if (!task) return
    setTitle(task.title)
    setDescription(task.description ?? '')
    setRoleId(task.roleId ?? '')
    setAgentCli(task.agentCli ?? 'claude')
    setModel(task.model ?? '')
    setExecutionAgentCli(task.executionAgentCli ?? task.agentCli ?? 'claude')
    setExecutionModel(task.executionModel ?? '')
    setProjectPath(task.projectPath ?? null)
    setBaseBranch(task.baseBranch ?? '')
    setGitInfo(null)
    setLoadingInfo(false)
    setProjectChanged(false)
    setConfirmClose(false)
  }, [task])

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

  if (!task) return null

  // A worktree exists from creation; re-selecting the project rebuilds it, so it
  // is only offered while the task has never been launched (no work to lose).
  const canEditProject = !task.launchedAt

  const isDirty =
    title !== task.title ||
    description !== (task.description ?? '') ||
    roleId !== (task.roleId ?? '') ||
    agentCli !== (task.agentCli ?? 'claude') ||
    model !== (task.model ?? '') ||
    executionAgentCli !== (task.executionAgentCli ?? task.agentCli ?? 'claude') ||
    executionModel !== (task.executionModel ?? '') ||
    projectChanged ||
    baseBranch !== (task.baseBranch ?? '')

  const handleClose = () => {
    if (isDirty && !saving) {
      setConfirmClose(true)
    } else {
      onClose()
    }
  }

  const handleAgentChange = (next: AgentCliId) => {
    setAgentCli(next)
    setModel('')
  }
  const handleExecutionAgentChange = (next: AgentCliId) => {
    setExecutionAgentCli(next)
    setExecutionModel('')
  }

  const handlePickFolder = async () => {
    const picked = await pickFolder()
    if (!picked) return
    setProjectPath(picked)
    setProjectChanged(picked !== task.projectPath)
    setGitInfo(null)
    setLoadingInfo(true)
    try {
      const info = await loadGitInfo(picked)
      setGitInfo(info)
      setBaseBranch(info?.defaultBase ?? '')
    } finally {
      setLoadingInfo(false)
    }
  }

  const isRepo = gitInfo?.isRepo ?? true
  const hasRemote = gitInfo?.hasRemote ?? false

  const canSubmit =
    title.trim().length > 0 &&
    !saving &&
    !loadingInfo &&
    (!projectChanged || isRepo)

  const selectedRole = roles.find((r) => r.id === roleId) ?? null

  const handleSubmit = () => {
    if (!canSubmit) return
    onSubmit({
      title: title.trim(),
      description: description.trim(),
      roleId,
      // Reviewer is fixed (測試工程師) and always on; no per-task selection.
      reviewerRoleId: '',
      agentCli,
      model,
      executionAgentCli,
      executionModel,
      ...(canEditProject && projectPath
        ? { projectPath, baseBranch: baseBranch || null }
        : {}),
    })
  }

  return (
    <DialogShell
      title="編輯任務"
      description="更新任務內容、agent 與角色指派。"
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
        <div className="mb-4 flex items-center justify-between rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <span className="text-warning">有未儲存的變更，確定要離開？</span>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setConfirmClose(false)}
              className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent"
            >
              繼續編輯
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded px-2 py-0.5 text-xs text-destructive hover:bg-destructive/15"
            >
              放棄離開
            </button>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">任務標題</span>
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
          <span className="text-sm font-medium">詳細描述（選填）</span>
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

        {/* Project folder — editable only before the task has launched. */}
        <div className="space-y-1.5">
          <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <FolderOpen className="size-3" />
            專案資料夾
          </span>
          {canEditProject ? (
            <>
              <FolderPickerZone
                mode="existing"
                projectPath={projectPath}
                disabled={saving || loadingInfo}
                onPick={handlePickFolder}
              />
              {loadingInfo && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                  偵測 Git 狀態中…
                </p>
              )}
              {projectChanged && !loadingInfo && !isRepo && (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs">
                  這個資料夾不是 Git repository，請改選一個 Git 專案。
                </p>
              )}
              {projectChanged && (
                <p className="text-xs text-muted-foreground">
                  更換專案會在新專案重建 worktree（此任務尚未開始，無變更會遺失）。
                </p>
              )}
              {projectChanged && isRepo && hasRemote && (
                <label className="block space-y-1.5 pt-1">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <GitBranch className="size-3" />
                    基準分支 (Base Branch)
                  </span>
                  <select
                    name="edit-base-branch"
                    value={baseBranch}
                    onChange={(e) => setBaseBranch(e.target.value)}
                    className={F}
                  >
                    {(gitInfo?.branches ?? []).map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          ) : (
            <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5">
              <Lock className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate text-sm" title={task.projectPath}>
                {task.projectName ?? (task.projectPath ? basename(task.projectPath) : '—')}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">任務已開始，鎖定</span>
            </div>
          )}
        </div>

        {/* Advanced — agents, roles, workspace (mirrors the new-task dialog). */}
        <div className="rounded-lg border border-border/50">
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium transition-colors outline-none hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <span>Advanced</span>
            <ChevronDown
              className={cn(
                'size-4 text-muted-foreground transition-transform',
                advancedOpen && 'rotate-180'
              )}
            />
          </button>
          {advancedOpen && (
            <div className="space-y-4 border-t border-border/50 p-4">
              <AgentModelFields
                title="Planning Agent"
                agents={agents}
                detectTimedOut={detectTimedOut}
                onRetry={() => setDetectKey((k) => k + 1)}
                agentCli={agentCli}
                onAgentChange={handleAgentChange}
                model={model}
                onModelChange={setModel}
                agentConnections={agentConnections}
              />
              <AgentModelFields
                title="Execution Agent"
                agents={agents}
                detectTimedOut={detectTimedOut}
                onRetry={() => setDetectKey((k) => k + 1)}
                agentCli={executionAgentCli}
                onAgentChange={handleExecutionAgentChange}
                model={executionModel}
                onModelChange={setExecutionModel}
                agentConnections={agentConnections}
              />

              <div className="space-y-3 rounded-lg border border-border/50 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    角色設定
                  </p>
                  {onManageRoles && (
                    <button
                      type="button"
                      onClick={onManageRoles}
                      className="text-xs text-primary hover:underline"
                    >
                      管理角色
                    </button>
                  )}
                </div>
                <div className="space-y-1.5">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <UserRound className="size-3" />
                    指派角色
                  </span>
                  <div className="flex items-center gap-2">
                    {selectedRole && (
                      <RoleAvatar role={selectedRole} className="size-6 shrink-0 text-[10px]" />
                    )}
                    <select
                      name="edit-task-role"
                      value={roleId}
                      onChange={(e) => setRoleId(e.target.value)}
                      className={F}
                    >
                      <option value="">不指派角色</option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <ShieldCheck className="size-3" />
                    完成後由測試工程師自動審查並來回修正（須開啟 Auto Mode）。
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm">
            {error}
          </p>
        )}
      </div>
    </DialogShell>
  )
}
