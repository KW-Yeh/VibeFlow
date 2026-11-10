import { lazy, memo, Suspense, useSyncExternalStore } from 'react'
import type { DiffMethod } from 'react-diff-viewer-continued'
import { ChevronRight, Loader2 } from 'lucide-react'

import { DialogShell } from '@/components/ui/dialog-shell'
import { readDiffView, writeDiffView, type DiffViewPrefs } from '@/lib/view-persistence'
import { cn } from '@/lib/utils'
import type { DiffEntry, DiffFile } from '@/lib/types'

const ReactDiffViewer = lazy(() =>
  import('react-diff-viewer-continued').then((m) => ({ default: m.default }))
)

/**
 * Cap the diff list is truncated at, so the UI can say so instead of silently
 * showing a short list. Must match MAX_DIFF_FILES in packages/core/src/git.ts (value
 * duplicated because the renderer cannot runtime-import main-process modules).
 */
export const MAX_DIFF_FILES = 80

export const STATUS_LABEL: Record<string, string> = {
  A: '新增',
  M: '修改',
  D: '刪除',
  R: '更名',
  '?': '未追蹤',
}

// One preference for every diff on screen: the single-file modal and the
// full-screen view must not disagree about how a diff is laid out.
const DEFAULT_DIFF_VIEW: DiffViewPrefs = { split: false, fullContext: false, groupBy: 'all' }
const diffViewListeners = new Set<() => void>()
let diffView: DiffViewPrefs | null = null

function getDiffView(): DiffViewPrefs {
  if (diffView === null) diffView = readDiffView()
  return diffView
}

export function setDiffView(patch: Partial<DiffViewPrefs>) {
  diffView = { ...getDiffView(), ...patch }
  writeDiffView(diffView)
  for (const listener of diffViewListeners) listener()
}

function subscribeDiffView(listener: () => void) {
  diffViewListeners.add(listener)
  return () => {
    diffViewListeners.delete(listener)
  }
}

export function useDiffView(): DiffViewPrefs {
  return useSyncExternalStore(subscribeDiffView, getDiffView, () => DEFAULT_DIFF_VIEW)
}

export const DiffFileViewer = memo(function DiffFileViewer({
  file,
  /** False inside the sidebar accordion, whose row already shows status + path. */
  showHeader = true,
}: {
  file: DiffFile
  showHeader?: boolean
}) {
  const { split, fullContext } = useDiffView()
  return (
    <div className={cn('overflow-hidden', showHeader && 'rounded-md border border-border/70')}>
      {showHeader && (
        <div className="flex items-center gap-2 border-b border-border/70 bg-muted/30 px-2 py-1.5">
          <span className="rounded-xs bg-secondary px-1.5 py-0.5 text-xs font-medium text-secondary-foreground">
            {STATUS_LABEL[file.status] ?? file.status}
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-xs" title={file.path}>
            {file.path}
          </span>
          {file.truncated && (
            <span className="shrink-0 text-xs text-muted-foreground">
              已截斷
            </span>
          )}
        </div>
      )}
      <div className="min-w-0 max-w-full overflow-x-auto text-xs [&_.diff-content]:whitespace-pre-wrap [&_.diff-content]:break-words [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_table]:min-w-full [&_table]:table-fixed [&_td]:min-w-0 [&_td]:align-top">
        <Suspense fallback={null}>
          <ReactDiffViewer
            oldValue={file.oldValue}
            newValue={file.newValue}
            splitView={split}
            showDiffOnly={!fullContext}
            useDarkTheme
            compareMethod={'diffLines' as unknown as DiffMethod}
            renderContent={(source) => (
              <span className="block min-w-0 max-w-full whitespace-pre-wrap break-words">
                {source}
              </span>
            )}
            styles={{
              // Colour overrides go under variables.dark (paired with the
              // useDarkTheme prop above). Text colours read app tokens via
              // var(); the diff +/- tints need an alpha a single CSS var
              // can't carry, so those are whitelisted near-hardcodes aligned
              // to --success (#4ec98a) / --destructive (#e5484d) / --primary
              // (#4c9bf5). See PLAN §2.2 whitelist item 3.
              variables: {
                dark: {
                  diffViewerBackground: 'var(--card)',
                  diffViewerColor: 'var(--card-foreground)',
                  addedBackground: 'rgba(78, 201, 138, 0.15)',
                  addedColor: 'var(--foreground)',
                  removedBackground: 'rgba(229, 72, 77, 0.15)',
                  removedColor: 'var(--foreground)',
                  wordAddedBackground: 'rgba(78, 201, 138, 0.32)',
                  wordRemovedBackground: 'rgba(229, 72, 77, 0.32)',
                  addedGutterBackground: 'rgba(78, 201, 138, 0.20)',
                  removedGutterBackground: 'rgba(229, 72, 77, 0.20)',
                  gutterBackground: 'var(--muted)',
                  gutterBackgroundDark: 'var(--muted)',
                  gutterColor: 'var(--muted-foreground)',
                  addedGutterColor: 'var(--foreground)',
                  removedGutterColor: 'var(--foreground)',
                  highlightBackground: 'rgba(76, 155, 245, 0.15)',
                  highlightGutterBackground: 'rgba(76, 155, 245, 0.20)',
                  codeFoldGutterBackground: 'var(--muted)',
                  codeFoldBackground: 'var(--secondary)',
                  codeFoldContentColor: 'var(--muted-foreground)',
                  emptyLineBackground: 'var(--card)',
                },
              },
              diffContainer: {
                width: '100%',
                maxWidth: '100%',
                overflowX: 'visible',
              },
              line: {
                width: '100%',
              },
              content: {
                width: '100%',
                maxWidth: '100%',
                overflowX: 'visible',
              },
              contentText: {
                display: 'block',
                width: '100%',
                maxWidth: '100%',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                wordBreak: 'break-word',
              },
              lineContent: {
                display: 'block',
                width: '100%',
                maxWidth: '100%',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                wordBreak: 'break-word',
              },
              gutter: {
                maxWidth: '2.5rem',
                minWidth: '2.5rem',
                width: '2.5rem',
                paddingLeft: '0.25rem',
                paddingRight: '0.25rem',
                whiteSpace: 'nowrap',
              },
            }}
          />
        </Suspense>
      </div>
    </div>
  )
})

