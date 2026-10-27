import { useCallback, useEffect, useRef, useState } from 'react'
import { Reorder, useDragControls } from 'motion/react'
import { ChevronLeft, ChevronRight, GripVertical, X } from 'lucide-react'

import { IconButton } from '@/components/ui/icon-button'
import { cn } from '@/lib/utils'
import type { ColumnId } from '@/lib/types'

export interface TerminalTab {
  taskId: string
  /**
   * VSCode-style preview tab: shown in italics and replaced *in place* by the
   * next preview tab, until an interaction (or a double click) pins it.
   */
  preview: boolean
}

export interface TerminalTabEntry extends TerminalTab {
  title: string
  column: ColumnId
}

interface TerminalTabBarProps {
  entries: TerminalTabEntry[]
  activeTaskId: string | null
  onSelect: (taskId: string) => void
  onPin: (taskId: string) => void
  onClose: (taskId: string) => void
  onReorder: (taskIds: string[]) => void
}

export function TerminalTabBar({
  entries,
  activeTaskId,
  onSelect,
  onPin,
  onClose,
  onReorder,
}: TerminalTabBarProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScroll, setCanScroll] = useState({ left: false, right: false })

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const left = el.scrollLeft > 0
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
    setCanScroll((prev) => (prev.left === left && prev.right === right ? prev : { left, right }))
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    updateScrollState()
    const observer = new ResizeObserver(updateScrollState)
    observer.observe(el)
    for (const child of Array.from(el.children)) observer.observe(child)
    return () => observer.disconnect()
  }, [entries, updateScrollState])

  // With the scrollbar gone, the selected tab must never be left off-screen.
  useEffect(() => {
    if (!activeTaskId) return
    scrollRef.current
      ?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(activeTaskId)}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeTaskId])

  const scrollBy = (direction: -1 | 1) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: 'smooth' })
  }

  if (entries.length === 0) return null

  const overflowing = canScroll.left || canScroll.right

  return (
    <div className="flex h-9 shrink-0 items-stretch border-b border-border bg-card/40">
      {overflowing && (
        <div className="flex shrink-0 items-center border-r border-border/60 px-0.5">
          <IconButton
            aria-label="向左捲動分頁"
            disabled={!canScroll.left}
            onClick={() => scrollBy(-1)}
            className="rounded-sm p-1"
          >
            <ChevronLeft className="size-4" />
          </IconButton>
        </div>
      )}
      <Reorder.Group
        as="div"
        axis="x"
        values={entries}
        onReorder={(next: TerminalTabEntry[]) => onReorder(next.map((entry) => entry.taskId))}
        ref={scrollRef}
        layoutScroll
        onScroll={updateScrollState}
        onWheel={(event) => {
          // A plain mouse wheel only scrolls vertically; turn it sideways here.
          const el = scrollRef.current
          if (!el || event.deltaX !== 0 || event.deltaY === 0) return
          el.scrollLeft += event.deltaY
        }}
        className="flex min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {entries.map((entry) => (
          <TabItem
            key={entry.taskId}
            entry={entry}
            active={entry.taskId === activeTaskId}
            onSelect={onSelect}
            onPin={onPin}
            onClose={onClose}
          />
        ))}
      </Reorder.Group>
      {overflowing && (
        <div className="flex shrink-0 items-center border-l border-border/60 px-0.5">
          <IconButton
            aria-label="向右捲動分頁"
            disabled={!canScroll.right}
            onClick={() => scrollBy(1)}
            className="rounded-sm p-1"
          >
            <ChevronRight className="size-4" />
          </IconButton>
        </div>
      )}
    </div>
  )
}

function TabItem({
  entry,
  active,
  onSelect,
  onPin,
  onClose,
}: {
  entry: TerminalTabEntry
  active: boolean
  onSelect: (taskId: string) => void
  onPin: (taskId: string) => void
  onClose: (taskId: string) => void
}) {
  // Reordering starts only from the grip, so a click or drag anywhere else on
  // the tab keeps meaning "select" and never moves it by accident.
  const dragControls = useDragControls()
  const [dragging, setDragging] = useState(false)

  return (
    <Reorder.Item
      as="div"
      value={entry}
      dragListener={false}
      dragControls={dragControls}
      data-tab-id={entry.taskId}
      onDragStart={() => setDragging(true)}
      onDragEnd={() => setDragging(false)}
      className={cn(
        'group relative flex h-full min-w-0 max-w-52 shrink-0 select-none items-center gap-1 border-r border-border/60 pl-1 pr-1.5 transition-colors motion-reduce:transition-none',
        active
          ? 'bg-background text-foreground'
          : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground',
        dragging && 'z-10 bg-card shadow-lg'
      )}
    >
      <span
        title="按住拖曳以調整分頁順序"
        onPointerDown={(event) => {
          event.preventDefault()
          dragControls.start(event)
        }}
        className={cn(
          'flex h-5 w-3.5 shrink-0 cursor-grab touch-none items-center justify-center rounded-sm text-muted-foreground/70 transition-opacity active:cursor-grabbing motion-reduce:transition-none hover:text-foreground',
          active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        )}
      >
        <GripVertical className="size-3" />
      </span>
      <button
        type="button"
        aria-current={active ? 'page' : undefined}
        title={entry.title}
        onClick={() => onSelect(entry.taskId)}
        onDoubleClick={() => onPin(entry.taskId)}
        onAuxClick={(event) => {
          if (event.button === 1) onClose(entry.taskId)
        }}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm py-0.5 text-left text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            entry.column === 'in_progress'
              ? 'bg-warning animate-pulse'
              : 'bg-muted-foreground/50'
          )}
        />
        <span className={cn('min-w-0 truncate', entry.preview && 'italic')}>
          {entry.title}
        </span>
      </button>
      <button
        type="button"
        aria-label={`關閉分頁 ${entry.title}`}
        title="關閉分頁（執行中的 agent 會繼續在背景執行）"
        onClick={() => onClose(entry.taskId)}
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-sm outline-none transition-colors motion-reduce:transition-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:opacity-100',
          active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        )}
      >
        <X className="size-3" />
      </button>
    </Reorder.Item>
  )
}
