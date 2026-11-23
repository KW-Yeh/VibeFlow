import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { Check, Pencil, Plus, Tag, Trash2, X } from 'lucide-react'

import { MENU_ITEM, useDismissible } from '@/components/board-columns'
import { fieldClass } from '@/components/ui/field'
import { HoldButton } from '@/components/ui/hold-button'
import { IconButton } from '@/components/ui/icon-button'
import { deleteTag, setTaskTags, updateTag } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { TagColor, TagDef, Task, VibeFlowState } from '@/lib/types'
import { TAG_COLORS } from '@/lib/tag-colors'

const TAG_TINT: Record<TagColor, string> = {
  gray: 'bg-tag-gray/15 text-tag-gray',
  red: 'bg-tag-red/15 text-tag-red',
  orange: 'bg-tag-orange/15 text-tag-orange',
  amber: 'bg-tag-amber/15 text-tag-amber',
  green: 'bg-tag-green/15 text-tag-green',
  teal: 'bg-tag-teal/15 text-tag-teal',
  blue: 'bg-tag-blue/15 text-tag-blue',
  purple: 'bg-tag-purple/15 text-tag-purple',
}

const TAG_DOT: Record<TagColor, string> = {
  gray: 'bg-tag-gray',
  red: 'bg-tag-red',
  orange: 'bg-tag-orange',
  amber: 'bg-tag-amber',
  green: 'bg-tag-green',
  teal: 'bg-tag-teal',
  blue: 'bg-tag-blue',
  purple: 'bg-tag-purple',
}

const COLOR_LABEL: Record<TagColor, string> = {
  gray: '灰', red: '紅', orange: '橘', amber: '琥珀', green: '綠', teal: '青', blue: '藍', purple: '紫',
}

interface TagsValue {
  tags: TagDef[]
  /** Take in the state a tag call answered with. */
  applyState: (state: VibeFlowState | null) => void
}

const TagsContext = createContext<TagsValue>({ tags: [], applyState: () => {} })

export function TagsProvider({ value, children }: { value: TagsValue; children: ReactNode }) {
  return <TagsContext.Provider value={value}>{children}</TagsContext.Provider>
}

export function useTags(): TagsValue {
  return useContext(TagsContext)
}

/** A card's tags, in the order it got them; tags beyond `max` fold into "+N". */
export function TagChips({ task, max = 3, className }: { task: Pick<Task, 'tags'>; max?: number; className?: string }) {
  const { tags } = useTags()
  const own = (task.tags ?? []).flatMap((id) => tags.find((t) => t.id === id) ?? [])
  if (own.length === 0) return null
  const shown = own.slice(0, max)
  const hidden = own.slice(max)
  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-1', className)} aria-label="標籤">
      {shown.map((tag) => (
        <span
          key={tag.id}
          title={tag.name}
          className={cn('max-w-full truncate rounded-xs px-1.5 py-0.5 text-[11px] font-medium leading-none', TAG_TINT[tag.color])}
        >
          {tag.name}
        </span>
      ))}
      {hidden.length > 0 && (
        <span
          title={hidden.map((t) => t.name).join('、')}
          className="rounded-xs bg-muted px-1.5 py-0.5 text-[11px] font-medium leading-none text-muted-foreground"
        >
          +{hidden.length}
        </span>
      )}
    </div>
  )
}

const PICKER_WIDTH = 272
const PICKER_HEIGHT = 360

function ColorSwatches({ value, onChange }: { value: TagColor; onChange: (color: TagColor) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="標籤顏色">
      {TAG_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={color === value}
          aria-label={COLOR_LABEL[color]}
          title={COLOR_LABEL[color]}
          onClick={() => onChange(color)}
          className={cn(
            'size-5 rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
            TAG_DOT[color],
            color === value && 'ring-2 ring-foreground ring-offset-2 ring-offset-popover'
          )}
        />
      ))}
    </div>
  )
}

function TagEditor({ tag, onDone, run }: { tag: TagDef; onDone: () => void; run: (call: () => Promise<VibeFlowState | null>) => Promise<boolean> }) {
  const [name, setName] = useState(tag.name)
  const [color, setColor] = useState<TagColor>(tag.color)
  const save = async () => {
    const patch = { ...(name.trim() !== tag.name ? { name } : {}), ...(color !== tag.color ? { color } : {}) }
    if (Object.keys(patch).length === 0 || (await run(() => updateTag(tag.id, patch)))) onDone()
  }
  return (
    <div className="space-y-2 rounded-sm bg-accent/40 p-2">
      <input
        aria-label="標籤名稱"
        value={name}
        autoFocus
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void save()
          if (event.key === 'Escape') {
            event.stopPropagation()
            onDone()
          }
        }}
        className={cn(fieldClass, 'h-8 px-2 py-1 text-sm')}
      />
      <ColorSwatches value={color} onChange={setColor} />
      <div className="flex items-center gap-1">
        <HoldButton
          onConfirm={() => void run(() => deleteTag(tag.id)).then((ok) => ok && onDone())}
          title={`按住以刪除標籤「${tag.name}」，並從所有卡片移除`}
          className={cn(MENU_ITEM, 'w-auto flex-1 text-destructive hover:bg-destructive/15')}
        >
          <Trash2 className="size-3.5 shrink-0" />
          按住刪除
        </HoldButton>
        <button
          type="button"
          onClick={onDone}
          className={cn('focus-visible:ring-[3px] focus-visible:ring-ring/50', MENU_ITEM, 'w-auto hover:bg-accent')}
        >
          取消
        </button>
        <button
          type="button"
          onClick={() => void save()}
          className={cn('focus-visible:ring-[3px] focus-visible:ring-ring/50', MENU_ITEM, 'w-auto bg-primary/15 text-primary hover:bg-primary/25')}
        >
          儲存
        </button>
      </div>
    </div>
  )
}

