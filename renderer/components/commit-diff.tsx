import { useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence } from 'motion/react'
import { ChevronDown, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'

import {
  DiffEntryRow,
  DiffFileModal,
  DiffStatusBadge,
  LineCounts,
  MAX_DIFF_FILES,
  setDiffView,
  useDiffView,
} from '@/components/diff-file'
import {
  getCommitEntries,
  getCommitFile,
  getDoneCommitDiff,
  getDoneCommitFile,
  listCommits,
} from '@/lib/api'
import { relativeTime } from '@/lib/github-display'
import { isModalOpen } from '@/lib/modal-presence'
import { cn } from '@/lib/utils'
import type {
  BranchCommits,
  CommitDiff,
  CommitSummary,
  DiffEntry,
  DiffFile,
  OutcomeCommit,
  PatchFile,
} from '@/lib/types'

/** The id core takes for the uncommitted changes. */
const WORKING = 'working'
const POLL_INTERVAL_MS = 3000

const ROW_CLASS =
  'flex w-full rounded-md border border-border/70 bg-muted/30 p-2 text-left outline-none transition-colors motion-reduce:transition-none hover:bg-accent'

const ago = (ms: number) => relativeTime(new Date(ms).toISOString())

/** "全部 / 依 commit" — which list the Git diff tab shows. */
export function DiffGroupToggle() {
  const { groupBy } = useDiffView()
  const option = (value: 'all' | 'commit', label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={groupBy === value}
      onClick={() => setDiffView({ groupBy: value })}
      className={cn(
        'rounded-sm px-2.5 py-0.5 text-xs outline-none transition-colors motion-reduce:transition-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        groupBy === value
          ? 'bg-primary/15 text-primary'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
      )}
    >
      {label}
    </button>
  )
  return (
    <div role="radiogroup" aria-label="Diff 分組" className="flex w-fit rounded-md border border-border/70 p-0.5">
      {option('all', '全部')}
      {option('commit', '依 commit')}
    </div>
  )
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
      <Loader2 className="size-3.5 animate-spin" />
      {label}
    </div>
  )
}

function CommitHeader({
  sha,
  subject,
  meta,
  onBack,
}: {
  sha: string
  subject: string
  meta?: ReactNode
  onBack: () => void
}) {
  return (
    <div className="mb-2 space-y-1.5 rounded-md border border-border/70 bg-card px-2.5 py-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="返回 commit 清單"
          className="flex items-center gap-0.5 rounded-sm bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground outline-none transition-colors motion-reduce:transition-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <ChevronLeft className="size-3.5" />
          返回
        </button>
        {sha && <span className="font-mono text-xs text-primary">{sha}</span>}
        {meta}
      </div>
      <p className="break-words text-sm font-medium">{subject}</p>
    </div>
  )
}

function FileList({
  entries,
  truncated,
  onOpen,
}: {
  entries: DiffEntry[]
  truncated?: boolean
  onOpen: (entry: DiffEntry) => void
}) {
  if (entries.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">這個 commit 沒有檔案變更。</p>
  }
  return (
    <>
      <ul className="space-y-1">
        {entries.map((entry) => (
          <li key={entry.path}>
            <DiffEntryRow entry={entry} onOpen={() => onOpen(entry)} />
          </li>
        ))}
      </ul>
      {(truncated || entries.length >= MAX_DIFF_FILES) && (
        <p className="mt-2 text-xs text-muted-foreground">
          變更檔案超過 {MAX_DIFF_FILES} 個，僅顯示前 {MAX_DIFF_FILES} 個。
        </p>
      )}
    </>
  )
}

/**
 * The opened file of a commit. `load` is asked once per opening; the modal
 * shows a spinner until it answers and a "cannot read" note on null.
 */
function useFileModal(load: (entry: DiffEntry) => Promise<DiffFile | null>) {
  const [entry, setEntry] = useState<DiffEntry | null>(null)
  const [file, setFile] = useState<DiffFile | null | undefined>(undefined)

  useEffect(() => {
    if (!entry) return
    let active = true
    setFile(undefined)
    load(entry)
      .then((next) => active && setFile(next))
      .catch(() => active && setFile(null))
    return () => {
      active = false
    }
  }, [entry])

  const modal = (
    <AnimatePresence>
      {entry && (
        <DiffFileModal key={entry.path} entry={entry} file={file} onClose={() => setEntry(null)} />
      )}
    </AnimatePresence>
  )
  return { open: setEntry, modal }
}

// --- Running card -------------------------------------------------------------

/** The branch's commits, polled locally while this view is on screen. */
function useBranchCommits(taskId: string) {
  const [data, setData] = useState<BranchCommits | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let loaded = false
    const tick = async () => {
      if (loaded && isModalOpen()) {
        if (active) timer = setTimeout(() => void tick(), POLL_INTERVAL_MS)
        return
      }
      loaded = true
      try {
        const next = await listCommits(taskId)
        if (!active) return
        setData((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next))
        setError(null)
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (active) timer = setTimeout(() => void tick(), POLL_INTERVAL_MS)
      }
    }
    void tick()
    return () => {
      active = false
      if (timer) clearTimeout(timer)
    }
  }, [taskId])

  return { data, error }
}

