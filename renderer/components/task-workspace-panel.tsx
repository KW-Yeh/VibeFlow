import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { AnimatePresence, LayoutGroup } from 'motion/react'
import { TabIndicator } from '@/components/ui/tab-indicator'

import {
  Check,
  ChevronRight,
  FileDiff,
  FileText,
  Film,
  FolderOpen,
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  GitCompare,
  GitPullRequest,
  Image as ImageIcon,
  Info,
  Layers,
  Loader2,
  Maximize2,
  Network,
  RefreshCw,
  PanelRightClose,
  Pin,
  Play,
  Trash2,
  X,
} from 'lucide-react'

import { MarkdownContent } from '@/components/markdown-content'
import { DiffEntryRow, DiffFileModal, DiffFileViewer, DiffViewToggles, MAX_DIFF_FILES, useDiffView } from '@/components/diff-file'
import { CommitDiffContent, DiffGroupToggle } from '@/components/commit-diff'
import { projectLabel, slaveState, TaskId, todoCount, type SlaveEntry } from '@/components/board-columns'
import { TaskTerminal } from '@/components/task-terminal'
import { StatusMark, TaskProgressChip, TaskProgressDetail } from '@/components/task-progress'
import { Button } from '@/components/ui/button'
import { DialogShell } from '@/components/ui/dialog-shell'
import { IconButton } from '@/components/ui/icon-button'
import { SECTION_LABEL } from '@/components/ui/section-label'
import { ZoomableImage } from '@/components/zoomable-image'
import { taskArtifactsDir } from '@/lib/claude'
import { jevResultLabel, jevRoutingLabel } from '@/lib/jev'
import {
  retainExistingDiffContents,
  sameDiffEntry,
  sameDiffFile,
  stabilizeDiffEntries,
} from '@/lib/diff-state'
import {
  getDiff,
  getDiffEntries,
  getDiffFile,
  listArtifacts,
  openArtifactsDir,
  openExternal,
  readArtifact,
} from '@/lib/api'
import { isModalOpen } from '@/lib/modal-presence'
import { cn } from '@/lib/utils'
import { CopyFeedbackIcon } from '@/components/ui/copy-feedback-icon'
import { HoldButton } from '@/components/ui/hold-button'
import type {
  ArtifactContent,
  ArtifactKind,
  DiffEntry,
  DiffFile,
  Task,
  TaskArtifact,
  TaskOutcome,
  LaunchIntent,
  TaskProgress,
} from '@/lib/types'

/** The aside's views of a running card. */
type TaskTab = 'slaves' | 'task' | 'artifacts' | 'diff'

const TAB_LABEL: Record<TaskTab, string> = {
  slaves: 'Slaves',
  task: '任務',
  artifacts: 'Artifacts',
  diff: 'Git diff',
}

const TASK_TABS: readonly TaskTab[] = ['task', 'artifacts', 'diff']
/** A master has no branch, so no diff; what it has is its slaves. */
const MASTER_TABS: readonly TaskTab[] = ['slaves', 'task', 'artifacts']

const ARTIFACT_KIND_LABEL: Record<ArtifactKind, string> = {
  image: '截圖',
  video: '影片',
  text: '文字',
  binary: '二進位',
}

/**
 * Whether a text artifact should be rendered as markdown rather than verbatim.
 * Decided from the filename because ArtifactKind ('image' | 'text' | 'binary')
 * crosses IPC as a public type and is not worth widening for a preview detail.
 */
function isMarkdownArtifact(name: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(name)
}

/**
 * Poll interval for the artifact list and the diff file list. Both reads are
 * local (the diff poll passes `fetch: false`), so this costs a readdir and a few
 * local git calls per tick.
 */
const POLL_INTERVAL_MS = 3000

/**
 * Width of the workspace's right column, in px. Renderer-local UI state (same
 * rationale as the board splitter: no store schema to migrate), held
 * as a CSS variable on <html> rather than React state so a drag repaints
 * without re-rendering every mounted task panel — and so all of them stay in
 * sync, since they read the same variable.
 *
 * The layout clamps it against the window in CSS (`max-w-[calc(100% - …)]`)
 * rather than in JS, so a window too narrow for the chosen width only borrows
 * it back — widening the window restores what the user picked.
 */
const ASIDE_STORAGE_KEY = 'vibeflow:workspace-aside-px'
const ASIDE_WIDTH_VAR = '--vf-workspace-aside'
/** Below these the terminal is too narrow to read and the aside's tabs wrap. */
const MIN_TERMINAL_WIDTH = 320
const MIN_ASIDE_WIDTH = 336
/** Must match the splitter's `w-2.5`. */
const SPLITTER_WIDTH = 10
/** Must match the inspector rail's `w-11`. */
const RAIL_WIDTH = 44

const TAB_ICON: Record<TaskTab, typeof Info> = {
  slaves: Network,
  task: Info,
  artifacts: ImageIcon,
  diff: FileDiff,
}

/**
 * Whether a running task's side views sit docked beside the terminal or fold
 * into the icon rail, opening as a drawer on demand. Shared by every mounted
 * panel and kept across reloads; docked is the default so the layout people
 * had before the rail existed is what they keep until they fold it.
 */
type InspectorMode = 'docked' | 'rail'

const INSPECTOR_STORAGE_KEY = 'vibeflow:workspace-inspector'
const inspectorListeners = new Set<() => void>()
let inspectorMode: InspectorMode | null = null

function getInspectorMode(): InspectorMode {
  if (inspectorMode === null) {
    inspectorMode =
      window.localStorage.getItem(INSPECTOR_STORAGE_KEY) === 'rail' ? 'rail' : 'docked'
  }
  return inspectorMode
}

function setInspectorMode(next: InspectorMode) {
  inspectorMode = next
  window.localStorage.setItem(INSPECTOR_STORAGE_KEY, next)
  for (const listener of inspectorListeners) listener()
}

function subscribeInspectorMode(listener: () => void) {
  inspectorListeners.add(listener)
  return () => {
    inspectorListeners.delete(listener)
  }
}

function useInspectorMode(): InspectorMode {
  return useSyncExternalStore(subscribeInspectorMode, getInspectorMode, () => 'docked')
}

/** Below Tailwind's `lg` a docked inspector leaves the terminal too narrow to read. */
const DOCKABLE_QUERY = '(min-width: 1024px)'

function subscribeDockable(listener: () => void) {
  const query = window.matchMedia(DOCKABLE_QUERY)
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}

function useDockable(): boolean {
  return useSyncExternalStore(
    subscribeDockable,
    () => window.matchMedia(DOCKABLE_QUERY).matches,
    () => true
  )
}

