import { useEffect, useRef, useState } from 'react'
import {
  Bot,
  Cpu,
  FolderOpen,
  GitBranch,
  Loader2,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { RoleAvatar } from '@/components/roles-dialog'
import { cn } from '@/lib/utils'
import type { AgentCli, AgentCliId, GitInfo, Role, Workspace } from '@/lib/types'

type ProjectMode = 'existing' | 'new'

interface NewTaskDialogProps {
  open: boolean
  creating: boolean
  error: string | null
  pickFolder: () => Promise<string | null>
  loadGitInfo: (projectPath: string) => Promise<GitInfo | null>
  /** Initialise a brand-new git repo at the given path and return its GitInfo. */
  initRepository: (projectPath: string) => Promise<GitInfo | null>
  /** Agent CLIs detected on PATH (claude / codex / gemini). */
  detectAgents: () => Promise<AgentCli[]>
  /** Roles available for assignment ('' = use the default, no role). */
  roles: Role[]
  onManageRoles: () => void
  /** Workspaces available for context injection ('' = no workspace). */
  workspaces?: Workspace[]
  onSubmit: (
    title: string,
    description: string,
    projectPath: string,
    baseBranch: string | null,
    mode: ProjectMode,
    agentCli: AgentCliId,
    model: string,
    roleId: string,
    reviewerRoleId: string,
    workspaceId: string
  ) => void
  onClose: () => void
}

function basename(p: string): string {
  const parts = p.split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

export function NewTaskDialog({
  open,
  creating,
  error,
  pickFolder,
  loadGitInfo,
  initRepository,
  detectAgents,
  roles,
  onManageRoles,
  workspaces = [],
  onSubmit,
  onClose,
}: NewTaskDialogProps) {
  const [step, setStep] = useState<1 | 2>(1)
  const [mode, setMode] = useState<ProjectMode>('existing')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null)
  const [loadingInfo, setLoadingInfo] = useState(false)
  const [initializing, setInitializing] = useState(false)
  const [baseBranch, setBaseBranch] = useState('')
  // null = detection still running; [] = none found on PATH.
  const [agents, setAgents] = useState<AgentCli[] | null>(null)
  const [agentCli, setAgentCli] = useState<AgentCliId>('claude')
  // '' until the agent's models load; the agent's lightweight default is then applied.
  const [model, setModel] = useState('')
  // '' = no role assigned (default behavior).
  const [roleId, setRoleId] = useState('')
  // '' = no reviewer; setting one turns the task into a review pipeline.
  const [reviewerRoleId, setReviewerRoleId] = useState('')
  // '' = no workspace; setting one injects context.html into the agent.
  const [workspaceId, setWorkspaceId] = useState('')

  const titleRef = useRef<HTMLInputElement>(null)

  // Reset all state whenever the dialog opens.
  useEffect(() => {
    if (!open) return
    setStep(1)
    setMode('existing')
    setTitle('')
    setDescription('')
    setProjectPath(null)
    setGitInfo(null)
    setLoadingInfo(false)
    setInitializing(false)
    setBaseBranch('')
    setAgents(null)
    setAgentCli('claude')
    setModel('')
    setRoleId('')
    setReviewerRoleId('')
    setWorkspaceId('')
    let active = true
    void detectAgents().then((found) => {
      if (!active) return
      setAgents(found)
      // Prefer claude when installed, otherwise the first detected agent.
      if (!found.some((a) => a.id === 'claude') && found.length > 0) {
        setAgentCli(found[0].id)
      }
    })
    return () => {
      active = false
    }
  }, [open, detectAgents])

  // Auto-focus the title input when entering step 2.
  useEffect(() => {
    if (step === 2) titleRef.current?.focus()
  }, [step])

  // Pin the model to the selected agent's lightweight default whenever the agent
  // (or the detected agent list) changes, so each agent runs on its cheapest model.
  useEffect(() => {
    const agent = agents?.find((a) => a.id === agentCli)
    if (agent && agent.models.length > 0) setModel(agent.models[0].id)
  }, [agentCli, agents])

  const handleModeChange = (next: ProjectMode) => {
    if (next === mode) return
    setMode(next)
    // Clear project-specific state; keep title/description/agent/role.
    setProjectPath(null)
    setGitInfo(null)
    setLoadingInfo(false)
    setInitializing(false)
    setBaseBranch('')
  }

  if (!open) return null

  const handlePick = async () => {
    const path = await pickFolder()
    if (!path) return
    setProjectPath(path)
    setGitInfo(null)

    if (mode === 'new') {
      setInitializing(true)
      try {
        const info = await initRepository(path)
        setGitInfo(info)
      } finally {
        setInitializing(false)
      }
    } else {
      setLoadingInfo(true)
      try {
        const info = await loadGitInfo(path)
        setGitInfo(info)
        setBaseBranch(info?.defaultBase ?? '')
      } finally {
        setLoadingInfo(false)
      }
    }
  }

  const isRepo = gitInfo?.isRepo ?? false
  const hasRemote = gitInfo?.hasRemote ?? false

  const isProjectReady =
    mode === 'new'
      ? Boolean(projectPath) && isRepo && !initializing
      : Boolean(projectPath) && isRepo && !loadingInfo

  const canGoToStep2 = isProjectReady

  const canSubmit = title.trim().length > 0 && !creating

  const handleSubmit = () => {
    if (!canSubmit || !projectPath) return
    const effectiveModel = model || currentAgent?.models[0]?.id || ''
    onSubmit(
      title.trim(),
      description.trim(),
      projectPath,
      mode === 'existing' && hasRemote ? baseBranch || null : null,
      mode,
      agentCli,
      effectiveModel,
      roleId,
      reviewerRoleId,
      workspaceId
    )
  }

  const currentAgent = agents?.find((a) => a.id === agentCli) ?? null
  const agentModels = currentAgent?.models ?? []

  const selectedRole = roles.find((r) => r.id === roleId) ?? null
  const selectedReviewerRole =
    roles.find((r) => r.id === reviewerRoleId) ?? null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60"
        onClick={creating ? undefined : onClose}
      />
      <div className="relative z-10 w-full max-w-md rounded-lg border bg-card p-5 text-card-foreground shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">新增任務</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={creating}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="mb-5 flex items-center gap-2">
          <div
            className={cn(
              'flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
              step === 1
                ? 'bg-primary text-primary-foreground'
                : 'bg-primary/20 text-primary'
            )}
          >
            1
          </div>
          <span
            className={cn(
              'text-xs',
              step === 1 ? 'font-medium text-foreground' : 'text-muted-foreground'
            )}
          >
            專案設定
          </span>
          <div className="h-px flex-1 bg-border" />
          <div
            className={cn(
              'flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
              step === 2
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground'
            )}
          >
            2
          </div>
          <span
            className={cn(
              'text-xs',
              step === 2 ? 'font-medium text-foreground' : 'text-muted-foreground'
            )}
          >
            任務內容
          </span>
        </div>

        {/* Step 1: Project folder, workspace, base branch */}
        {step === 1 && (
          <div className="space-y-4">
            {/* Project mode selector */}
            <div className="space-y-1.5">
              <span className="text-sm font-medium">專案類型</span>
              <div className="flex overflow-hidden rounded-md border">
                <button
                  type="button"
                  onClick={() => handleModeChange('existing')}
                  disabled={creating || loadingInfo || initializing}
                  className={cn(
                    'flex-1 px-3 py-1.5 text-sm transition-colors',
                    mode === 'existing'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-background text-muted-foreground hover:text-foreground'
                  )}
                >
                  現有專案
                </button>
                <button
                  type="button"
                  onClick={() => handleModeChange('new')}
                  disabled={creating || loadingInfo || initializing}
                  className={cn(
                    'flex-1 px-3 py-1.5 text-sm transition-colors',
                    mode === 'new'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-background text-muted-foreground hover:text-foreground'
                  )}
                >
                  新專案
                </button>
              </div>
            </div>

            {/* Project folder picker */}
            <div className="space-y-1.5">
              <span className="text-sm font-medium">
                {mode === 'new' ? '專案位置' : '專案資料夾'}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePick}
                  disabled={creating || initializing || loadingInfo}
                >
                  <FolderOpen />
                  {projectPath ? '更換資料夾' : '選擇資料夾'}
                </Button>
                {projectPath && (
                  <span
                    className="truncate text-xs text-muted-foreground"
                    title={projectPath}
                  >
                    {basename(projectPath)}
                  </span>
                )}
              </div>
              {mode === 'new' && !projectPath && (
                <p className="text-xs text-muted-foreground">
                  選擇一個空的資料夾，系統將自動初始化 Git repository。
                </p>
              )}
            </div>

            {(loadingInfo || initializing) && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                {initializing ? '初始化 Git…' : '偵測 Git 狀態中…'}
              </p>
            )}

            {mode === 'existing' && projectPath && !loadingInfo && !isRepo && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                這個資料夾不是 Git repository，請改選一個 Git 專案。
              </p>
            )}

            {isRepo && hasRemote && (
              <label className="block space-y-1.5">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <GitBranch className="size-3.5" />
                  基準分支 (Base Branch)
                </span>
                <select
                  value={baseBranch}
                  onChange={(e) => setBaseBranch(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {(gitInfo?.branches ?? []).map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {isRepo && !hasRemote && (
              <p className="text-xs text-muted-foreground">
                此 repository 沒有 remote，將以目前分支 (
                {gitInfo?.currentBranch ?? 'HEAD'}) 為基準建立本地 worktree。
              </p>
            )}

            {/* Workspace — shown regardless of repo state to allow pre-selection. */}
            {workspaces.length > 0 && (
              <div className="space-y-1.5">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <FolderOpen className="size-3.5" />
                  Workspace（選填）
                </span>
                <select
                  value={workspaceId}
                  onChange={(e) => setWorkspaceId(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <option value="">不使用 Workspace</option>
                  {workspaces.map((ws) => (
                    <option key={ws.id} value={ws.id}>
                      {ws.name}
                    </option>
                  ))}
                </select>
                {workspaceId && (
                  <p className="text-xs text-muted-foreground">
                    Agent 將在開始前讀取 context.html，並在完成後更新它。
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Step 2: Task details, Agent CLI + Model side by side, roles */}
        {step === 2 && (
          <div className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">任務標題</span>
              <input
                ref={titleRef}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如：實作登入頁面"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium">詳細描述（選填）</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder="描述這個任務的目標、需求或背景脈絡…"
                className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </label>

            {/* Agent CLI + Model: side by side */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <Bot className="size-3.5" />
                  Agent CLI
                </span>
                {agents === null ? (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" />
                    偵測中…
                  </p>
                ) : agents.length === 0 ? (
                  <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs">
                    未偵測到 Agent CLI（claude / codex / gemini）。
                  </p>
                ) : (
                  <select
                    value={agentCli}
                    onChange={(e) => setAgentCli(e.target.value as AgentCliId)}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="space-y-1.5">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <Cpu className="size-3.5" />
                  Model
                </span>
                {agentModels.length > 0 ? (
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {agentModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="py-2 text-xs text-muted-foreground">—</p>
                )}
              </div>
            </div>

            {/* Role assignment */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <UserRound className="size-3.5" />
                  指派角色（選填）
                </span>
                <button
                  type="button"
                  onClick={onManageRoles}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  管理角色
                </button>
              </div>
              <div className="flex items-center gap-2">
                {selectedRole && (
                  <RoleAvatar role={selectedRole} className="size-8 text-sm" />
                )}
                <select
                  value={roleId}
                  onChange={(e) => setRoleId(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <option value="">預設（不指派角色）</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Reviewer assignment */}
            <div className="space-y-1.5">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <ShieldCheck className="size-3.5" />
                Code Reviewer（選填，啟用自動審查）
              </span>
              <div className="flex items-center gap-2">
                {selectedReviewerRole && (
                  <RoleAvatar
                    role={selectedReviewerRole}
                    className="size-8 text-sm"
                  />
                )}
                <select
                  value={reviewerRoleId}
                  onChange={(e) => setReviewerRoleId(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <option value="">不自動審查</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
              {selectedReviewerRole && (
                <p className="text-xs text-muted-foreground">
                  執行角色完成後，{selectedReviewerRole.name}{' '}
                  會自動審查改動並來回修正，直到通過為止（須開啟 Auto Mode）。
                </p>
              )}
            </div>

            {error && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm">
                {error}
              </p>
            )}
          </div>
        )}

        {/* Footer buttons: step-aware */}
        {step === 1 ? (
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={creating}>
              取消
            </Button>
            <Button
              size="sm"
              onClick={() => setStep(2)}
              disabled={!canGoToStep2}
            >
              下一步 →
            </Button>
          </div>
        ) : (
          <div className="mt-5 flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setStep(1)}
              disabled={creating}
            >
              ← 上一步
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={onClose} disabled={creating}>
                取消
              </Button>
              <Button
                size="sm"
                onClick={handleSubmit}
                disabled={!canSubmit}
                className={cn(creating && 'opacity-80')}
              >
                {creating && <Loader2 className="animate-spin" />}
                {creating ? '建立 Worktree 中…' : '建立任務'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