/** Files of one commit, or of the uncommitted changes (which follow each poll). */
function useCommitEntries(taskId: string, ref: string | null, pollKey: unknown) {
  const [entries, setEntries] = useState<DiffEntry[] | null | undefined>(undefined)
  useEffect(() => {
    setEntries(undefined)
  }, [taskId, ref])
  useEffect(() => {
    if (!ref) return
    let active = true
    getCommitEntries(taskId, ref)
      .then((next) => active && setEntries(next))
      .catch(() => active && setEntries(null))
    return () => {
      active = false
    }
    // A commit never changes; only the uncommitted list follows the poll.
  }, [taskId, ref, ref === WORKING ? pollKey : null])
  return entries
}

function CommitRow({ commit, onOpen }: { commit: CommitSummary; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} title={commit.subject} className={cn(ROW_CLASS, 'focus-visible:ring-[3px] focus-visible:ring-ring/50', 'flex-col gap-1')}>
      <span className="flex w-full items-center gap-2">
        <span className="shrink-0 font-mono text-xs text-primary">{commit.shortSha}</span>
        <span className="min-w-0 flex-1 truncate text-sm">{commit.subject}</span>
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
      </span>
      <span className="flex items-center gap-2.5 text-xs text-muted-foreground">
        <span>{ago(commit.authoredAt)}</span>
        <span>{commit.fileCount} 個檔案</span>
        <LineCounts additions={commit.additions} deletions={commit.deletions} />
        {commit.isMerge && (
          <span className="rounded-xs bg-secondary px-1.5 text-secondary-foreground">merge</span>
        )}
      </span>
    </button>
  )
}

/** The Git diff tab grouped by commit: uncommitted changes, then `base..HEAD`. */
export function CommitDiffContent({ taskId }: { taskId: string }) {
  const { data, error } = useBranchCommits(taskId)
  const [selected, setSelected] = useState<string | null>(null)
  const entries = useCommitEntries(taskId, selected, data)
  const { open, modal } = useFileModal((entry) => getCommitFile(taskId, selected ?? WORKING, entry.path))

  // The open commit can leave the list (amended, rebased) and the uncommitted
  // changes can all be committed; there is nothing left to show for either.
  useEffect(() => {
    if (!data || !selected) return
    const gone =
      selected === WORKING ? data.working === null : !data.commits.some((c) => c.sha === selected)
    if (gone) setSelected(null)
  }, [data, selected])

  if (data === undefined) return <Spinner label="讀取 commit 中…" />
  if (error && !data) {
    return <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm">{error}</div>
  }
  if (!data || (data.commits.length === 0 && !data.working)) {
    return <p className="py-10 text-center text-sm text-muted-foreground">與基準分支相比沒有變更。</p>
  }

  if (selected) {
    const commit = data.commits.find((c) => c.sha === selected)
    return (
      <>
        <CommitHeader
          sha={commit?.shortSha ?? ''}
          subject={commit?.subject ?? '未 commit 的變更'}
          meta={commit && <span className="text-xs text-muted-foreground">{ago(commit.authoredAt)}</span>}
          onBack={() => setSelected(null)}
        />
        {entries === undefined ? (
          <Spinner label="讀取檔案中…" />
        ) : entries === null ? (
          <p className="py-6 text-center text-sm text-muted-foreground">讀不到這個 commit 的變更。</p>
        ) : (
          <FileList entries={entries} onOpen={open} />
        )}
        {modal}
      </>
    )
  }

  return (
    <>
      <ul className="space-y-1">
        {data.working && (
          <li>
            <button
              type="button"
              onClick={() => setSelected(WORKING)}
              className={cn(ROW_CLASS, 'focus-visible:ring-[3px] focus-visible:ring-ring/50', 'items-center gap-2 border-dashed border-warning/50 bg-warning/10 hover:bg-warning/15')}
            >
              <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-warning" />
              <span className="min-w-0 flex-1 text-sm font-medium">未 commit 的變更</span>
              <span className="text-xs text-muted-foreground">{data.working.fileCount} 個檔案</span>
              <LineCounts additions={data.working.additions} deletions={data.working.deletions} />
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          </li>
        )}
        {data.commits.map((commit) => (
          <li key={commit.sha}>
            <CommitRow commit={commit} onOpen={() => setSelected(commit.sha)} />
          </li>
        ))}
      </ul>
      {data.truncated && (
        <p className="mt-2 text-xs text-muted-foreground">commit 超過 {data.commits.length} 個，僅顯示最新的 {data.commits.length} 個。</p>
      )}
    </>
  )
}

// --- Done card ----------------------------------------------------------------

/** A unified patch, one coloured line per diff line. */
function PatchView({ patch }: { patch: string }) {
  return (
    <pre className="overflow-x-auto bg-card py-1 font-mono text-xs leading-5">
      {patch.split('\n').map((line, i) => (
        <div
          key={i}
          className={cn(
            'whitespace-pre-wrap break-words px-2.5',
            line.startsWith('@@')
              ? 'text-primary'
              : line.startsWith('+')
                ? 'bg-success/15 text-foreground'
                : line.startsWith('-')
                  ? 'bg-destructive/15 text-foreground'
                  : 'text-muted-foreground'
          )}
        >
          {line || ' '}
        </div>
      ))}
    </pre>
  )
}

