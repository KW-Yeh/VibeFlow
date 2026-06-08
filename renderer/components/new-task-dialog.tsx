import { useEffect, useState } from 'react'
import {
  Bot,
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
import type { AgentCli, AgentCliId, GitInfo, Role } from '@/lib/types'

interface NewTaskDialogProps {
  open: boolean
  creating: boolean
  error: string | null
  pickFolder: () => Promise<string | null>
  loadGitInfo: (projectPath: string) => Promise<GitInfo | null>
  /** Agent CLIs detected on PATH (claude / codex / gemini). */
  detectAgents: () => Promise<AgentCli[]>
  /** Roles available for assignment ('' = use the default, no role). */
  roles: Role[]
  onManageRoles: () => void
  onSubmit: (
    title: string,
    description: string,
    projectPath: string,
    baseBranch: string | null,
    agentCli: AgentCliId,
    roleId: string,
    reviewerRoleId: string
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
  detectAgents,
  roles,
  onManageRoles,
  onSubmit,
  onClose,
}: NewTaskDialogProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null)
  const [loadingInfo, setLoadingInfo] = useState(false)
  const [baseBranch, setBaseBranch] = useState('')
  // null = detection still running; [] = none found on PATH.
  const [agents, setAgents] = useState<AgentCli[] | null>(null)
  const [agentCli, setAgentCli] = useState<AgentCliId>('claude')
  // '' = no role assigned (default behavior).
  const [roleId, setRoleId] = useState('')
  // '' = no reviewer; setting one turns the task into a review pipeline.
  const [reviewerRoleId, setReviewerRoleId] = useState('')

  // Reset everything whenever the dialog opens, and (re-)detect the agent
  // CLIs available in the current environment.
  useEffect(() => {
    if (!open) return
    setTitle('')
    setDescription('')
    setProjectPath(null)
    setGitInfo(null)
    setLoadingInfo(false)
    setBaseBranch('')
    setAgents(null)
    setAgentCli('claude')
    setRoleId('')
    setReviewerRoleId('')
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

  if (!open) return null

  const handlePick = async () => {
    const path = await pickFolder()
    if (!path) return
    setProjectPath(path)
    setGitInfo(null)
    setLoadingInfo(true)
    try {
      const info = await loadGitInfo(path)
      setGitInfo(info)
      setBaseBranch(info?.defaultBase ?? '')
    } finally {
      setLoadingInfo(false)
    }
  }

  const isRepo = gitInfo?.isRepo ?? false
  const hasRemote = gitInfo?.hasRemote ?? false
  const canSubmit =
    Boolean(projectPath) &&
    isRepo &&
    title.trim().length > 0 &&
    !creating &&
    !loadingInfo

  const handleSubmit = () => {
    if (!canSubmit || !projectPath) return
    onSubmit(
      title.trim(),
      description.trim(),
      projectPath,
      hasRemote ? baseBranch || null : null,
      agentCli,
      roleId,
      reviewerRoleId
    )
  }

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

        <div className="space-y-4">
          {/* Project folder picker (per task) */}
          <div className="space-y-1.5">
            <span className="text-sm font-medium">專案資料夾</span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePick}
                disabled={creating}
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
          </div>

          {loadingInfo && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              偵測 Git 狀態中…
            </p>
          )}

          {projectPath && !loadingInfo && !isRepo && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
              這個資料夾不是 Git repository，請改選一個 Git 專案。
            </p>
          )}

          {isRepo && (
            <>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">任務標題</span>
                <input
                  autoFocus
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

              {hasRemote ? (
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
              ) : (
                <p className="text-xs text-muted-foreground">
                  此 repository 沒有 remote，將以目前分支 (
                  {gitInfo?.currentBranch ?? 'HEAD'}) 為基準建立本地 worktree。
                </p>
              )}

              {/* Agent CLI — only agents actually installed on PATH show up. */}
              <div className="space-y-1.5">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <Bot className="size-3.5" />
                  Agent CLI
                </span>
                {agents === null ? (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" />
                    偵測可用的 Agent CLI 中…
                  </p>
                ) : agents.length === 0 ? (
                  <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs">
                    未在環境中偵測到任何 Agent CLI（claude / codex /
                    gemini），任務建立後將無法自動執行。
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

              {/* Role assignment — optional; blank uses the default behavior. */}
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
                    <RoleAvatar
                      role={selectedRole}
                      className="size-8 text-sm"
                    />
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

              {/* Reviewer assignment — selecting one turns the task into a
                  pipeline: the executor's completion auto-triggers a Code
                  Reviewer pass, looping until it approves. */}
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
            </>
          )}

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm">
              {error}
            </p>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
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
    </div>
  )
}
