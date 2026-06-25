import { useEffect, useRef, useState } from 'react'
import {
  Bot,
  ChevronDown,
  Check,
  FolderOpen,
  GitBranch,
  Layers,
  Loader2,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { DialogShell } from '@/components/ui/dialog-shell'
import { IconButton } from '@/components/ui/icon-button'
import { RoleAvatar } from '@/components/roles-dialog'
import { cn } from '@/lib/utils'
import type { AgentCli, AgentCliId, GitInfo, Role, Workspace } from '@/lib/types'

type ProjectMode = 'existing' | 'new'

export interface NewTaskFormProps {
  creating: boolean
  error: string | null
  pickFolder: () => Promise<string | null>
  loadGitInfo: (projectPath: string) => Promise<GitInfo | null>
  initRepository: (projectPath: string) => Promise<GitInfo | null>
  detectAgents: () => Promise<AgentCli[]>
  roles: Role[]
  onManageRoles: () => void
  workspaces?: Workspace[]
  onSubmit: (
    title: string,
    description: string,
    projectPath: string,
    baseBranch: string | null,
    mode: ProjectMode,
    agentCli: AgentCliId,
    executionAgentCli: AgentCliId,
    roleId: string,
    reviewerRoleId: string,
    workspaceId: string
  ) => void
  onClose?: () => void
  /** Render as a full-height inline panel instead of a compact modal form. */
  inline?: boolean
}

function basename(p: string): string {
  const parts = p.split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

// Mirror of main's defaultWorkspacePath (helpers/workspace.ts): a project's
// sibling workspace is `<parent>/<slug>-workspace`. Used to auto-pick the
// matching workspace once a project folder is chosen.
function defaultWorkspacePath(projectPath: string): string {
  const slug = basename(projectPath).trim().toLowerCase().replace(/\s+/g, '_')
  const parent = projectPath.replace(/[/\\][^/\\]+[/\\]?$/, '')
  return `${parent}/${slug}-workspace`
}

// Shared field class — uniform height, subtle border, smooth focus ring
export const F =
  'w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 transition-shadow'

// ── Segmented control for existing vs new project ──────────────────────────
function ProjectTypeToggle({
  mode,
  onChange,
  disabled,
}: {
  mode: ProjectMode
  onChange: (m: ProjectMode) => void
  disabled: boolean
}) {
  return (
    <div className="flex rounded-full bg-muted p-1">
      {(['existing', 'new'] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          disabled={disabled}
          className={cn(
            'flex-1 rounded-full px-3 py-1 text-sm transition-colors disabled:opacity-50',
            mode === m
              ? 'bg-primary font-medium text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {m === 'existing' ? '現有專案' : '新專案'}
        </button>
      ))}
    </div>
  )
}

// ── Folder picker — dashed drop zone (empty) or compact card (selected) ────
export function FolderPickerZone({
  mode,
  projectPath,
  disabled,
  onPick,
}: {
  mode: ProjectMode
  projectPath: string | null
  disabled: boolean
  onPick: () => void
}) {
  if (projectPath) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5">
        <FolderOpen className="size-4 shrink-0 text-primary" />
        <span className="flex-1 truncate text-sm" title={projectPath}>
          {basename(projectPath)}
        </span>
        <button
          type="button"
          onClick={onPick}
          disabled={disabled}
          className="shrink-0 text-xs text-primary hover:underline disabled:opacity-50"
        >
          更換
        </button>
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      className="flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border py-5 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
    >
      <FolderOpen className="size-5" />
      <span className="text-xs">
        {mode === 'new' ? '選擇空資料夾（自動初始化 Git）' : '選擇專案資料夾'}
      </span>
    </button>
  )
}

// ── Agent CLI selector ─────────────────────────────────────────────────────
export interface AgentModelFieldsProps {
  title: string
  agents: AgentCli[] | null
  detectTimedOut: boolean
  onRetry: () => void
  agentCli: AgentCliId
  onAgentChange: (agentCli: AgentCliId) => void
}

export function AgentModelFields({
  title,
  agents,
  detectTimedOut,
  onRetry,
  agentCli,
  onAgentChange,
}: AgentModelFieldsProps) {
  return (
    <div className="space-y-3 rounded-lg border border-border/50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <div className="space-y-1.5">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Bot className="size-3" />
          Agent CLI
        </span>
        {agents === null ? (
          detectTimedOut ? (
            <div className="space-y-1">
              <p className="text-xs text-destructive">偵測逾時，請確認 Agent CLI 已安裝。</p>
              <button
                type="button"
                onClick={onRetry}
                className="text-xs text-primary underline hover:no-underline"
              >
                重新偵測
              </button>
            </div>
          ) : (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              偵測中…
            </p>
          )
        ) : agents.length === 0 ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs">
            未偵測到 Agent CLI（claude / codex / gemini / copilot）。
          </p>
        ) : (
          <select
            name={`${title.toLowerCase().replace(/\s+/g, '-')}-agent-cli`}
            value={agentCli}
            onChange={(e) => onAgentChange(e.target.value as AgentCliId)}
            className={F}
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  )
}

// ── Main form ──────────────────────────────────────────────────────────────
export function NewTaskForm({
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
  inline = false,
}: NewTaskFormProps) {
  const [step, setStep] = useState<1 | 2>(1)
  const [mode, setMode] = useState<ProjectMode>('existing')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null)
  const [loadingInfo, setLoadingInfo] = useState(false)
  const [initializing, setInitializing] = useState(false)
  const [baseBranch, setBaseBranch] = useState('')
  const [agents, setAgents] = useState<AgentCli[] | null>(null)
  const [detectTimedOut, setDetectTimedOut] = useState(false)
  const [detectKey, setDetectKey] = useState(0)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [agentCli, setAgentCli] = useState<AgentCliId>('claude')
  const [executionAgentCli, setExecutionAgentCli] = useState<AgentCliId>('claude')
  const [roleId, setRoleId] = useState('')
  const [reviewerRoleId, setReviewerRoleId] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')

  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
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
      if (!found.some((a) => a.id === 'claude') && found.length > 0) {
        setAgentCli(found[0].id)
        setExecutionAgentCli(found[0].id)
      }
    })
    return () => {
      active = false
      clearTimeout(timeoutId)
    }
  }, [detectAgents, detectKey])

  useEffect(() => {
    if (step === 2) titleRef.current?.focus()
  }, [step])

  useEffect(() => {
    if (inline) titleRef.current?.focus()
  }, [])

  const handleModeChange = (next: ProjectMode) => {
    if (next === mode) return
    setMode(next)
    setProjectPath(null)
    setGitInfo(null)
    setLoadingInfo(false)
    setInitializing(false)
    setBaseBranch('')
    setWorkspaceId('')
  }

  const handlePick = async () => {
    const path = await pickFolder()
    if (!path) return
    setProjectPath(path)
    setGitInfo(null)

    const wsPath = defaultWorkspacePath(path)
    const matched = workspaces.find((ws) => ws.path === wsPath)
    setWorkspaceId(matched?.id ?? '')
    if (matched) setAdvancedOpen(true)

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
  const canSubmit =
    title.trim().length > 0 && !creating && (inline ? isProjectReady : true)

  const handleSubmit = () => {
    if (!canSubmit || !projectPath) return
    onSubmit(
      title.trim(),
      description.trim(),
      projectPath,
      mode === 'existing' && hasRemote ? baseBranch || null : null,
      mode,
      agentCli,
      executionAgentCli,
      roleId,
      reviewerRoleId,
      workspaceId
    )
  }

  const selectedRole = roles.find((r) => r.id === roleId) ?? null
  const selectedReviewerRole = roles.find((r) => r.id === reviewerRoleId) ?? null

  // ── Shared JSX blocks (closure over local state) ────────────────────────

  const projectSettingsBlock = (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          專案類型
        </span>
        <ProjectTypeToggle
          mode={mode}
          onChange={handleModeChange}
          disabled={creating || loadingInfo || initializing}
        />
      </div>

      <div className="space-y-1.5">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {mode === 'new' ? '專案位置' : '專案資料夾'}
        </span>
        <FolderPickerZone
          mode={mode}
          projectPath={projectPath}
          disabled={creating || initializing || loadingInfo}
          onPick={handlePick}
        />
      </div>

      {(loadingInfo || initializing) && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
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
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <GitBranch className="size-3" />
            基準分支 (Base Branch)
          </span>
          <select
            name="base-branch"
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

      {isRepo && !hasRemote && (
        <p className="text-xs text-muted-foreground">
          此 repository 沒有 remote，將以目前分支 ({gitInfo?.currentBranch ?? 'HEAD'})
          為基準建立本地 worktree。
        </p>
      )}
    </div>
  )

  const workspaceBlock = (
    <div className="space-y-1.5">
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Layers className="size-3" />
        Workspace（選填）
      </span>
      {workspaces.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          尚無 Workspace — 可在側邊欄新增後再指派。
        </p>
      ) : (
        <>
          <select
            name="workspace"
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
            className={F}
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
              Agent 將在開始前讀取 context.md，並在完成後更新它。
            </p>
          )}
        </>
      )}
    </div>
  )

  const rolesCard = (
    <div className="space-y-3 rounded-lg border border-border/50 p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          角色設定
        </p>
        <button
          type="button"
          onClick={onManageRoles}
          className="text-xs text-primary hover:underline"
        >
          管理角色
        </button>
      </div>
      <div className="grid grid-cols-2 gap-4">
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
              name="role"
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
        </div>

        <div className="space-y-1.5">
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <ShieldCheck className="size-3" />
            Code Reviewer
          </span>
          <div className="flex items-center gap-2">
            {selectedReviewerRole && (
              <RoleAvatar role={selectedReviewerRole} className="size-6 shrink-0 text-[10px]" />
            )}
            <select
              name="reviewer-role"
              value={reviewerRoleId}
              onChange={(e) => setReviewerRoleId(e.target.value)}
              className={F}
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
              {selectedReviewerRole.name} 會自動審查並來回修正（須開啟 Auto Mode）。
            </p>
          )}
        </div>
      </div>
    </div>
  )

  const advancedSettingsBlock = (
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
            onAgentChange={setAgentCli}
          />
          <AgentModelFields
            title="Execution Agent"
            agents={agents}
            detectTimedOut={detectTimedOut}
            onRetry={() => setDetectKey((k) => k + 1)}
            agentCli={executionAgentCli}
            onAgentChange={setExecutionAgentCli}
          />
          {rolesCard}
          {workspaceBlock}
        </div>
      )}
    </div>
  )

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold tracking-tight">新增任務</h2>
        {onClose && (
          <IconButton
            aria-label="關閉新增任務"
            onClick={onClose}
            disabled={creating}
            className="p-1"
          >
            <X className="size-4" />
          </IconButton>
        )}
      </div>

      {/* Step indicator (modal mode only) */}
      {!inline && (
        <div className="mb-5 flex items-center gap-2">
          <div
            className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors',
              step === 1
                ? 'bg-primary text-primary-foreground'
                : 'bg-primary/20 text-primary'
            )}
          >
            {step > 1 ? <Check className="size-3.5" strokeWidth={3} /> : '1'}
          </div>
          <span
            className={cn(
              'text-sm tracking-[-0.224px]',
              step === 1 ? 'font-medium text-foreground' : 'text-muted-foreground'
            )}
          >
            專案設定
          </span>
          <div
            className={cn(
              'h-0.5 flex-1 transition-colors',
              step > 1 ? 'bg-primary/60' : 'bg-border'
            )}
          />
          <div
            className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors',
              step === 2
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground'
            )}
          >
            2
          </div>
          <span
            className={cn(
              'text-sm tracking-[-0.224px]',
              step === 2 ? 'font-medium text-foreground' : 'text-muted-foreground'
            )}
          >
            任務內容
          </span>
        </div>
      )}

      {/* Inline mode: title at top, then 2-col grid */}
      {inline && (
        <>
          <label className="mb-5 block space-y-1.5">
            <span className="text-sm font-medium">任務標題</span>
            <input
              ref={titleRef}
              name="task-title"
              autoComplete="off"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：實作登入頁面"
              className={cn(F, 'text-base')}
            />
          </label>

          <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
            {/* Left: project settings + workspace */}
            <div className="space-y-4">
              {projectSettingsBlock}
            </div>

            {/* Right: description + agents + roles */}
            <div className="space-y-4">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">詳細描述（選填）</span>
                <textarea
                  name="task-description"
                  autoComplete="off"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={5}
                  placeholder="描述這個任務的目標、需求或背景脈絡…"
                  className={cn(F, 'resize-y')}
                />
              </label>

              {error && (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                  {error}
                </p>
              )}
            </div>
          </div>
          <div className="mt-5">
            {advancedSettingsBlock}
          </div>
        </>
      )}

      {/* Modal mode: step-based layout */}
      {!inline && (
        <div>
          {/* Step 1: project folder + base branch */}
          {step === 1 && <div className="space-y-4">{projectSettingsBlock}</div>}

          {/* Step 2: task details, agents, roles, workspace */}
          {step === 2 && (
            <div className="space-y-4">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">任務標題</span>
                <input
                  ref={titleRef}
                  name="task-title"
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
                  value={description}
                  name="task-description"
                  autoComplete="off"
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  placeholder="描述這個任務的目標、需求或背景脈絡…"
                  className={cn(F, 'resize-y')}
                />
              </label>

              {advancedSettingsBlock}

              {error && (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                  {error}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Footer buttons */}
      {inline ? (
        <div className="mt-6 space-y-2">
          {!isProjectReady && title.trim().length > 0 && (
            <p className="text-right text-xs text-muted-foreground">
              請先在左側選擇專案資料夾
            </p>
          )}
          <div className="flex justify-end gap-2">
            {onClose && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                disabled={creating}
                className="rounded-full"
              >
                取消
              </Button>
            )}
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className={cn(
                'rounded-full px-5 active:scale-95 transition-transform',
                creating && 'opacity-80'
              )}
            >
              {creating && <Loader2 className="animate-spin" />}
              {creating ? '建立 Worktree 中…' : '建立任務'}
            </Button>
          </div>
        </div>
      ) : step === 1 ? (
        <div className="mt-5 flex justify-end gap-2">
          {onClose && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={creating}
              className="rounded-full"
            >
              取消
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => setStep(2)}
            disabled={!canGoToStep2}
            className="rounded-full px-5"
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
            className="rounded-full"
          >
            ← 上一步
          </Button>
          <div className="flex gap-2">
            {onClose && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                disabled={creating}
                className="rounded-full"
              >
                取消
              </Button>
            )}
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className={cn(
                'rounded-full px-5 active:scale-95 transition-transform',
                creating && 'opacity-80'
              )}
            >
              {creating && <Loader2 className="animate-spin" />}
              {creating ? '建立 Worktree 中…' : '建立任務'}
            </Button>
          </div>
        </div>
      )}
    </>
  )
}

// ── Dialog wrapper ─────────────────────────────────────────────────────────
interface NewTaskDialogProps extends NewTaskFormProps {
  open: boolean
}

export function NewTaskDialog({
  open,
  creating,
  onClose,
  ...rest
}: NewTaskDialogProps) {
  if (!open) return null
  const handleClose = onClose ?? (() => {})
  return (
    <DialogShell
      title="新增任務"
      saving={creating}
      onClose={handleClose}
      contentClassName="max-w-md rounded-xl p-5"
    >
      <NewTaskForm creating={creating} onClose={onClose} {...rest} />
    </DialogShell>
  )
}