let asideWidthRestored = false

/** Applies the stored width once per renderer load; unset = CSS fallback. */
function restoreAsideWidth() {
  if (asideWidthRestored || typeof window === 'undefined') return
  asideWidthRestored = true
  const raw = Number(window.localStorage.getItem(ASIDE_STORAGE_KEY))
  if (Number.isFinite(raw) && raw >= MIN_ASIDE_WIDTH) {
    document.documentElement.style.setProperty(ASIDE_WIDTH_VAR, `${raw}px`)
  }
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

/** Coarse "how fresh is this" label for the folded artifact rows. */
function formatAge(modifiedAt: number): string {
  const minutes = Math.floor((Date.now() - modifiedAt) / 60_000)
  if (minutes < 1) return '剛剛'
  if (minutes < 60) return `${minutes} 分前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小時前`
  return `${Math.floor(hours / 24)} 天前`
}

/**
 * Whether an artifact is verification evidence the user is meant to look at.
 * Screenshots and recordings both qualify — a video proves the interactions a
 * static image cannot. Everything else — reports, scripts, logs, and anything
 * the agent parked in its scratch subdirectory — is noise in the gallery and
 * gets folded away instead. A recording past MAX_VIDEO_BYTES arrives as
 * 'binary', so it folds away too and is watched via the folder button.
 */
function isVerificationShot(artifact: TaskArtifact): boolean {
  return (artifact.kind === 'image' || artifact.kind === 'video') && !artifact.scratch
}

interface LaunchEntry {
  launch: LaunchIntent
  nonce: number
}

/** The workspace of a running card; other columns open as a sheet from the board. */
interface TaskWorkspacePanelProps {
  task: Task
  progress?: TaskProgress | null
  launch?: LaunchEntry
  onReturnToBacklog: (task: Task) => Promise<boolean>
  onLaunchAgent: (task: Task) => Promise<void>
  onContinueSession: (task: Task) => Promise<void>
  onComplete: (task: Task) => void
  onDelete: (taskId: string) => void
  /** This workspace is the one on screen (selected, on the workspace page). */
  active?: boolean
  /** A master's dispatched cards. */
  slaves?: SlaveEntry[]
  /** Live progress of every running card, for the slaves list. */
  progressById?: Record<string, TaskProgress>
  /** The master this card was dispatched by, if it still exists. */
  master?: Task | null
  onSelectTask?: (taskId: string) => void
}

function InfoSection({
  title,
  icon,
  children,
  actions,
  count,
  heading,
}: {
  title?: string
  icon?: React.ReactNode
  children: React.ReactNode
  actions?: React.ReactNode
  /** Optional item count shown beside the title (discoverability, PLAN E1). */
  count?: number
  /**
   * Takes over the title slot entirely. A section whose content is already
   * named by its own switcher has nothing left for a title to say.
   */
  heading?: React.ReactNode
}) {
  return (
    <section className="flex min-h-0 flex-1 flex-col border-b border-border last:border-b-0">
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border/70 px-4">
        {heading ?? (
          <h2 className={cn(SECTION_LABEL, 'flex min-w-0 items-center gap-2')}>
            {icon}
            <span className="truncate">{title}</span>
            {count !== undefined && count > 0 && (
              <span className="shrink-0 tabular-nums text-muted-foreground/80">{count}</span>
            )}
          </h2>
        )}
        {actions}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
    </section>
  )
}

/** OPEN / MERGED / CLOSED, tinted so the card's fate reads at a glance. */
const PR_STATE_CLASS: Record<string, string> = {
  MERGED: 'bg-primary/15 text-primary',
  OPEN: 'bg-success/15 text-success',
  CLOSED: 'bg-destructive/15 text-destructive',
}

/**
 * What a finished task came to: its pull request, its commits, and the files it
 * touched, all captured at completion (see captureTaskOutcome). This is the
 * card's account of the work once the worktree, artifacts and branch are gone,
 * so it renders from the stored snapshot alone and never reaches for git.
 */
export function TaskOutcomeSection({ outcome }: { outcome: TaskOutcome }) {
  const [showBody, setShowBody] = useState(false)
  const { pr, commits, files } = outcome

  return (
    <div className="space-y-4">
      {pr && (
        <div className="space-y-2">
          <h3 className={cn(SECTION_LABEL, 'flex items-center gap-1.5')}>
            <GitPullRequest className="size-3.5" />
            Pull Request
          </h3>
          <div className="space-y-2 rounded-md border border-border/70 bg-muted/20 p-2.5 text-sm">
            <div className="flex items-start gap-2">
              <span
                className={cn(
                  'shrink-0 rounded-xs px-1.5 py-0.5 text-xs font-medium',
                  PR_STATE_CLASS[pr.state] ?? 'bg-secondary text-secondary-foreground'
                )}
              >
                {pr.state}
              </span>
              <span className="min-w-0 flex-1 break-words text-foreground">
                {pr.title}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void openExternal(pr.url)}
                className="flex items-center gap-1.5 rounded-sm text-xs text-muted-foreground outline-none transition-colors motion-reduce:transition-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <ExternalLink className="size-3" />#{pr.number}
              </button>
              {pr.body && (
                <button
                  type="button"
                  onClick={() => setShowBody((v) => !v)}
                  className="rounded-sm text-xs text-muted-foreground outline-none transition-colors motion-reduce:transition-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {showBody ? '收合說明' : '展開說明'}
                </button>
              )}
            </div>
            {pr.body && showBody && (
              <MarkdownContent
                source={pr.body}
                compact
                className="bg-transparent p-0"
              />
            )}
          </div>
        </div>
      )}

      {commits.length > 0 && (
        <div className="space-y-2">
          <h3 className={cn(SECTION_LABEL, 'flex items-center gap-1.5')}>
            <GitCommitHorizontal className="size-3.5" />
            Commits
            <span className="tabular-nums font-normal">{commits.length}</span>
          </h3>
          <ul className="space-y-1 rounded-md bg-muted/30 p-2.5 text-sm">
            {commits.map((c) => (
              <li key={c.sha} className="flex items-start gap-2">
                <code className="shrink-0 font-mono text-xs text-muted-foreground">
                  {c.sha}
                </code>
                <span className="min-w-0 break-words">{c.subject}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {files.length > 0 && (
        <div className="space-y-2">
          <h3 className={cn(SECTION_LABEL, 'flex items-center gap-1.5')}>
            <FileDiff className="size-3.5" />
            變更檔案
            <span className="tabular-nums font-normal">{files.length}</span>
            <span className="ml-auto font-normal tabular-nums">
              <span className="text-success">+{outcome.additions}</span>
              <span className="ml-1 text-destructive">−{outcome.deletions}</span>
            </span>
          </h3>
          <ul className="space-y-1 rounded-md bg-muted/30 p-2.5 text-sm">
            {files.map((f) => (
              <li key={f.path} className="flex items-start gap-2">
                <span className="min-w-0 flex-1 break-all font-mono text-xs">
                  {f.path}
                </span>
                {(f.additions > 0 || f.deletions > 0) && (
                  <span className="shrink-0 text-xs tabular-nums">
                    <span className="text-success">+{f.additions}</span>
                    <span className="ml-1 text-destructive">−{f.deletions}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
          {outcome.truncated && (
            <p className="text-xs text-muted-foreground">
              只列出前 {files.length} 個檔案。
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function TaskInfo({
  task,
  progress,
  master,
  onSelectTask,
}: Pick<TaskWorkspacePanelProps, 'task' | 'progress' | 'master' | 'onSelectTask'>) {
  const isMaster = task.role === 'master'
  return (
    <div className="space-y-4 text-base">
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="rounded-xs bg-secondary px-1.5 py-0.5 text-xs font-medium text-secondary-foreground">
            In Progress
          </span>
          {isMaster && (
            <span className="flex items-center gap-1 rounded-xs bg-master/15 px-1.5 py-0.5 text-xs font-medium text-master">
              <Network className="size-3" />
              Master
            </span>
          )}
        </div>
        <h3 className="break-words text-lg font-semibold tracking-tight text-foreground">
          {task.title}
        </h3>
      </div>

      {task.jevRoute?.status === 'routing' && (
        <div className="flex items-center gap-2 rounded-md bg-muted/30 p-2.5 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-3.5 shrink-0 animate-spin" />
          Jev：{jevRoutingLabel(task.jevRoute)}（完成後才會啟動 agent）
        </div>
      )}

      {task.jevRoute && task.jevRoute.status !== 'routing' && (
        <div className="space-y-1 rounded-md bg-muted/30 p-2.5 text-sm text-muted-foreground">
          <p>{jevResultLabel(task.jevRoute, task.model)}</p>
          {task.jevRoute.reason && <p>自動選擇未完成：{task.jevRoute.reason}</p>}
          {task.jevRoute.context && (
            <details>
              <summary className="cursor-pointer select-none">
                前置分析（{task.jevRoute.scoutModel ?? '高思考模型'}）
              </summary>
              <div className="mt-2 text-foreground">
                <MarkdownContent source={task.jevRoute.context} compact />
              </div>
            </details>
          )}
        </div>
      )}

      {master && (
        <button
          type="button"
          onClick={() => onSelectTask?.(master.id)}
          title="開啟 master 卡片"
          className="flex w-full items-center gap-2 rounded-md border border-master/30 bg-master/5 p-2.5 text-left text-sm outline-none transition-colors motion-reduce:transition-none hover:bg-master/10 focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Network className="size-3.5 shrink-0 text-master" />
          <span className="shrink-0 text-muted-foreground">屬於</span>
          <span className="min-w-0 flex-1 truncate font-medium">{master.title}</span>
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      )}

      {isMaster ? (
        <div className="space-y-1.5 rounded-md bg-muted/30 p-2.5 text-sm text-muted-foreground">
          <div className="flex items-start gap-2">
            <FolderOpen className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0 break-all font-mono text-xs">
              {task.worktreePath ?? task.workDir ?? '開始執行時建立專屬資料夾'}
            </span>
          </div>
        </div>
      ) : (
      <div className="space-y-1.5 rounded-md bg-muted/30 p-2.5 text-sm text-muted-foreground">
        {task.projectName && (
          <div className="flex items-center gap-2">
            <Layers className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate">{task.projectName}</span>
          </div>
        )}
        <div className="flex items-start gap-2">
          <GitBranch className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 break-all">
            {task.branch}
            {!task.worktreePath && <span className="text-muted-foreground/70">（建立中…）</span>}
          </span>
        </div>
        {task.baseBranch && (
          <div className="flex items-start gap-2">
            <GitCompare className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0 break-all">base: {task.baseBranch}</span>
          </div>
        )}
      </div>
      )}

      {task.description && <MarkdownContent source={task.description} />}

      <TaskProgressDetail progress={progress} usage={task.usage} />

      {task.outcome && <TaskOutcomeSection outcome={task.outcome} />}
    </div>
  )
}

/**
 * Thumbnail for an image or video artifact. Each tile fetches its own data URL,
 * so listing a directory of screenshots costs nothing until it is displayed.
 * `modifiedAt` is a dep so an overwritten screenshot reloads on the next poll.
 * A video tile renders its first frame via <video> rather than a poster image,
 * which is why it stays muted and uncontrolled here — the dialog does playback.
 */
function ArtifactThumb({ taskId, artifact }: { taskId: string; artifact: TaskArtifact }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  // A container we accept by extension can still hold a codec Chromium lacks
  // (a ProRes .mov). Falling back to the icon beats a black rectangle.
  const [undecodable, setUndecodable] = useState(false)

  useEffect(() => {
    let active = true
    setDataUrl(null)
    setUndecodable(false)
    readArtifact(taskId, artifact.name)
      .then((content) => {
        if (active) setDataUrl(content?.dataUrl ?? null)
      })
      .catch(() => {
        if (active) setDataUrl(null)
      })
    return () => {
      active = false
    }
  }, [taskId, artifact.name, artifact.modifiedAt])

  const isVideo = artifact.kind === 'video'

  if (!dataUrl || undecodable) {
    return (
      <div className="flex h-24 items-center justify-center rounded-md border border-border/70 bg-card">
        {isVideo ? (
          <Film className="size-5 text-muted-foreground" />
        ) : (
          <ImageIcon className="size-5 text-muted-foreground" />
        )}
      </div>
    )
  }
  if (isVideo) {
    return (
      <div className="relative h-24 w-full overflow-hidden rounded-md border border-border/70 bg-card">
        <video
          src={dataUrl}
          muted
          playsInline
          preload="metadata"
          onError={() => setUndecodable(true)}
          className="h-full w-full object-contain"
        />
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex size-7 items-center justify-center rounded-full bg-background/80 ring-1 ring-border/70">
            <Play className="size-3.5 fill-current text-foreground" />
          </span>
        </span>
      </div>
    )
  }
  return (
    <img
      src={dataUrl}
      alt={artifact.name}
      className="h-24 w-full rounded-md border border-border/70 bg-card object-contain"
    />
  )
}

/**
 * Full-size artifact view. Images and videos render inline; anything else falls
 * back to text. Videos autoplay muted and loop so a short verification
 * recording behaves like the GIFs it replaces, with controls to unmute or seek.
 */
function ArtifactPreview({
  taskId,
  artifact,
  onClose,
}: {
  taskId: string
  artifact: TaskArtifact
  onClose: () => void
}) {
  const [content, setContent] = useState<ArtifactContent | null | undefined>(undefined)
  // Set when <video> rejects the stream — an accepted container with a codec
  // Chromium cannot decode. Sends the user to the folder button instead.
  const [playbackFailed, setPlaybackFailed] = useState(false)

  useEffect(() => {
    let active = true
    setContent(undefined)
    setPlaybackFailed(false)
    readArtifact(taskId, artifact.name)
      .then((next) => {
        if (active) setContent(next)
      })
      .catch(() => {
        if (active) setContent(null)
      })
    return () => {
      active = false
    }
  }, [taskId, artifact.name, artifact.modifiedAt])

  return (
    <DialogShell
      title={artifact.name}
      description={`${ARTIFACT_KIND_LABEL[artifact.kind]} · ${formatBytes(artifact.size)}${
        artifact.scratch ? ' · 工作暫存' : ''
      }`}
      onClose={onClose}
      showHeader
      contentClassName="max-w-5xl"
      bodyClassName="p-4"
    >
      {content === undefined ? (
        <div className="flex h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          讀取中…
        </div>
      ) : content === null ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          讀不到這個檔案，可能已被刪除。
        </p>
      ) : content.kind === 'image' && content.dataUrl ? (
        <ZoomableImage src={content.dataUrl} alt={artifact.name} />
      ) : content.kind === 'video' && content.dataUrl ? (
        playbackFailed ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            這個影片的編碼無法在 app 內播放。用 Artifacts 分頁的「開啟資料夾」以系統播放器開啟。
          </p>
        ) : (
          <video
            src={content.dataUrl}
            controls
            autoPlay
            loop
            muted
            playsInline
            onError={() => setPlaybackFailed(true)}
            className="max-h-[70vh] w-full rounded-md bg-black"
          />
        )
      ) : content.kind === 'binary' ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          無法內嵌預覽的檔案（{formatBytes(artifact.size)}）。用 Artifacts 分頁的「開啟資料夾」以系統播放器或編輯器開啟。
        </p>
      ) : (
        <>
          {isMarkdownArtifact(artifact.name) ? (
            <MarkdownContent source={content.text ?? ''} />
          ) : (
            <pre className="whitespace-pre-wrap break-words rounded-md bg-muted/30 p-3 font-mono text-xs">
              {content.text}
            </pre>
          )}
          {content.truncated && (
            <p className="mt-2 text-xs text-muted-foreground">
              內容過長，僅顯示開頭 256 KB。
            </p>
          )}
        </>
      )}
    </DialogShell>
  )
}

/**
 * Temporary artifacts the agent produced for this task. Verification screenshots
 * get the gallery — they are what the tab exists for — while reports, scripts,
 * logs and the agent's scratch files are folded into one collapsed list, since a
 * task routinely writes a hundred of those and the user opens almost none. The
 * list is owned by the panel so the tab badge stays live even while this tab is
 * closed.
 */
function ArtifactsContent({
  taskId,
  artifacts,
  artifactsDir,
}: {
  taskId: string
  artifacts: TaskArtifact[]
  artifactsDir: string | null
}) {
  const [preview, setPreview] = useState<TaskArtifact | null>(null)
  const [showOthers, setShowOthers] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
  // Why the folder would not open (missing dir, no worktree). There is no toast
  // in this app, so the reason is shown inline rather than swallowed.
  const [openError, setOpenError] = useState<string | null>(null)
  const shots = artifacts.filter(isVerificationShot)
  const others = artifacts.filter((artifact) => !isVerificationShot(artifact))

  const handleOpenDir = useCallback(() => {
    setOpenError(null)
    openArtifactsDir(taskId)
      .then((reason) => setOpenError(reason || null))
      .catch(() => setOpenError('開啟失敗'))
  }, [taskId])

  const handleCopyDir = useCallback(() => {
    if (!artifactsDir) return
    navigator.clipboard.writeText(artifactsDir)
      .then(() => {
        setCopyState('copied')
        window.setTimeout(() => setCopyState('idle'), 1600)
      })
      .catch(() => setCopyState('error'))
  }, [artifactsDir])

  return (
    <>
      <div className="mb-3 space-y-2 rounded-md border border-border/70 bg-muted/20 p-2.5">
        <div className="text-xs font-medium text-muted-foreground">Artifact 資料夾</div>
        <div className="flex min-w-0 items-center gap-2">
          <code
            className="min-w-0 flex-1 select-all break-all rounded-xs bg-background px-2 py-1.5 font-mono text-xs text-foreground"
            title={artifactsDir ?? '尚無可用路徑'}
          >
            {artifactsDir ?? '尚無可用路徑'}
          </code>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyDir}
            disabled={!artifactsDir}
            title="複製 Artifact 資料夾路徑"
            className="shrink-0 text-xs"
          >
            <CopyFeedbackIcon copied={copyState === 'copied'} />
            {copyState === 'copied' ? '已複製' : copyState === 'error' ? '複製失敗' : '複製路徑'}
          </Button>
        </div>
      </div>
      <div className="mb-2 flex items-center justify-end gap-2">
        {openError && (
          <span className="min-w-0 truncate text-xs text-muted-foreground" title={openError}>
            {openError}
          </span>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={handleOpenDir}
          title={artifactsDir ?? '任務的 artifacts 目錄'}
          className="text-xs"
        >
          <FolderOpen className="size-3.5" />
          開啟資料夾
        </Button>
      </div>
      {artifacts.length === 0 ? (
        <div className="space-y-2 py-8 text-center">
          <p className="text-sm text-muted-foreground">還沒有暫存產物。</p>
          <p className="text-xs leading-5 text-muted-foreground/80">
            驗證截圖、錄影與報告可放在上方資料夾，工作暫存可放在其下的 <code className="rounded-xs bg-muted/40 px-1 py-0.5 font-mono">scratch/</code>
            ，完成任務時會一併清除。
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {shots.length > 0 ? (
            <ul className="grid grid-cols-2 gap-2">
              {shots.map((artifact) => (
                <li key={artifact.name}>
                  <button
                    type="button"
                    onClick={() => setPreview(artifact)}
                    title={artifact.name}
                    className="w-full rounded-md border border-border/70 bg-muted/20 p-2 text-left outline-none transition-colors motion-reduce:transition-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <ArtifactThumb taskId={taskId} artifact={artifact} />
                    <div className="mt-1.5 flex items-baseline gap-1.5">
                      <span className="min-w-0 flex-1 truncate font-mono text-xs">
                        {artifact.name}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {formatBytes(artifact.size)}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">
              還沒有驗證截圖或錄影。
            </p>
          )}

          {others.length > 0 && (
            <div className="rounded-md border border-border/70">
              <button
                type="button"
                onClick={() => setShowOthers((open) => !open)}
                aria-expanded={showOthers}
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground outline-none transition-colors motion-reduce:transition-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <ChevronRight
                  className={cn(
                    'size-3.5 shrink-0 transition-transform motion-reduce:transition-none',
                    showOthers && 'rotate-90'
                  )}
                />
                其他 {others.length} 個檔案（報告、script、log）
              </button>
              {showOthers && (
                <ul className="border-t border-border/70">
                  {others.map((artifact) => (
                    <li key={artifact.name}>
                      <button
                        type="button"
                        onClick={() => setPreview(artifact)}
                        title={artifact.name}
                        className="flex w-full items-center gap-2 px-2 py-1 text-left outline-none transition-colors motion-reduce:transition-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      >
                        {artifact.kind === 'image' ? (
                          <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" />
                        ) : artifact.kind === 'video' ? (
                          <Film className="size-3.5 shrink-0 text-muted-foreground" />
                        ) : (
                          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                        )}
                        <span className="min-w-0 flex-1 truncate font-mono text-xs">
                          {artifact.name}
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground/80">
                          {formatAge(artifact.modifiedAt)} · {formatBytes(artifact.size)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
      <AnimatePresence>
        {preview && (
          <ArtifactPreview
            key={`artifact-${taskId}-${preview.name}`}
            taskId={taskId}
            artifact={preview}
            onClose={() => setPreview(null)}
          />
        )}
      </AnimatePresence>
    </>
  )
}

/** A master's cards: where each stands, what it is doing now, and a way into it. */
export function SlavesContent({
  slaves,
  progressById,
  onSelectTask,
}: {
  slaves: SlaveEntry[]
  progressById: Record<string, TaskProgress>
  onSelectTask?: (taskId: string) => void
}) {
  if (slaves.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        Master 還沒有建立任何 slave 卡片。
      </p>
    )
  }
  const done = slaves.filter((s) => s.column === 'done').length
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {slaves.length} 張卡片 · {done} 完成
      </p>
      <ul className="space-y-1.5">
        {slaves.map(({ task, column }) => {
          const progress = progressById[task.id]
          const state = slaveState(column, task, progress)
          const todos = column === 'in_progress' ? todoCount(progress) : null
          const current = column === 'in_progress'
            ? progress?.todos?.find((t) => t.status === 'in_progress')
            : undefined
          const pr = task.outcome?.pr
          return (
            <li key={task.id}>
              <button
                type="button"
                onClick={() => onSelectTask?.(task.id)}
                title={`開啟：${task.title}`}
                className="w-full rounded-md border border-border/70 bg-muted/20 px-2.5 py-2 text-left outline-none transition-colors motion-reduce:transition-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <div className="flex items-center gap-2">
                  <StatusMark {...state} />
                  <TaskId id={task.id} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{task.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{state.label}</span>
                  {todos && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{todos}</span>}
                </div>
                <div className="mt-1 flex items-center gap-2 pl-3.5 text-xs text-muted-foreground">
                  <Layers className="size-3 shrink-0" />
                  <span className="max-w-[45%] shrink-0 truncate">{projectLabel(task)}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {column === 'backlog' && task.launchError
                      ? task.launchError
                      : current
                        ? current.activeForm ?? current.content
                        : task.branch}
                  </span>
                  {pr && <span className="shrink-0">PR #{pr.number}</span>}
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * Git-diff state for one task: the changed-file list is polled cheaply
 * (`fetch: false`, metadata only), a file's body is loaded when its row opens
 * the single-file modal, and the full-screen view still loads everything at
 * once. Owned by the panel rather than the view so the tab's changed-file count
 * stays live while another tab is on screen.
 */
function useTaskDiff(taskId: string, enabled: boolean) {
  const [entries, setEntries] = useState<DiffEntry[]>([])
  /** path → body; a `null` value records "asked, not available" so it is not refetched. */
  const [contents, setContents] = useState<Record<string, DiffFile | null>>({})
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshNonce, setRefreshNonce] = useState(0)

  const [expanded, setExpanded] = useState(false)
  const [fullFiles, setFullFiles] = useState<DiffFile[] | null>(null)

  const loadedEntriesRef = useRef<Map<string, DiffEntry>>(new Map())

  /** Adopt a fresh list without repainting when a poll reports no changes. */
  const applyEntries = useCallback((next: DiffEntry[]) => {
    const paths = new Set(next.map((entry) => entry.path))
    for (const filePath of loadedEntriesRef.current.keys()) {
      if (!paths.has(filePath)) loadedEntriesRef.current.delete(filePath)
    }
    setEntries((current) => stabilizeDiffEntries(current, next))
    setContents((current) => retainExistingDiffContents(current, next))
  }, [])

  const selectedEntry = entries.find((entry) => entry.path === selectedPath) ?? null

  /**
   * Load a selected body in the background. If its revision changes, keep the
   * previous body visible until the replacement is ready instead of flashing a
   * loading state between polling snapshots.
   */
  useEffect(() => {
    const entry = selectedEntry
    if (!entry) return
    const filePath = entry.path
    const loadedEntry = loadedEntriesRef.current.get(filePath)
    if (
      filePath in contents &&
      loadedEntry &&
      sameDiffEntry(loadedEntry, entry)
    ) {
      return
    }

    let active = true
    getDiffFile(taskId, filePath)
      .then((file) => {
        if (!active) return
        loadedEntriesRef.current.set(filePath, entry)
        setContents((current) =>
          sameDiffFile(current[filePath], file)
            ? current
            : { ...current, [filePath]: file }
        )
      })
      .catch(() => {
        if (!active) return
        loadedEntriesRef.current.set(filePath, entry)
        setContents((current) =>
          current[filePath] === null ? current : { ...current, [filePath]: null }
        )
      })
    return () => {
      active = false
    }
  }, [taskId, selectedEntry, contents])

  // First load does a full remote refresh (matching the old behaviour); the
  // self-rescheduling poll that follows stays local, so it never hits the
  // network and cannot overlap with itself.
  useEffect(() => {
    if (!enabled) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined

    let loaded = false
    const tick = async (withFetch: boolean) => {
      // Idle while a dialog covers the panel: fresh data behind one only resizes
      // a scroll container nobody can see. The first load is exempt so a view
      // opened under a dialog still fills in.
      if (loaded && isModalOpen()) {
        if (active) timer = setTimeout(() => void tick(false), POLL_INTERVAL_MS)
        return
      }
      loaded = true
      try {
        const next = await getDiffEntries(taskId, { fetch: withFetch })
        if (!active) return
        applyEntries(next)
        setError(null)
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (active) {
          setLoading(false)
          timer = setTimeout(() => void tick(false), POLL_INTERVAL_MS)
        }
      }
    }

    setLoading(true)
    void tick(true)
    return () => {
      active = false
      if (timer) clearTimeout(timer)
    }
  }, [taskId, enabled, refreshNonce, applyEntries])

  // A poll can retire the open file (committed, reverted, or deleted); there is
  // nothing left to show for it, so close instead of stranding a stale diff.
  useEffect(() => {
    if (selectedPath && !entries.some((entry) => entry.path === selectedPath)) {
      setSelectedPath(null)
    }
  }, [entries, selectedPath])

  // The full-screen view keeps the original single-shot path: every file with
  // its content, fetched fresh each time it opens.
  useEffect(() => {
    if (!expanded) return
    let active = true
    getDiff(taskId)
      .then((next) => {
        if (active) setFullFiles(next)
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      active = false
    }
  }, [expanded, taskId])

  const closeExpanded = useCallback(() => {
    setExpanded(false)
    setFullFiles(null)
  }, [])

  const expand = useCallback(() => setExpanded(true), [])

  const manualRefresh = useCallback(() => {
    setContents({})
    loadedEntriesRef.current.clear()
    setRefreshNonce((n) => n + 1)
  }, [])

  return {
    entries,
    contents,
    selectedEntry,
    setSelectedPath,
    loading,
    error,
    expanded,
    fullFiles,
    expand,
    closeExpanded,
    manualRefresh,
  }
}

type TaskDiff = ReturnType<typeof useTaskDiff>

/** Header controls for the Git diff tab. */
function DiffActions({ diff }: { diff: TaskDiff }) {
  return (
    <div className="flex items-center gap-1">
      <IconButton
        aria-label="重新整理 Git diff"
        title="重新整理（含 fetch origin）"
        className="p-1"
        disabled={diff.loading}
        onClick={diff.manualRefresh}
      >
        <RefreshCw className={cn('size-3.5', diff.loading && 'animate-spin')} />
      </IconButton>
      {diff.entries.length > 0 && (
        <IconButton
          aria-label="放大檢視 Git diff"
          title="放大檢視（全部展開）"
          className="p-1"
          onClick={diff.expand}
        >
          <Maximize2 className="size-3.5" />
        </IconButton>
      )}
    </div>
  )
}

/** The Git diff tab: changed-file list, plus the single-file and full-screen views. */
function DiffContent({ taskId, diff }: { taskId: string; diff: TaskDiff }) {
  const {
    entries,
    contents,
    selectedEntry,
    setSelectedPath,
    loading,
    error,
    expanded,
    fullFiles,
    closeExpanded,
  } = diff
  const { groupBy } = useDiffView()

  return (
    <>
      <div className="mb-2">
        <DiffGroupToggle />
      </div>
      {groupBy === 'commit' ? (
        <CommitDiffContent taskId={taskId} />
      ) : loading && entries.length === 0 ? (
        <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          讀取 diff 中…
        </div>
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm">
          {error}
        </div>
      ) : entries.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          與基準分支相比沒有變更。
        </p>
      ) : (
        <>
          <ul className="space-y-1">
            {entries.map((entry) => (
              <li key={entry.path}>
                <DiffEntryRow entry={entry} onOpen={() => setSelectedPath(entry.path)} />
              </li>
            ))}
          </ul>
          {entries.length >= MAX_DIFF_FILES && (
            <p className="mt-2 text-xs text-muted-foreground">
              變更檔案超過 {MAX_DIFF_FILES} 個，僅顯示前 {MAX_DIFF_FILES} 個。
            </p>
          )}
        </>
      )}
      <AnimatePresence>
        {selectedEntry && (
          <DiffFileModal
            key={`diff-${taskId}-${selectedEntry.path}`}
            entry={selectedEntry}
            file={
              selectedEntry.path in contents ? contents[selectedEntry.path] : undefined
            }
            onClose={() => setSelectedPath(null)}
          />
        )}
      </AnimatePresence>
      {expanded && (
        <div className="fixed inset-0 z-50 flex bg-background/95 text-foreground">
          <div className="flex min-h-0 w-full flex-col">
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-5">
              <div className="min-w-0">
                <h2 className="text-base font-semibold">Git diff</h2>
                <p className="text-sm text-muted-foreground">
                  {entries.length} changed {entries.length === 1 ? 'file' : 'files'}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <DiffViewToggles />
                <IconButton
                  aria-label="關閉 diff 放大檢視"
                  title="關閉"
                  onClick={closeExpanded}
                >
                  <X className="size-4" />
                </IconButton>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <div className="mx-auto w-full max-w-6xl space-y-4">
                {fullFiles === null ? (
                  <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" />
                    讀取全部 diff 內容中…
                  </div>
                ) : (
                  fullFiles.map((file) => <DiffFileViewer key={file.path} file={file} />)
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export function TaskWorkspacePanel({
  task,
  progress,
  launch,
  onReturnToBacklog,
  onLaunchAgent,
  onContinueSession,
  onComplete,
  onDelete,
  active = true,
  slaves = [],
  progressById = {},
  master = null,
  onSelectTask,
}: TaskWorkspacePanelProps) {
  const isMaster = task.role === 'master'
  const [activeTaskTab, setActiveTaskTab] = useState<TaskTab | null>(null)
  const [artifacts, setArtifacts] = useState<TaskArtifact[]>([])
  const tabBaseId = useId()
  const tabGroup = useId()
  const tabPanelId = `${tabBaseId}-panel`
  const tabId = (tab: TaskTab) => `${tabBaseId}-tab-${tab}`
  // A master has no project; before its first run, the folder it will get stands in.
  const cwd = task.worktreePath ?? task.projectPath ?? (isMaster ? task.workDir ?? task.workspacePath : undefined) ?? null
  const provisionNotice =
    task.worktreePath
      ? null
      : isMaster
        ? '正在準備 master 的工作資料夾，完成後 agent 會自動啟動…'
        : `正在準備工作環境：從最新的 ${task.baseBranch ?? '基準分支'} 建立分支 ${task.branch} 與 worktree，有 remote 時會一併推送到 origin。第一次開始執行需要幾秒鐘，完成後 agent 會自動啟動…`
  const artifactsDir = taskArtifactsDir(task.worktreePath, task.workspacePath)
  // Polled at the panel so the tab's changed-file count stays live while
  // another tab is showing — same reason the artifact list is polled here.
  const diff = useTaskDiff(task.id, !isMaster)
  // Badge counts verification screenshots only — a count that included the
  // agent's scripts and logs said nothing about whether there was anything to see.
  const shotCount = artifacts.filter(isVerificationShot).length

  // Polled here rather than inside ArtifactsContent so the tab's count stays
  // live while the tab is closed.
  useEffect(() => {
    setArtifacts([])
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined

    let loaded = false
    const tick = async () => {
      // See useTaskDiff: a poll behind a dialog only churns the layout.
      if (loaded && isModalOpen()) {
        if (active) timer = setTimeout(() => void tick(), POLL_INTERVAL_MS)
        return
      }
      loaded = true
      try {
        const next = await listArtifacts(task.id)
        if (active) setArtifacts(next)
      } catch {
        // a failed listing just leaves the previous snapshot in place
      } finally {
        if (active) timer = setTimeout(() => void tick(), POLL_INTERVAL_MS)
      }
    }

    void tick()
    return () => {
      active = false
      if (timer) clearTimeout(timer)
    }
  }, [task.id])

  const launchCommand = launch?.launch
  const launchNonce = launch?.nonce ?? 0

  // A tab outside this card's set (a master's tab on a plain card) falls back to the first one.
  const tabs = isMaster ? MASTER_TABS : TASK_TABS
  const activeTab = activeTaskTab && tabs.includes(activeTaskTab) ? activeTaskTab : tabs[0]

  const tabBadge = (tab: TaskTab) =>
    tab === 'artifacts'
      ? shotCount
      : tab === 'diff'
        ? diff.entries.length
        : tab === 'slaves'
          ? slaves.length
          : 0

  const activeContent =
    activeTab === 'slaves' ? (
      <SlavesContent slaves={slaves} progressById={progressById} onSelectTask={onSelectTask} />
    ) : activeTab === 'task' ? (
      <TaskInfo task={task} progress={progress} master={master} onSelectTask={onSelectTask} />
    ) : activeTab === 'artifacts' ? (
      <ArtifactsContent taskId={task.id} artifacts={artifacts} artifactsDir={artifactsDir} />
    ) : (
      <DiffContent taskId={task.id} diff={diff} />
    )

  const activePanel = (
    <div role="tabpanel" id={tabPanelId} aria-labelledby={tabId(activeTab)} className="h-full">
      {activeContent}
    </div>
  )

  // ── Inspector: docked beside the terminal, or a rail that opens a drawer ──
  const inspectorMode = useInspectorMode()
  const dockable = useDockable()
  const docked = dockable && inspectorMode === 'docked'
  const [drawerOpen, setDrawerOpen] = useState(false)
  const inspectorShown = docked || drawerOpen

  // In the rail, the shown tab's icon closes what it opened, so one control
  // both reveals and dismisses a view.
  const selectRailTab = (tab: TaskTab) => {
    if (inspectorShown && tab === activeTab) {
      if (docked) setInspectorMode('rail')
      else setDrawerOpen(false)
      return
    }
    setActiveTaskTab(tab)
    if (!docked) setDrawerOpen(true)
  }

  const pinInspector = () => {
    setDrawerOpen(false)
    setInspectorMode('docked')
  }

  const inspector = (
    <InfoSection
      title={TAB_LABEL[activeTab]}
      count={tabBadge(activeTab)}
      actions={
        <div className="flex shrink-0 items-center gap-1">
          {activeTab === 'diff' && <DiffActions diff={diff} />}
          {docked ? (
            <IconButton
              aria-label="收合側欄"
              title="收合成圖示列，讓終端機佔滿寬度"
              className="p-1"
              onClick={() => setInspectorMode('rail')}
            >
              <PanelRightClose className="size-3.5" />
            </IconButton>
          ) : (
            <>
              {dockable && (
                <IconButton
                  aria-label="固定側欄"
                  title="固定在終端機旁"
                  className="p-1"
                  onClick={pinInspector}
                >
                  <Pin className="size-3.5" />
                </IconButton>
              )}
              <IconButton
                aria-label="關閉側欄"
                className="p-1"
                onClick={() => setDrawerOpen(false)}
              >
                <X className="size-3.5" />
              </IconButton>
            </>
          )}
        </div>
      }
    >
      {activePanel}
    </InfoSection>
  )

  const rail = (
    <LayoutGroup id={`${tabGroup}-rail`}>
    <div
      role="tablist"
      aria-label="任務檢視"
      aria-orientation="vertical"
      className="flex w-11 shrink-0 flex-col items-center gap-1 border-l border-border bg-card/40 py-1.5"
    >
      {tabs.map((tab) => {
        const Icon = TAB_ICON[tab]
        const badge = tabBadge(tab)
        const shown = inspectorShown && activeTab === tab
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            id={tabId(tab)}
            aria-selected={shown}
            aria-controls={tabPanelId}
            aria-label={badge > 0 ? `${TAB_LABEL[tab]}（${badge}）` : TAB_LABEL[tab]}
            title={TAB_LABEL[tab]}
            onClick={() => selectRailTab(tab)}
            className={cn(
              'relative isolate flex size-8 items-center justify-center rounded-md outline-none transition-colors motion-reduce:transition-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              shown
                ? 'text-primary'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            )}
          >
            {shown && (
              <TabIndicator layoutId="task-rail-tab" className="inset-0 -z-10 rounded-md bg-primary/15" />
            )}
            <Icon className="size-4" />
            {badge > 0 && (
              <span
                aria-hidden="true"
                className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold tabular-nums text-primary-foreground"
              >
                {badge}
              </span>
            )}
          </button>
        )
      })}
    </div>
    </LayoutGroup>
  )

  const [pathCopy, setPathCopy] = useState<'idle' | 'copied' | 'error'>('idle')
  const copyPath = () => {
    if (!cwd) return
    navigator.clipboard
      .writeText(cwd)
      .then(() => setPathCopy('copied'))
      .catch(() => setPathCopy('error'))
      .finally(() => window.setTimeout(() => setPathCopy('idle'), 1600))
  }

  // ── Terminal / aside splitter ─────────────────────────────────────────────
  // Only rendered while the inspector is docked.
  const splitAreaRef = useRef<HTMLElement>(null)
  const asideRef = useRef<HTMLElement>(null)
  const dragOriginRef = useRef<{ x: number; width: number } | null>(null)

  useLayoutEffect(restoreAsideWidth, [])

  const clampAsideWidth = (next: number) => {
    const available = splitAreaRef.current?.clientWidth ?? 0
    const max =
      available > 0
        ? available - MIN_TERMINAL_WIDTH - SPLITTER_WIDTH - RAIL_WIDTH
        : next
    return Math.max(
      MIN_ASIDE_WIDTH,
      Math.min(next, Math.max(MIN_ASIDE_WIDTH, max))
    )
  }

  const applyAsideWidth = (next: number, persist: boolean) => {
    const width = Math.round(clampAsideWidth(next))
    document.documentElement.style.setProperty(ASIDE_WIDTH_VAR, `${width}px`)
    if (persist) window.localStorage.setItem(ASIDE_STORAGE_KEY, String(width))
  }

  const onSplitterDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const width = asideRef.current?.getBoundingClientRect().width ?? 0
    if (width <= 0) return
    dragOriginRef.current = { x: event.clientX, width }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  // Dragging left widens the aside, so the delta is subtracted.
  const onSplitterMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const origin = dragOriginRef.current
    if (!origin) return
    applyAsideWidth(origin.width - (event.clientX - origin.x), false)
  }

  const onSplitterUp = () => {
    if (!dragOriginRef.current) return
    dragOriginRef.current = null
    const width = asideRef.current?.getBoundingClientRect().width ?? 0
    if (width > 0) applyAsideWidth(width, true)
  }

  const nudgeSplitter = (delta: number) => {
    const width = asideRef.current?.getBoundingClientRect().width ?? 0
    if (width <= 0) return
    applyAsideWidth(width + delta, true)
  }

  const deleteControl = (
    <HoldButton
      aria-label="按住刪除任務"
      title="按住以刪除任務（清理 worktree）"
      onConfirm={() => onDelete(task.id)}
      className="inline-flex shrink-0 items-center justify-center rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
    >
      <Trash2 className="size-4" />
    </HoldButton>
  )

  // No header: the title is the rail entry, and the actions share one
  // toolbar with the terminal they act on.
  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-background text-foreground">
      <main ref={splitAreaRef} className="flex min-h-0 flex-1 overflow-hidden">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            className="flex min-h-0 flex-1 flex-col"
            onPointerDown={() => setDrawerOpen(false)}
          >
            <TaskTerminal
              taskId={task.id}
              cwd={cwd}
              launchCommand={launchCommand}
              launchNonce={launchNonce}
              provisionNotice={provisionNotice}
              readOnly={false}
              onReturnToBacklog={() => onReturnToBacklog(task)}
              onLaunchAgent={() => onLaunchAgent(task)}
              onContinueSession={task.launchedAt != null ? () => onContinueSession(task) : undefined}
              active={active}
              toolbarStart={
                <>
                  {isMaster ? (
                    <span className="flex min-w-0 items-center gap-1.5 rounded-xs bg-master/15 px-1.5 py-0.5 text-xs font-medium text-master">
                      <Network className="size-3 shrink-0" />
                      Master
                    </span>
                  ) : (
                    <span
                      className="flex min-w-0 items-center gap-1.5 rounded-xs bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground"
                      title={task.branch}
                    >
                      <GitBranch className="size-3 shrink-0 text-muted-foreground" />
                      <span className="truncate">{task.branch}</span>
                    </span>
                  )}
                  {task.baseBranch && (
                    <span
                      className="min-w-0 shrink truncate font-mono text-xs text-muted-foreground"
                      title={`基準分支：${task.baseBranch}`}
                    >
                      ← {task.baseBranch}
                    </span>
                  )}
                  <IconButton
                    aria-label={
                      pathCopy === 'copied'
                        ? '已複製 worktree 路徑'
                        : pathCopy === 'error'
                          ? '複製 worktree 路徑失敗'
                          : '複製 worktree 路徑'
                    }
                    title={cwd ?? undefined}
                    className="p-1"
                    disabled={!cwd}
                    onClick={copyPath}
                  >
                    <CopyFeedbackIcon copied={pathCopy === 'copied'} />
                  </IconButton>
                  <TaskProgressChip progress={progress} />
                </>
              }
              toolbarEnd={
                <>
                  <span aria-hidden="true" className="h-4 w-px shrink-0 bg-border" />
                  <Button
                    size="sm"
                    className="h-7 shrink-0 px-2.5 text-xs"
                    onClick={() => {
                      onComplete(task)
                    }}
                    title="標記完成後會清理 PTY 與 worktree"
                  >
                    <Check className="size-3.5" />
                    完成
                  </Button>
                  {deleteControl}
                </>
              }
            />
          </div>
          {!docked && drawerOpen && (
            <aside
              aria-label={TAB_LABEL[activeTab]}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && !isModalOpen()) setDrawerOpen(false)
              }}
              className="absolute bottom-0 right-0 top-10 z-20 flex w-[min(var(--vf-workspace-aside,24rem),calc(100%-2rem))] flex-col border-l border-border bg-card shadow-xl xl:w-[min(var(--vf-workspace-aside,27rem),calc(100%-2rem))]"
            >
              {inspector}
            </aside>
          )}
        </div>

        {docked && (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="調整終端機與側邊面板的寬度"
              tabIndex={0}
              onPointerDown={onSplitterDown}
              onPointerMove={onSplitterMove}
              onPointerUp={onSplitterUp}
              onPointerCancel={onSplitterUp}
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft') {
                  event.preventDefault()
                  nudgeSplitter(24)
                } else if (event.key === 'ArrowRight') {
                  event.preventDefault()
                  nudgeSplitter(-24)
                }
              }}
              className="flex w-2.5 shrink-0 cursor-col-resize items-center justify-center border-x border-border bg-card outline-none transition-colors motion-reduce:transition-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <span className="h-12 w-0.5 rounded-full bg-input" />
            </div>
            <aside
              ref={asideRef}
              className="flex min-h-0 w-[var(--vf-workspace-aside,24rem)] min-w-0 max-w-[calc(100%-23.375rem)] shrink-0 flex-col bg-card/40 xl:w-[var(--vf-workspace-aside,27rem)]"
            >
              {inspector}
            </aside>
          </>
        )}

        {rail}
      </main>
    </div>
  )
}
