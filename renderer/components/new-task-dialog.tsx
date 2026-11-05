import { useEffect, useRef, useState } from 'react'
import { FileUp, FolderOpen, GitBranch, Loader2, Network, Paperclip, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { fieldClass } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { DEFAULT_TASK_EFFORT } from '@/components/task-effort-slider'
import { Select } from '@/components/ui/select'
import {
  ProjectFolderPicker,
  isProjectMissing,
} from '@/components/project-folder-picker'
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
import { filesToAttachmentInputs } from '@/lib/file-attachments'
import { cn } from '@/lib/utils'
import { basenameFromPath as basename } from '@/lib/workspace-path'
import type {
  AgentCli,
  AgentCliId,
  AgentEffort,
  AttachmentInput,
  GitInfo,
  GithubRef,
  JiraRef,
  RecentProjectEntry,
} from '@/lib/types'

interface AttachmentItem {
  id: number
  input: AttachmentInput
}

/** Everything the form collected, for `createTask`. */
export interface NewTaskDraft {
  title: string
  description: string
  /** `master` = a repo-less orchestrator card; absent = an ordinary card. */
  role?: 'master'
  /** Ordinary cards only. */
  projectPath?: string
  baseBranch: string | null
  branch: string
  /** Master only: its own folder; absent = one VibeFlow creates. */
  workDir?: string
  /** Ordinary cards only: the master to dispatch it under. */
  masterId?: string
  agentCli: AgentCliId
  model: string
  effort: AgentEffort
  autoMode: boolean
  attachments: AttachmentInput[]
  /** The inbox item the card was made from. */
  github?: GithubRef
  jira?: JiraRef
}

/** What the form starts with when a card is made from an inbox item. */
export interface NewTaskInitial {
  title: string
  description: string
  projectPath?: string
  branch?: string
  baseBranch?: string
  github?: GithubRef
  jira?: JiraRef
}

type CardRole = 'task' | 'master'

export interface NewTaskDialogProps {
  creating: boolean
  error: string | null
  pickFolder: () => Promise<string | null>
  loadRecentProjects: () => Promise<RecentProjectEntry[]>
  loadGitInfo: (projectPath: string) => Promise<GitInfo | null>
  initRepository: (projectPath: string) => Promise<GitInfo | null>
  detectAgents: () => Promise<AgentCli[]>
  onSubmit: (draft: NewTaskDraft) => void
  onClose: () => void
  /** Master cards a new card can be dispatched under. */
  masters?: Array<{ id: string; title: string }>
  /** Board-wide Auto Mode, used as the new card's starting value. */
  defaultAutoMode?: boolean
  /** Workstation root, so the form can name where the worktree will land. */
  workstationPath?: string
  initial?: NewTaskInitial
}

export function NewTaskDialog({
  creating,
  error,
  pickFolder,
  loadRecentProjects,
  loadGitInfo,
  initRepository,
  detectAgents,
  onSubmit,
  onClose,
  masters = [],
  defaultAutoMode = true,
  workstationPath,
  initial,
}: NewTaskDialogProps) {
  const [role, setRole] = useState<CardRole>('task')
  const [workDir, setWorkDir] = useState('')
  const [masterId, setMasterId] = useState('')
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const [recentProjects, setRecentProjects] = useState<RecentProjectEntry[]>([])
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null)
  const [loadingInfo, setLoadingInfo] = useState(false)
  const [initializing, setInitializing] = useState(false)
  const [baseBranch, setBaseBranch] = useState('')
  const [branch, setBranch] = useState(initial?.branch ?? '')
  const [agents, setAgents] = useState<AgentCli[] | null>(null)
  const [detectTimedOut, setDetectTimedOut] = useState(false)
  const [detectKey, setDetectKey] = useState(0)
  const [agentCli, setAgentCli] = useState<AgentCliId>('claude')
  const [model, setModel] = useState('')
  const [effort, setEffort] = useState<AgentEffort>(DEFAULT_TASK_EFFORT)
  const models = useAgentModels(agentCli)
  const effortLevels = useModelEfforts(models, agentCli, model, effort, setEffort)
  const [autoMode, setAutoMode] = useState(defaultAutoMode)
  const [attachments, setAttachments] = useState<AttachmentItem[]>([])
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [isDraggingAttachment, setIsDraggingAttachment] = useState(false)
  const [isReadingAttachments, setIsReadingAttachments] = useState(false)

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
    titleRef.current?.focus()
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

  const initialProject = initial?.projectPath
  useEffect(() => {
    if (initialProject) void detectGit(initialProject)
  }, [initialProject])

  const detectGit = async (path: string) => {
    setProjectPath(path)
    setGitInfo(null)
    setBaseBranch('')
    setLoadingInfo(true)
    try {
      const info = await loadGitInfo(path)
      setGitInfo(info)
      const preferred = initial?.baseBranch
      setBaseBranch(preferred && info?.branches.includes(preferred) ? preferred : info?.defaultBase ?? '')
    } finally {
      setLoadingInfo(false)
    }
  }

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

  const handleBrowseWorkDir = async () => {
    const path = await pickFolder()
    if (path) setWorkDir(path)
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

  const isRepo = gitInfo?.isRepo ?? false
  const hasRemote = gitInfo?.hasRemote ?? false
  const workspaceDisplayPath = `${workstationPath?.trim() || '~/Desktop'}/${
    projectPath ? basename(projectPath) : '<專案名>'
  }`
  const isMaster = role === 'master'
  const isReady =
    isMaster ||
    (Boolean(projectPath) && !projectMissing && isRepo && !loadingInfo && !initializing)
  const canSubmit = title.trim().length > 0 && !creating && !isReadingAttachments && isReady
  const attachmentsLocked = creating || isReadingAttachments

  const handleSubmit = () => {
    if (!canSubmit || (!isMaster && !projectPath)) return
    const shared = {
      title: title.trim(),
      description: description.trim(),
      agentCli,
      model,
      effort,
      autoMode,
      attachments: attachments.map(({ input }) => input),
      ...(initial?.github ? { github: initial.github } : {}),
      ...(initial?.jira ? { jira: initial.jira } : {}),
    }
    onSubmit(
      isMaster
        ? { ...shared, role: 'master', baseBranch: null, branch: '', workDir: workDir.trim() || undefined }
        : {
            ...shared,
            projectPath: projectPath ?? undefined,
            baseBranch: hasRemote ? baseBranch || null : null,
            branch: branch.trim(),
            masterId: masterId || undefined,
          }
    )
  }

  const header = (
    <>
      <span className="text-sm text-muted-foreground">新增任務</span>
      <div
        role="radiogroup"
        aria-label="卡片角色"
        className="inline-flex rounded-full border border-border bg-muted/40 p-0.5"
      >
        {(['task', 'master'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={role === value}
            disabled={creating}
            onClick={() => setRole(value)}
            className={cn(
              'flex items-center gap-1.5 rounded-full px-3 py-1 text-sm outline-none transition-colors motion-reduce:transition-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              role === value
                ? value === 'master'
                  ? 'bg-master/15 text-master'
                  : 'bg-background text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {value === 'master' ? <Network className="size-3.5" /> : <GitBranch className="size-3.5" />}
            {value === 'master' ? 'Master' : '一般任務'}
          </button>
        ))}
      </div>
    </>
  )

  const content = (
    <div
      onDragEnter={(event) => {
        event.preventDefault()
        if (!attachmentsLocked) setIsDraggingAttachment(true)
      }}
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsDraggingAttachment(false)
        }
      }}
      onDrop={(event) => {
        event.preventDefault()
        setIsDraggingAttachment(false)
        if (!attachmentsLocked && event.dataTransfer.files.length > 0) {
          void addAttachments(event.dataTransfer.files)
        }
      }}
      className={cn(
        'flex min-h-0 flex-1 flex-col gap-3 rounded-lg',
        isDraggingAttachment && 'outline-2 outline-offset-4 outline-dashed outline-primary/70'
      )}
    >
      <input
        ref={titleRef}
        name="task-title"
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
        name="task-description"
        aria-label="詳細描述"
        autoComplete="off"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit()
        }}
        placeholder={
          isMaster
            ? '描述整體目標、涉及的 repo 與限制。Master 會先判斷要不要拆成多張卡…'
            : '描述這個任務的目標、需求或背景脈絡…（可以直接把檔案拖進來當附件）'
        }
        className={cn(fieldClass, 'min-h-32 flex-1 resize-none text-sm leading-6')}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => attachmentInputRef.current?.click()}
          disabled={attachmentsLocked}
          className="rounded-full"
        >
          <Paperclip />
          附件
        </Button>
        <input
          ref={attachmentInputRef}
          type="file"
          multiple
          disabled={attachmentsLocked}
          className="hidden"
          onChange={(event) => {
            if (event.target.files) void addAttachments(event.target.files)
            event.target.value = ''
          }}
        />
        {attachments.map(({ id, input }) => (
          <span
            key={id}
            className="flex max-w-56 items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 py-0.5 pl-2.5 pr-1 text-sm"
          >
            <FileUp className="size-3.5 shrink-0 text-primary" />
            <span className="min-w-0 truncate" title={input.name}>
              {input.name}
            </span>
            <IconButton
              aria-label={`移除附件 ${input.name}`}
              onClick={() => setAttachments((current) => current.filter((item) => item.id !== id))}
              disabled={creating}
              className="p-0.5"
            >
              <X className="size-3.5" />
            </IconButton>
          </span>
        ))}
        {isReadingAttachments && (
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            讀取附件中…
          </span>
        )}
      </div>
      {attachmentError && <p className="text-sm text-destructive">{attachmentError}</p>}
      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {error}
        </p>
      )}
    </div>
  )

  const locationGroup = isMaster ? (
    <PropertyGroup label="位置">
      <div className="space-y-1 px-1">
        <span className="text-sm text-muted-foreground">工作目錄</span>
        <div className="flex items-center gap-2">
          <input
            name="master-work-dir"
            aria-label="工作目錄"
            autoComplete="off"
            value={workDir}
            onChange={(e) => setWorkDir(e.target.value)}
            placeholder="留空則由 VibeFlow 建立"
            className={cn(ROW_FIELD, 'min-w-0 flex-1 font-mono')}
          />
          <IconButton
            aria-label="選擇工作目錄"
            title="選擇工作目錄"
            onClick={() => void handleBrowseWorkDir()}
            disabled={creating}
            tone="primary"
            className="rounded-md border border-border p-1.5"
          >
            <FolderOpen className="size-4" />
          </IconButton>
        </div>
      </div>
      <PropertyNote>
        <details>
          <summary className="cursor-pointer rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
            任何資料夾都可以，不建立分支或 worktree。
          </summary>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            <li>先判斷任務要不要拆卡，再為每個 repo 建立卡片，掛在這張 Master 底下。</li>
            <li>
              {autoMode
                ? 'Auto Mode 開啟：沒有前置依賴的卡片會直接開始執行。'
                : 'Auto Mode 關閉：派出的卡片留在 Backlog，由你決定何時開始。'}
            </li>
            <li>追蹤進度並回報；不會自己合併 PR 或把卡片移到 Done。</li>
          </ul>
        </details>
      </PropertyNote>
    </PropertyGroup>
  ) : (
    <PropertyGroup label="位置">
      <div className="space-y-1 px-1">
        <span className="text-sm text-muted-foreground">專案</span>
        <ProjectFolderPicker
          compact
          projectPath={projectPath}
          recentProjects={recentProjects}
          disabled={creating || initializing || loadingInfo}
          onSelect={(path) => void loadProject(path)}
          onBrowse={() => void handleBrowse()}
        />
      </div>
      {(loadingInfo || initializing) && (
        <PropertyNote>
          <span className="flex items-center gap-1.5">
            <Loader2 className="size-3 animate-spin" />
            {initializing ? '初始化 Git…' : '偵測 Git 狀態中…'}
          </span>
        </PropertyNote>
      )}
      {!projectPath && <PropertyNote>選擇專案後才能建立任務。</PropertyNote>}
      {gitInfo && !projectMissing && !loadingInfo && !initializing && !isRepo && (
        <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-sm">
          <p>
            這個資料夾不是 Git repository。可以在這裡初始化：會執行
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
      )}
      {isRepo && hasRemote && (
        <PropertyRow label="基準分支">
          <Select
            name="base-branch"
            aria-label="基準分支"
            value={baseBranch}
            onChange={setBaseBranch}
            className={ROW_FIELD}
            options={(gitInfo?.branches ?? []).map((b) => ({ value: b, label: b }))}
          />
        </PropertyRow>
      )}
      {isRepo && (
        <PropertyRow label="分支">
          <input
            name="branch"
            autoComplete="off"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder="留空則自動命名"
            className={ROW_FIELD}
          />
        </PropertyRow>
      )}
      {masters.length > 0 && (
        <PropertyRow label="隸屬於">
          <Select
            name="master-id"
            aria-label="隸屬於"
            value={masterId}
            onChange={setMasterId}
            className={ROW_FIELD}
            options={[{ value: '', label: '無' }, ...masters.map((m) => ({ value: m.id, label: m.title }))]}
          />
        </PropertyRow>
      )}
      {isRepo && (
        <PropertyNote>
          <details>
            <summary className="cursor-pointer rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              {hasRemote
                ? '開始執行時才建立分支與 worktree 並 push。'
                : `沒有 remote，開始執行時從 ${gitInfo?.currentBranch ?? 'HEAD'} 建立本地 worktree。`}
            </summary>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              <li>
                {hasRemote ? '從當下最新的 origin 基準分支' : '從基準分支'}，在{' '}
                <code className="break-all text-foreground">{workspaceDisplayPath}</code>{' '}
                底下建立這張卡專用的 worktree 與分支；專案資料夾本身不會被切換。
              </li>
              {hasRemote && (
                <li>
                  把新分支 push 到 origin；若 remote 已有同名分支，則取回並接續那條分支的工作。
                </li>
              )}
              <li>把被 git 忽略的檔案（例如 .env）複製進 worktree，相依套件資料夾在背景複製。</li>
              <li>VibeFlow 的執行期檔案寫進 .git/info/exclude，不動專案的 .gitignore。</li>
            </ul>
          </details>
        </PropertyNote>
      )}
    </PropertyGroup>
  )

  return (
    <TaskFormDialog
      title="新增任務"
      header={header}
      saving={creating}
      onClose={onClose}
      content={content}
      sidebar={
        <>
          {locationGroup}
          <RunSettingsGroup
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
            models={models}
            effort={effort}
            onEffortChange={setEffort}
            effortLevels={effortLevels}
            autoMode={autoMode}
            onAutoModeChange={setAutoMode}
            disabled={creating}
          />
        </>
      }
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={creating} className="flex-1 rounded-full">
            取消
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={cn('flex-[2] rounded-full', creating && 'opacity-80')}
          >
            {creating && <Loader2 className="animate-spin" />}
            {creating ? '建立中…' : isMaster ? '建立 Master' : '建立任務'}
          </Button>
        </>
      }
    />
  )
}
