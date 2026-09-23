import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import {
  Bot,
  ChevronDown,
  Check,
  FileUp,
  GitBranch,
  Info,
  Loader2,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { DialogShell } from '@/components/ui/dialog-shell'
import { fieldClass } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import {
  DEFAULT_TASK_EFFORT,
  TaskEffortSlider,
} from '@/components/task-effort-slider'
import { TaskAutoModeToggle } from '@/components/task-auto-mode-toggle'
import {
  ProjectFolderPicker,
  isProjectMissing,
} from '@/components/project-folder-picker'
import { filesToAttachmentInputs } from '@/lib/file-attachments'
import { createEnterVariants, createPresenceVariants } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { basenameFromPath as basename } from '@/lib/workspace-path'
import type {
  AgentCli,
  AgentCliId,
  AgentEffort,
  AgentConnections,
  AttachmentInput,
  GitInfo,
  RecentProjectEntry,
} from '@/lib/types'

interface AttachmentItem {
  id: number
  input: AttachmentInput
}

export interface NewTaskFormProps {
  creating: boolean
  error: string | null
  pickFolder: () => Promise<string | null>
  loadRecentProjects: () => Promise<RecentProjectEntry[]>
  loadGitInfo: (projectPath: string) => Promise<GitInfo | null>
  initRepository: (projectPath: string) => Promise<GitInfo | null>
  detectAgents: () => Promise<AgentCli[]>
  agentConnections?: AgentConnections
  onSubmit: (
    title: string,
    description: string,
    projectPath: string,
    baseBranch: string | null,
    branch: string,
    agentCli: AgentCliId,
    model: string,
    effort: AgentEffort,
    autoMode: boolean,
    attachments: AttachmentInput[]
  ) => void
  onClose?: () => void
  /** Render as a full-height inline panel instead of a compact modal form. */
  inline?: boolean
  /**
   * Pre-fill an existing project folder on mount (inline mode) — triggers the
   * same git detection + workspace auto-match as manually picking the folder.
   */
  initialProjectPath?: string | null
  /** Board-wide Auto Mode, used as the new card's starting value. */
  defaultAutoMode?: boolean
  /** Workstation root, so the form can name where the worktree will land. */
  workstationPath?: string
}

// Shared field class now lives in ui/field.tsx (single source of truth).
// Re-exported as `F` for backwards-compatible imports (e.g. edit-task-dialog).
export const F = fieldClass

function InlineEnterSurface({
  show,
  enabled,
  id,
  className,
  children,
}: {
  show: boolean
  enabled: boolean
  id?: string
  className?: string
  children: ReactNode
}) {
  const reducedMotion = useReducedMotion() ?? false

  if (!show) return null
  if (!enabled) {
    return (
      <div id={id} className={className}>
        {children}
      </div>
    )
  }

  return (
    <motion.div
      id={id}
      initial="hidden"
      animate="visible"
      variants={createEnterVariants({
        timing: 'standard',
        transform: { y: -4 },
        reducedMotion,
      })}
      className={className}
    >
      {children}
    </motion.div>
  )
}

function AttachmentRow({
  attachment,
  id,
  creating,
  animated,
  onRemove,
}: {
  attachment: AttachmentInput
  id: number
  creating: boolean
  animated: boolean
  onRemove: (id: number) => void
}) {
  const isPresent = useIsPresent()
  const reducedMotion = useReducedMotion() ?? false
  const content = (
    <>
      <FileUp className="size-3.5 shrink-0 text-primary" />
      <span className="min-w-0 flex-1 truncate text-sm" title={attachment.name}>
        {attachment.name}
      </span>
      <IconButton
        aria-label={`移除附件 ${attachment.name}`}
        onClick={() => onRemove(id)}
        disabled={creating}
        className="p-1"
      >
        <X className="size-3.5" />
      </IconButton>
    </>
  )

  if (!animated) {
    return (
      <li className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2">
        {content}
      </li>
    )
  }

  return (
    <motion.li
      initial="hidden"
      animate="visible"
      exit="exit"
      variants={createPresenceVariants({
        timing: 'micro',
        transform: { y: 4 },
        reducedMotion,
      })}
      inert={!isPresent}
      aria-hidden={!isPresent || undefined}
      className={cn(
        'flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2',
        !isPresent && 'pointer-events-none'
      )}
    >
      {content}
    </motion.li>
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
  model: string
  onModelChange: (model: string) => void
  agentConnections?: AgentConnections
}

export function AgentModelFields({
  title,
  agents,
  detectTimedOut,
  onRetry,
  agentCli,
  onAgentChange,
  model,
  onModelChange,
  agentConnections,
}: AgentModelFieldsProps) {
  const connectableAgent = agentCli === 'claude' || agentCli === 'codex' ? agentCli : null
  const fetchedModels = connectableAgent
    ? agentConnections?.[connectableAgent]?.models ?? []
    : []
  const modelOptions = model && !fetchedModels.includes(model)
    ? [model, ...fetchedModels]
    : fetchedModels
  const canSelectModel = modelOptions.length > 0
  return (
    <div className="space-y-3 rounded-lg border border-border/50 p-4">
      <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <div className="space-y-1.5">
        <span className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
          <Bot className="size-3" />
          Agent CLI
        </span>
        {agents === null ? (
          detectTimedOut ? (
            <div className="space-y-1">
              <p className="text-sm text-destructive">偵測逾時，請確認 Agent CLI 已安裝。</p>
              <button
                type="button"
                onClick={onRetry}
                className="rounded-sm text-sm text-primary underline outline-none hover:no-underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                重新偵測
              </button>
            </div>
          ) : (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              偵測中…
            </p>
          )
        ) : agents.length === 0 ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm">
            未偵測到 Agent CLI（claude / codex）。
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
      <div className="space-y-1.5">
        <span className="text-sm font-medium text-muted-foreground">Model</span>
        {canSelectModel ? (
          <select
            name={`${title.toLowerCase().replace(/\s+/g, '-')}-model`}
            value={model}
            onChange={(e) => onModelChange(e.target.value)}
            className={F}
          >
            <option value="">使用預設 model</option>
            {modelOptions.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        ) : (
          <p className="rounded-md border border-border/50 bg-muted/20 p-2 text-sm text-muted-foreground">
            尚未連線或無法取得 model list，將使用預設 model。
          </p>
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
  loadRecentProjects,
  loadGitInfo,
  initRepository,
  detectAgents,
  agentConnections,
  onSubmit,
  onClose,
  inline = false,
  initialProjectPath,
  defaultAutoMode = true,
  workstationPath,
}: NewTaskFormProps) {
  const [step, setStep] = useState<1 | 2>(1)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const [recentProjects, setRecentProjects] = useState<RecentProjectEntry[]>([])
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null)
  const [loadingInfo, setLoadingInfo] = useState(false)
  const [initializing, setInitializing] = useState(false)
  const [baseBranch, setBaseBranch] = useState('')
  const [branch, setBranch] = useState('')
  const [agents, setAgents] = useState<AgentCli[] | null>(null)
  const [detectTimedOut, setDetectTimedOut] = useState(false)
  const [detectKey, setDetectKey] = useState(0)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [agentCli, setAgentCli] = useState<AgentCliId>('claude')
  const [model, setModel] = useState('')
  const [effort, setEffort] = useState<AgentEffort>(DEFAULT_TASK_EFFORT)
  const [autoMode, setAutoMode] = useState(defaultAutoMode)
  const [attachments, setAttachments] = useState<AttachmentItem[]>([])
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [isDraggingAttachment, setIsDraggingAttachment] = useState(false)
  const [isReadingAttachments, setIsReadingAttachments] = useState(false)

  const advancedContentId = useId()
  const nextAttachmentIdRef = useRef(0)
  const titleRef = useRef<HTMLInputElement>(null)
  const attachmentInputRef = useRef<HTMLInputElement>(null)

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

  useEffect(() => {
    let active = true
    void loadRecentProjects().then((list) => {
      if (active) setRecentProjects(list)
    })
    return () => {
      active = false
    }
  }, [loadRecentProjects])

  const projectMissing = isProjectMissing(recentProjects, projectPath)

  const detectGit = async (path: string) => {
    setProjectPath(path)
    setGitInfo(null)
    setBaseBranch('')
    setLoadingInfo(true)
    try {
      const info = await loadGitInfo(path)
      setGitInfo(info)
      setBaseBranch(info?.defaultBase ?? '')
    } finally {
      setLoadingInfo(false)
    }
  }

  // Shared by the recent-project select and the initialProjectPath prefill.
  const loadProject = async (path: string) => {
    if (isProjectMissing(recentProjects, path)) {
      setProjectPath(path)
      setGitInfo(null)
      setBaseBranch('')
      return
    }
    await detectGit(path)
  }

  const handleBrowse = async () => {
    const path = await pickFolder()
    if (!path) return
    // The picked folder exists, so a stale "missing" flag on it must go.
    setRecentProjects((list) =>
      list.map((p) => (p.path === path ? { ...p, missing: false } : p))
    )
    await detectGit(path)
  }

  const handleInitRepository = async () => {
    if (!projectPath) return
    setInitializing(true)
    try {
      const info = await initRepository(projectPath)
      setGitInfo(info)
      setBaseBranch(info?.defaultBase ?? '')
    } finally {
      setInitializing(false)
    }
  }

  // Inline mode: prefill the given existing project on mount (from the sidebar's
  // per-project「新增任務」entry). Runs once.
  useEffect(() => {
    if (inline && initialProjectPath) void loadProject(initialProjectPath)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isRepo = gitInfo?.isRepo ?? false
  const hasRemote = gitInfo?.hasRemote ?? false
  const workspaceDisplayPath = `${workstationPath?.trim() || '~/Desktop'}/${
    projectPath ? basename(projectPath) : '<專案名>'
  }`

  const isProjectReady =
    Boolean(projectPath) && !projectMissing && isRepo && !loadingInfo && !initializing

  const canGoToStep2 = isProjectReady
  const canSubmit =
    title.trim().length > 0 && !creating && !isReadingAttachments && (inline ? isProjectReady : true)

  const handleSubmit = () => {
    if (!canSubmit || !projectPath) return
    onSubmit(
      title.trim(),
      description.trim(),
      projectPath,
      hasRemote ? baseBranch || null : null,
      branch.trim(),
      agentCli,
      model,
      effort,
      autoMode,
      attachments.map(({ input }) => input)
    )
  }

  const addAttachments = async (files: FileList | File[]) => {
    setAttachmentError(null)
    setIsReadingAttachments(true)
    try {
      const inputs = await filesToAttachmentInputs(files)
      const items = inputs.map((input) => ({
        id: nextAttachmentIdRef.current++,
        input,
      }))
      setAttachments((current) => [...current, ...items])
    } catch (err) {
      setAttachmentError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsReadingAttachments(false)
    }
  }

  // ── Shared JSX blocks (closure over local state) ────────────────────────

  const projectSettingsBlock = (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <span className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          專案資料夾
        </span>
        <ProjectFolderPicker
          projectPath={projectPath}
          recentProjects={recentProjects}
          disabled={creating || initializing || loadingInfo}
          onSelect={(path) => void loadProject(path)}
          onBrowse={() => void handleBrowse()}
        />
      </div>

      <InlineEnterSurface
        show={loadingInfo || initializing}
        enabled={inline}
      >
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          {initializing ? '初始化 Git…' : '偵測 Git 狀態中…'}
        </p>
      </InlineEnterSurface>

      <InlineEnterSurface
        show={Boolean(gitInfo) && !projectMissing && !loadingInfo && !initializing && !isRepo}
        enabled={inline}
      >
        <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-3">
          <p className="text-base">
            這個資料夾不是 Git repository。請改選一個 Git 專案，或在這裡初始化：會執行
            <code className="text-foreground"> git init </code>並建立一個空的初始 commit。
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void handleInitRepository()}
            disabled={creating}
            className="rounded-full"
          >
            初始化 Git
          </Button>
        </div>
      </InlineEnterSurface>

      <InlineEnterSurface show={isRepo && hasRemote} enabled={inline}>
        <label className="block space-y-1.5">
          <span className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
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
      </InlineEnterSurface>

      <InlineEnterSurface show={isRepo && !hasRemote} enabled={inline}>
        <p className="text-sm text-muted-foreground">
          此 repository 沒有 remote，將以目前分支 ({gitInfo?.currentBranch ?? 'HEAD'})
          為基準建立本地 worktree。
        </p>
      </InlineEnterSurface>

      <InlineEnterSurface show={isRepo} enabled={inline}>
        <label className="block space-y-1.5">
          <span className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            <GitBranch className="size-3" />
            分支名稱 (選填)
          </span>
          <input
            name="branch"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder="留空則自動命名，例如 feature/login-fix"
            className={F}
          />
          <span className="block text-sm text-muted-foreground">
            {hasRemote
              ? '填寫後會建立同名分支；若 remote 已有這個分支，則直接取回並接續上面的工作。'
              : '填寫後會建立同名分支。'}
          </span>
        </label>
      </InlineEnterSurface>

      <InlineEnterSurface show={isRepo} enabled={inline}>
        <div className="space-y-1.5 rounded-lg border border-border/50 bg-muted/20 p-4">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <Info className="size-3.5 text-muted-foreground" />
            建立後會立刻做這些事
          </span>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>
              在 <code className="text-foreground">{workspaceDisplayPath}</code>{' '}
              底下建立這張卡專用的 worktree 與分支，你的專案資料夾本身不會被切換。
            </li>
            {hasRemote && (
              <li>把新分支 push 到 origin；遠端會多出一條分支，有 CI 的話可能被觸發。</li>
            )}
            <li>
              把被 git 忽略的檔案（例如 <code className="text-foreground">.env</code>）複製一份進
              worktree，相依套件資料夾則在背景複製，好讓新 worktree 能直接跑起來。
            </li>
            <li>
              把 VibeFlow 的執行期檔案寫進{' '}
              <code className="text-foreground">.git/info/exclude</code>，不會動到專案的
              .gitignore。
            </li>
          </ul>
        </div>
      </InlineEnterSurface>
    </div>
  )

  const advancedSettingsBlock = (
    <div className="rounded-lg border border-border/50">
      <button
        type="button"
        aria-expanded={advancedOpen}
        aria-controls={advancedContentId}
        onClick={() => setAdvancedOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-base font-medium transition-colors motion-reduce:transition-none outline-none hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span>Advanced</span>
        <ChevronDown
          className={cn(
            'size-4 text-muted-foreground transition-transform motion-reduce:transform-none motion-reduce:transition-none',
            advancedOpen && 'rotate-180'
          )}
        />
      </button>
      <InlineEnterSurface
        show={advancedOpen}
        enabled={inline}
        id={advancedContentId}
        className="space-y-4 border-t border-border/50 p-4"
      >
          <AgentModelFields
            title="Agent"
            agents={agents}
            detectTimedOut={detectTimedOut}
            onRetry={() => setDetectKey((k) => k + 1)}
            agentCli={agentCli}
            onAgentChange={(next) => {
              setAgentCli(next)
              setModel('')
            }}
            model={model}
            onModelChange={setModel}
            agentConnections={agentConnections}
          />
      </InlineEnterSurface>
    </div>
  )

  const attachmentsBlock = (
    <div className="space-y-2">
      <span className="text-base font-medium">附件（選填）</span>
      <button
        type="button"
        disabled={creating || isReadingAttachments}
        onClick={() => attachmentInputRef.current?.click()}
        onDragEnter={(event) => {
          event.preventDefault()
          if (!creating && !isReadingAttachments) setIsDraggingAttachment(true)
        }}
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }}
        onDragLeave={() => setIsDraggingAttachment(false)}
        onDrop={(event) => {
          event.preventDefault()
          setIsDraggingAttachment(false)
          if (!creating && !isReadingAttachments && event.dataTransfer.files.length > 0) {
            void addAttachments(event.dataTransfer.files)
          }
        }}
        className={cn(
          'flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border py-5 text-muted-foreground outline-none transition-colors motion-reduce:transition-none hover:border-primary/50 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
          isDraggingAttachment && 'border-primary/70 bg-primary/5 text-foreground'
        )}
      >
        <FileUp className="size-5" />
        <span className="text-sm">拖放檔案到這裡，或點擊選擇檔案</span>
      </button>
      <input
        ref={attachmentInputRef}
        type="file"
        multiple
        disabled={creating || isReadingAttachments}
        className="hidden"
        onChange={(event) => {
          if (event.target.files) void addAttachments(event.target.files)
          event.target.value = ''
        }}
      />
      {isReadingAttachments && (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          讀取附件中…
        </p>
      )}
      <ul className="space-y-1.5">
        <AnimatePresence initial={false}>
          {attachments.map(({ id, input }) => (
            <AttachmentRow
              key={id}
              attachment={input}
              id={id}
              creating={creating}
              animated={inline}
              onRemove={(removeId) =>
                setAttachments((current) =>
                  current.filter((item) => item.id !== removeId)
                )
              }
            />
          ))}
        </AnimatePresence>
      </ul>
      {attachmentError && (
        <p className="text-sm text-destructive">{attachmentError}</p>
      )}
    </div>
  )

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">新增任務</h2>
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
              'flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-colors',
              step === 1
                ? 'bg-primary text-primary-foreground'
                : 'bg-primary/20 text-primary'
            )}
          >
            {step > 1 ? <Check className="size-3.5" strokeWidth={3} /> : '1'}
          </div>
          <span
            className={cn(
              'text-base tracking-[-0.224px]',
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
              'flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-colors',
              step === 2
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground'
            )}
          >
            2
          </div>
          <span
            className={cn(
              'text-base tracking-[-0.224px]',
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
            <span className="text-base font-medium">任務標題</span>
            <input
              ref={titleRef}
              name="task-title"
              autoComplete="off"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：實作登入頁面"
              className={cn(F, 'text-lg')}
            />
          </label>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            {/* Left: project settings + attachments */}
            <div className="space-y-4">
              {projectSettingsBlock}
              {attachmentsBlock}
            </div>

            {/* Right: description */}
            <div className="flex h-full flex-col gap-4">
              <label className="flex min-h-0 flex-1 flex-col gap-1.5">
                <span className="text-base font-medium">詳細描述（選填）</span>
                <textarea
                  name="task-description"
                  autoComplete="off"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={12}
                  placeholder="描述這個任務的目標、需求或背景脈絡…"
                  className={cn(F, 'mb-2 min-h-64 flex-1 resize-y')}
                />
              </label>

              <TaskEffortSlider
                value={effort}
                onChange={setEffort}
                disabled={creating}
              />

              <TaskAutoModeToggle
                value={autoMode}
                onChange={setAutoMode}
                disabled={creating}
              />

              {error && (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-base">
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

          {/* Step 2: task details, agents, workspace */}
          {step === 2 && (
            <div className="space-y-4">
              <label className="block space-y-1.5">
                <span className="text-base font-medium">任務標題</span>
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
                <span className="text-base font-medium">詳細描述（選填）</span>
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

              <TaskEffortSlider
                value={effort}
                onChange={setEffort}
                disabled={creating}
              />

              <TaskAutoModeToggle
                value={autoMode}
                onChange={setAutoMode}
                disabled={creating}
              />

              {attachmentsBlock}

              {advancedSettingsBlock}

              {error && (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-base">
                  {error}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Footer buttons */}
      {inline ? (
        <div className="mt-6 space-y-2 pb-10">
          {!isProjectReady && title.trim().length > 0 && (
            <p className="text-right text-sm text-muted-foreground">
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
                'rounded-full px-5 active:scale-95 transition-transform motion-reduce:transform-none motion-reduce:transition-none',
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
                'rounded-full px-5 active:scale-95 transition-transform motion-reduce:transform-none motion-reduce:transition-none',
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
      contentClassName="max-w-md rounded-lg p-5"
    >
      <NewTaskForm creating={creating} onClose={onClose} {...rest} />
    </DialogShell>
  )
}