function PatchFileItem({ file, defaultOpen }: { file: PatchFile; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const hasPatch = file.patch !== undefined
  return (
    <div className="overflow-hidden rounded-md border border-border/70">
      <button
        type="button"
        disabled={!hasPatch}
        aria-expanded={hasPatch ? open : undefined}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 bg-muted/30 px-2 py-1.5 text-left outline-none transition-colors motion-reduce:transition-none enabled:hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <DiffStatusBadge status={file.status} />
        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={file.path}>
          {file.path}
        </span>
        {hasPatch ? (
          <>
            <LineCounts additions={file.additions} deletions={file.deletions} />
            {open ? (
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
            )}
          </>
        ) : (
          <span className="shrink-0 text-xs text-muted-foreground">GitHub 未提供此檔的 diff</span>
        )}
      </button>
      {hasPatch && open && (
        <>
          <PatchView patch={file.patch ?? ''} />
          {file.truncated && <p className="px-2.5 pb-1.5 text-xs text-muted-foreground">內容過長，已截斷。</p>}
        </>
      )}
    </div>
  )
}

const SOURCE_BADGE_CLASS = 'ml-auto shrink-0 rounded-xs border border-border/70 px-1.5 text-xs text-muted-foreground'

/** One done-card commit, fetched when opened and kept for as long as the sheet is. */
function DoneCommitView({
  taskId,
  commit,
  diff,
  prNumber,
  onBack,
}: {
  taskId: string
  commit: OutcomeCommit
  diff: CommitDiff | undefined
  prNumber?: number
  onBack: () => void
}) {
  const { open, modal } = useFileModal((entry) =>
    getDoneCommitFile(taskId, commit.sha, entry.path)
  )
  const badge =
    diff?.source === 'git' ? (
      <span className={SOURCE_BADGE_CLASS}>來源：本地 git</span>
    ) : diff?.source === 'github' ? (
      <span className={SOURCE_BADGE_CLASS}>來源：GitHub{prNumber ? ` #${prNumber}` : ''}</span>
    ) : null

  return (
    <>
      <CommitHeader sha={commit.sha} subject={commit.subject} meta={badge} onBack={onBack} />
      {diff === undefined ? (
        <Spinner label="讀取 commit 中…" />
      ) : diff.source === 'none' ? (
        <div className="space-y-1 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          <p>讀不到這個 commit 的變更。</p>
          <p className="text-xs text-muted-foreground">{diff.reason}</p>
        </div>
      ) : diff.source === 'git' ? (
        <FileList entries={diff.files} truncated={diff.truncated} onOpen={open} />
      ) : diff.files.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">這個 commit 沒有檔案變更。</p>
      ) : (
        <div className="space-y-1.5">
          {diff.files.map((file) => (
            <PatchFileItem key={file.path} file={file} defaultOpen={diff.files.length <= 10} />
          ))}
          {diff.truncated && (
            <p className="text-xs text-muted-foreground">變更檔案超過 {MAX_DIFF_FILES} 個，僅顯示前 {MAX_DIFF_FILES} 個。</p>
          )}
        </div>
      )}
      {modal}
    </>
  )
}

/**
 * A done card's Git diff tab. The commit list is what the card recorded when it
 * finished; nothing is read until a commit is opened.
 */
export function DoneCommitDiffContent({
  taskId,
  commits,
  prNumber,
}: {
  taskId: string
  commits: OutcomeCommit[]
  prNumber?: number
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const [diffs, setDiffs] = useState<Record<string, CommitDiff>>({})

  useEffect(() => {
    if (!selected || selected in diffs) return
    let active = true
    getDoneCommitDiff(taskId, selected)
      .then((diff) => active && setDiffs((current) => ({ ...current, [selected]: diff })))
      .catch(
        (err) =>
          active &&
          setDiffs((current) => ({
            ...current,
            [selected]: { source: 'none', reason: err instanceof Error ? err.message : String(err) },
          }))
      )
    return () => {
      active = false
    }
  }, [taskId, selected, diffs])

  const commit = commits.find((c) => c.sha === selected)
  if (commit) {
    return (
      <DoneCommitView
        taskId={taskId}
        commit={commit}
        diff={diffs[commit.sha]}
        prNumber={prNumber}
        onBack={() => setSelected(null)}
      />
    )
  }

  return (
    <ul className="space-y-1">
      {commits.map((c) => (
        <li key={c.sha}>
          <button type="button" onClick={() => setSelected(c.sha)} title={c.subject} className={cn(ROW_CLASS, 'focus-visible:ring-[3px] focus-visible:ring-ring/50', 'items-center gap-2')}>
            <span className="shrink-0 font-mono text-xs text-primary">{c.sha}</span>
            <span className="min-w-0 flex-1 truncate text-sm">{c.subject}</span>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </li>
      ))}
    </ul>
  )
}
