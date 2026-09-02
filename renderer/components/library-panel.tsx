import { useCallback, useEffect, useState } from 'react'
import { FileText, FolderInput, Loader2, Plus, RefreshCw, Terminal, Trash2, Wrench } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { fieldClass } from '@/components/ui/field'
import { SECTION_LABEL } from '@/components/ui/section-label'
import {
  createLibraryEntry,
  deleteLibraryEntry,
  importLibraryEntry,
  listLibrary,
  pickLibrarySource,
  readLibraryEntry,
  setLibraryEntryEnabled,
  updateLibraryEntry,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import type { LibraryEntry, LibraryKind } from '@/lib/types'

const KINDS: { id: LibraryKind; label: string; hint: string }[] = [
  {
    id: 'skill',
    label: 'Skills',
    hint: '兩個 agent 都會載入。import 需選擇含 SKILL.md 的目錄。',
  },
  {
    id: 'prompt',
    label: 'Prompts',
    hint: '啟用的內容會併入啟動時的 system prompt，排在 Settings 的 System Prompt 之前。',
  },
  {
    id: 'script',
    label: 'Scripts',
    hint: '路徑與用途會寫進 prompt，由 agent 自行決定要不要執行。',
  },
]

const KIND_ICON: Record<LibraryKind, typeof FileText> = {
  skill: Wrench,
  prompt: FileText,
  script: Terminal,
}

/** Starter body for a hand-written skill, so the frontmatter both CLIs need is present. */
function templateFor(kind: LibraryKind, name: string): string {
  if (kind !== 'skill') return ''
  return `---\nname: ${name}\ndescription: \n---\n\n`
}

interface DraftState {
  kind: LibraryKind
  name: string
  content: string
  description: string
}

export function LibraryPanel({
  onEditingChange,
}: {
  /** Editing owns the whole panel, so the host hides its own way out — two
      exits where one silently discards the edit is worse than one. */
  onEditingChange?: (editing: boolean) => void
}) {
  const [entries, setEntries] = useState<LibraryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftState | null>(null)
  const [editing, setEditing] = useState<{ entry: LibraryEntry; content: string } | null>(null)

  const refresh = useCallback(async () => {
    setEntries(await listLibrary())
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    onEditingChange?.(editing !== null)
  }, [editing, onEditingChange])

  /** Every mutation reports its own failure inline — a silent no-op would look
      like the library simply ignored the click. */
  const run = async (label: string, action: () => Promise<unknown>) => {
    setBusy(label)
    setError(null)
    try {
      await action()
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const handleImport = (kind: LibraryKind) =>
    run(`import:${kind}`, async () => {
      const sourcePath = await pickLibrarySource(kind)
      if (!sourcePath) return
      await importLibraryEntry(kind, sourcePath)
    })

  const handleReimport = (entry: LibraryEntry) =>
    run(`reimport:${entry.key}`, async () => {
      if (!entry.sourcePath) return
      await importLibraryEntry(entry.kind, entry.sourcePath)
    })

  const handleCreate = () => {
    if (!draft) return
    const { kind, name, content, description } = draft
    return run('create', async () => {
      await createLibraryEntry(kind, name, content, description.trim() || undefined)
      setDraft(null)
    })
  }

  const handleOpenEditor = (entry: LibraryEntry) =>
    run(`open:${entry.key}`, async () => {
      const content = await readLibraryEntry(entry.kind, entry.name)
      setEditing({ entry, content: content ?? '' })
    })

  const handleSaveEditor = () => {
    if (!editing) return
    const { entry, content } = editing
    return run(`save:${entry.key}`, async () => {
      await updateLibraryEntry(entry.kind, entry.name, content)
      setEditing(null)
    })
  }

  if (editing) {
    return (
      <div className="space-y-3">
        <div>
          <h3 className="text-base font-medium">{editing.entry.name}</h3>
          <p className="text-sm text-muted-foreground">
            {editing.entry.kind === 'skill'
              ? '編輯 SKILL.md。frontmatter 的 name 與 description 兩個 CLI 都會讀。'
              : '編輯檔案內容。'}
          </p>
        </div>
        <textarea
          value={editing.content}
          onChange={(e) => setEditing({ ...editing, content: e.target.value })}
          rows={18}
          spellCheck={false}
          className={cn(fieldClass, 'resize-y font-mono text-sm leading-5')}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
            取消
          </Button>
          <Button size="sm" onClick={() => void handleSaveEditor()} disabled={busy !== null}>
            儲存
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        啟用的項目會在每次啟動任務時自動投遞：Claude 以 session-only plugin 載入，Codex 以
        VibeFlow 組出的 CODEX_HOME 載入。本機與專案自己的 skill 仍會照常載入，這裡的項目是額外加上去的。
      </p>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {KINDS.map(({ id, label, hint }) => {
        const kindEntries = entries.filter((e) => e.kind === id)
        const Icon = KIND_ICON[id]
        return (
          <section key={id} className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <span className={cn(SECTION_LABEL, 'flex items-center gap-2')}>
                <Icon className="size-3.5" />
                {label}
                <span className="tabular-nums text-muted-foreground/70">
                  {kindEntries.length}
                </span>
              </span>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleImport(id)}
                  disabled={busy !== null}
                >
                  {busy === `import:${id}` ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <FolderInput className="size-3.5" />
                  )}
                  Import
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setDraft({
                      kind: id,
                      name: '',
                      content: templateFor(id, ''),
                      description: '',
                    })
                  }
                  disabled={busy !== null}
                >
                  <Plus className="size-3.5" />
                  新建
                </Button>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">{hint}</p>

            {draft?.kind === id && (
              <div className="space-y-2 rounded-md border border-border/60 p-3">
                <input
                  autoFocus
                  value={draft.name}
                  onChange={(e) => {
                    const name = e.target.value
                    // Keep the template in sync with the name until the user
                    // edits the body themselves.
                    setDraft({
                      ...draft,
                      name,
                      content:
                        draft.content === templateFor(id, draft.name)
                          ? templateFor(id, name)
                          : draft.content,
                    })
                  }}
                  placeholder={id === 'skill' ? 'skill 名稱（目錄名）' : '檔名，如 house-rules.md'}
                  className={cn(fieldClass, 'font-mono text-sm')}
                />
                {id !== 'skill' && (
                  <input
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    placeholder="用途說明（scripts 會寫進 prompt 給 agent 判斷）"
                    className={cn(fieldClass, 'text-sm')}
                  />
                )}
                <textarea
                  value={draft.content}
                  onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                  rows={8}
                  spellCheck={false}
                  placeholder={id === 'skill' ? '' : '內容'}
                  className={cn(fieldClass, 'resize-y font-mono text-sm leading-5')}
                />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
                    取消
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => void handleCreate()}
                    disabled={busy !== null || draft.name.trim().length === 0}
                  >
                    建立
                  </Button>
                </div>
              </div>
            )}

            {loading ? (
              <p className="text-sm text-muted-foreground">讀取中…</p>
            ) : kindEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">尚無項目。</p>
            ) : (
              <div className="grid gap-2">
                {kindEntries.map((entry) => (
                  <div
                    key={entry.key}
                    className="flex items-start gap-3 rounded-md border border-border/60 px-3 py-2.5"
                  >
                    <input
                      type="checkbox"
                      checked={entry.enabled}
                      onChange={(e) =>
                        void run(`toggle:${entry.key}`, () =>
                          setLibraryEntryEnabled(entry.kind, entry.name, e.target.checked)
                        )
                      }
                      aria-label={`啟用 ${entry.name}`}
                      className="mt-1 size-4 shrink-0 rounded-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-sm">{entry.name}</p>
                      {entry.description && (
                        <p
                          className="line-clamp-2 text-sm text-muted-foreground"
                          title={entry.description}
                        >
                          {entry.description}
                        </p>
                      )}
                      {entry.sourcePath && (
                        <p className="truncate text-xs text-muted-foreground/70">
                          來源：{entry.sourcePath}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleOpenEditor(entry)}
                        disabled={busy !== null}
                      >
                        編輯
                      </Button>
                      {entry.sourcePath && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleReimport(entry)}
                          disabled={busy !== null}
                          title="從來源重新複製一份快照"
                        >
                          {busy === `reimport:${entry.key}` ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="size-3.5" />
                          )}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          void run(`delete:${entry.key}`, () =>
                            deleteLibraryEntry(entry.kind, entry.name)
                          )
                        }
                        disabled={busy !== null}
                        title="從 library 刪除"
                      >
                        <Trash2 className="size-3.5 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