const DIFF_TOGGLE_CLASS =
  'rounded-sm px-2 py-1 text-xs outline-none transition-colors motion-reduce:transition-none'

/** Layout (unified / side by side) and context (changes only / whole file) for every diff. */
export function DiffViewToggles() {
  const { split, fullContext } = useDiffView()
  const option = (active: boolean) =>
    cn(
      DIFF_TOGGLE_CLASS,
      active
        ? 'bg-primary/15 text-primary'
        : 'text-muted-foreground hover:bg-accent hover:text-foreground'
    )
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label="Diff 版面" className="flex rounded-md border border-border/70 p-0.5">
        <button type="button" aria-pressed={!split} onClick={() => setDiffView({ split: false })} className={cn('focus-visible:ring-[3px] focus-visible:ring-ring/50', option(!split))}>
          整合
        </button>
        <button type="button" aria-pressed={split} onClick={() => setDiffView({ split: true })} className={cn('focus-visible:ring-[3px] focus-visible:ring-ring/50', option(split))}>
          左右對照
        </button>
      </div>
      <button
        type="button"
        aria-pressed={fullContext}
        onClick={() => setDiffView({ fullContext: !fullContext })}
        title={fullContext ? '只顯示變更附近的行' : '顯示檔案的所有行'}
        className={cn('border border-border/70 focus-visible:ring-[3px] focus-visible:ring-ring/50', option(fullContext))}
      >
        {fullContext ? '收合未變更' : '全部展開'}
      </button>
    </div>
  )
}

/**
 * One changed file's diff, on its own. Opening a file from the list lands here
 * rather than expanding it in place — a diff needs the width and the scroll
 * height, both of which the sidebar list denies it.
 */
export function DiffFileModal({
  entry,
  file,
  onClose,
}: {
  entry: DiffEntry
  /** `undefined` while the body loads, `null` when it could not be read. */
  file: DiffFile | null | undefined
  onClose: () => void
}) {
  return (
    <DialogShell
      title={entry.path}
      description={
        <span className="flex items-center gap-2">
          <span>{STATUS_LABEL[entry.status] ?? entry.status}</span>
          {(entry.additions > 0 || entry.deletions > 0) && (
            <span className="font-mono tabular-nums">
              <span className="text-success">+{entry.additions}</span>
              <span className="ml-1 text-destructive">−{entry.deletions}</span>
            </span>
          )}
          {file?.truncated && <span>· 已截斷</span>}
        </span>
      }
      onClose={onClose}
      showHeader
      contentClassName="max-w-6xl"
      bodyClassName="p-4"
    >
      {file === undefined ? (
        <div className="flex h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          讀取內容中…
        </div>
      ) : file === null ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          讀不到這個檔案的內容。
        </p>
      ) : (
        <div className="space-y-3">
          <DiffViewToggles />
          <DiffFileViewer file={file} showHeader={false} />
        </div>
      )}
    </DialogShell>
  )
}

/** One changed file in a list; opens its diff. */
export function DiffEntryRow({
  entry,
  onOpen,
}: {
  entry: Pick<DiffEntry, 'path' | 'status' | 'additions' | 'deletions'>
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`檢視 ${entry.path} 的 diff`}
      className="flex w-full items-center gap-2 rounded-md border border-border/70 bg-muted/30 px-2 py-1.5 text-left outline-none transition-colors motion-reduce:transition-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <DiffStatusBadge status={entry.status} />
      <span className="min-w-0 flex-1 truncate font-mono text-xs" title={entry.path}>
        {entry.path}
      </span>
      <LineCounts additions={entry.additions} deletions={entry.deletions} />
      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
    </button>
  )
}

export function DiffStatusBadge({ status }: { status: string }) {
  return (
    <span className="shrink-0 rounded-xs bg-secondary px-1.5 py-0.5 text-xs font-medium text-secondary-foreground">
      {STATUS_LABEL[status] ?? status}
    </span>
  )
}

export function LineCounts({ additions, deletions }: { additions: number; deletions: number }) {
  if (additions === 0 && deletions === 0) return null
  return (
    <span className="shrink-0 font-mono text-xs tabular-nums">
      <span className="text-success">+{additions}</span>
      <span className="ml-1 text-destructive">−{deletions}</span>
    </span>
  )
}