/**
 * Put tags on a card and manage the board's tags: tick to apply, type a new
 * name to create one, edit to rename, recolour or delete it everywhere.
 */
export function TagPicker({
  task,
  anchor,
  onClose,
}: {
  task: Task
  /** Viewport point the picker hangs from (its top-right corner). */
  anchor: { top: number; right: number }
  onClose: () => void
}) {
  const { tags, applyState } = useTags()
  const ref = useDismissible(true, onClose)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const left = Math.max(8, Math.min(anchor.right - PICKER_WIDTH, window.innerWidth - PICKER_WIDTH - 8))
  const top = Math.max(8, Math.min(anchor.top, window.innerHeight - PICKER_HEIGHT))

  const own = new Set(task.tags ?? [])
  const needle = query.trim().toLowerCase()
  const listed = useMemo(
    () => (needle ? tags.filter((t) => t.name.toLowerCase().includes(needle)) : tags),
    [tags, needle]
  )
  const exact = needle ? tags.find((t) => t.name.toLowerCase() === needle) : undefined

  const run = async (call: () => Promise<VibeFlowState | null>): Promise<boolean> => {
    setError(null)
    try {
      applyState(await call())
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return false
    }
  }
  const toggle = (tag: TagDef) =>
    void run(() => setTaskTags(task.id, own.has(tag.id) ? { remove: [tag.id] } : { add: [tag.id] }))
  const addTyped = async () => {
    if (!needle) return
    if (exact) {
      if (!own.has(exact.id)) toggle(exact)
    } else if (await run(() => setTaskTags(task.id, { add: [query.trim()] }))) {
      setQuery('')
    }
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`標籤：${task.title}`}
      style={{ top, left, width: PICKER_WIDTH }}
      onClick={(event) => event.stopPropagation()}
      className="fixed z-50 flex max-h-[360px] flex-col gap-1 rounded-md border border-border bg-popover p-1.5 text-popover-foreground shadow-lg"
    >
      <div className="flex items-center gap-1">
        <input
          aria-label="搜尋或新增標籤"
          placeholder="搜尋或新增標籤…"
          value={query}
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void addTyped()
          }}
          className={cn(fieldClass, 'h-8 px-2 py-1 text-sm')}
        />
        <IconButton aria-label="關閉" onClick={onClose} className="size-7 p-1">
          <X className="size-3.5" />
        </IconButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {listed.map((tag) =>
          editing === tag.id ? (
            <TagEditor key={tag.id} tag={tag} run={run} onDone={() => setEditing(null)} />
          ) : (
            <div key={tag.id} className="group flex items-center gap-1">
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={own.has(tag.id)}
                onClick={() => toggle(tag)}
                className={cn('focus-visible:ring-[3px] focus-visible:ring-ring/50', MENU_ITEM, 'min-w-0 flex-1 hover:bg-accent')}
              >
                <span className="flex size-3.5 shrink-0 items-center justify-center">
                  {own.has(tag.id) && <Check className="size-3.5" />}
                </span>
                <span className={cn('size-2 shrink-0 rounded-full', TAG_DOT[tag.color])} />
                <span className="min-w-0 flex-1 truncate">{tag.name}</span>
              </button>
              <IconButton
                aria-label={`編輯標籤：${tag.name}`}
                title="改名、換色或刪除"
                onClick={() => setEditing(tag.id)}
                className="size-6 p-1 opacity-60 group-hover:opacity-100"
              >
                <Pencil className="size-3" />
              </IconButton>
            </div>
          )
        )}
        {needle && !exact && (
          <button
            type="button"
            onClick={() => void addTyped()}
            className={cn('focus-visible:ring-[3px] focus-visible:ring-ring/50', MENU_ITEM, 'hover:bg-accent')}
          >
            <Plus className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">新增標籤「{query.trim()}」</span>
          </button>
        )}
        {tags.length === 0 && !needle && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">還沒有標籤。輸入名稱後按 Enter 新增。</p>
        )}
      </div>

      {error && <p className="px-2 text-xs text-destructive" role="alert">{error}</p>}
    </div>
  )
}


/** The button that opens a card's tag picker; the tags themselves show where there is room. */
export function TaskTagsControl({ task }: { task: Task }) {
  const { tags } = useTags()
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null)
  const names = (task.tags ?? []).flatMap((id) => tags.find((t) => t.id === id)?.name ?? [])
  return (
    <>
      <IconButton
        aria-label={`標籤：${task.title}`}
        aria-haspopup="dialog"
        aria-expanded={anchor !== null}
        title={names.length ? `標籤：${names.join('、')}` : '標籤'}
        className="p-1"
        onClick={(event) => {
          if (anchor) {
            setAnchor(null)
            return
          }
          const rect = event.currentTarget.getBoundingClientRect()
          setAnchor({ top: rect.bottom + 4, right: rect.right })
        }}
      >
        <Tag className="size-3.5" />
      </IconButton>
      {anchor && <TagPicker task={task} anchor={anchor} onClose={() => setAnchor(null)} />}
    </>
  )
}
