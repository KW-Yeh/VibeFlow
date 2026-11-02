import { useEffect, useState, type ReactNode } from 'react'
import { Loader2, X } from 'lucide-react'

import { DialogShell } from '@/components/ui/dialog-shell'
import { fieldClass } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { SECTION_LABEL } from '@/components/ui/section-label'
import { AutoModeSwitch } from '@/components/task-auto-mode-toggle'
import { TaskEffortSelect } from '@/components/task-effort-slider'
import { listAgentModels } from '@/lib/api'
import { taskModel } from '@/lib/claude'
import { clampEffort, modelFor, selectableEfforts } from '@/lib/effort'
import { cn } from '@/lib/utils'
import type {
  AgentCli,
  AgentCliId,
  AgentEffort,
  AgentModel,
  ManualEffort,
} from '@/lib/types'

/** Input / select class for a property row: the shared field, sidebar-sized. */
export const ROW_FIELD = cn(fieldClass, 'h-8 px-2 py-1 text-sm')

/**
 * The create and edit dialogs share one frame: content on the left, a property
 * sidebar on the right. It has to work at about half a screen tall, so only the
 * content column grows with the viewport and the sidebar's action buttons stay
 * in view while its rows scroll.
 */
export function TaskFormDialog({
  title,
  header,
  saving,
  onClose,
  content,
  sidebar,
  actions,
}: {
  /** Accessible dialog name. */
  title: string
  /** Shown above the content column: the dialog's label and role control. */
  header: ReactNode
  saving: boolean
  onClose: () => void
  content: ReactNode
  sidebar: ReactNode
  actions: ReactNode
}) {
  return (
    <DialogShell
      title={title}
      saving={saving}
      onClose={onClose}
      contentClassName="max-w-[880px] overflow-hidden"
    >
      <IconButton
        aria-label={`關閉${title}`}
        onClick={onClose}
        disabled={saving}
        className="absolute right-3 top-3 z-10 p-1"
      >
        <X className="size-4" />
      </IconButton>
      <div className="flex max-h-[90vh] flex-col overflow-y-auto md:h-[min(90vh,720px)] md:flex-row md:overflow-hidden">
        <div className="flex min-h-[360px] min-w-0 flex-1 flex-col gap-3 p-5 pr-12 md:min-h-0 md:pr-5">
          <div className="flex flex-wrap items-center gap-3">{header}</div>
          {content}
        </div>
        <aside className="flex w-full shrink-0 flex-col border-t border-border/70 bg-muted/20 md:w-[300px] md:border-l md:border-t-0">
          <div className="flex min-h-0 flex-1 flex-col gap-4 px-3 pb-3 pt-4 md:overflow-y-auto md:pt-12">
            {sidebar}
          </div>
          <div className="flex shrink-0 gap-2 border-t border-border/70 px-3 py-3">{actions}</div>
        </aside>
      </div>
    </DialogShell>
  )
}

export function PropertyGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="space-y-1.5">
      <h3 className={cn(SECTION_LABEL, 'px-1')}>{label}</h3>
      {children}
    </section>
  )
}

/** A label beside one control. The control must be the row's only focusable element. */
export function PropertyRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid grid-cols-[76px_minmax(0,1fr)] items-center gap-2 px-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="min-w-0">{children}</span>
    </label>
  )
}

/** A muted note under a group's rows. */
export function PropertyNote({ children, tone }: { children: ReactNode; tone?: 'warning' | 'danger' }) {
  return (
    <div
      className={cn(
        'px-1 text-sm leading-5',
        tone === 'warning' ? 'text-warning' : tone === 'danger' ? 'text-destructive' : 'text-muted-foreground'
      )}
    >
      {children}
    </div>
  )
}

/** The agent's models from core's catalog; `null` while the list loads. */
export function useAgentModels(agentCli: AgentCliId): AgentModel[] | null {
  // Tagged with the agent it belongs to: right after a switch, the previous
  // agent's list must read as "still loading", not as this agent's models.
  const [loaded, setLoaded] = useState<{ agentCli: AgentCliId; models: AgentModel[] } | null>(null)
  useEffect(() => {
    let cancelled = false
    void listAgentModels(agentCli)
      .then((list) => {
        if (!cancelled) setLoaded({ agentCli, models: list?.models ?? [] })
      })
      .catch(() => {
        if (!cancelled) setLoaded({ agentCli, models: [] })
      })
    return () => {
      cancelled = true
    }
  }, [agentCli])
  return loaded?.agentCli === agentCli ? loaded.models : null
}

/**
 * Effort levels the model that will actually run accepts (the agent's default
 * when none is picked). A choice it does not accept is lowered as soon as the
 * model changes, so the picker always shows what the launch will send.
 */
export function useModelEfforts(
  models: AgentModel[] | null,
  agentCli: AgentCliId,
  model: string,
  effort: AgentEffort,
  setEffort: (effort: AgentEffort) => void
): readonly ManualEffort[] {
  const info = modelFor(models, taskModel({ agentCli, model }))
  const levels = selectableEfforts(info)
  useEffect(() => {
    if (models === null) return
    const fitted = clampEffort(effort, levels)
    if (effort !== 'auto' && fitted && fitted !== effort) setEffort(fitted)
  }, [models, levels, effort, setEffort])
  return levels
}

const CUSTOM_MODEL = '__custom__'

/** The 執行 group: who runs the card and how. */
export function RunSettingsGroup({
  agents,
  detectTimedOut,
  onRetry,
  agentCli,
  onAgentChange,
  model,
  onModelChange,
  models,
  effort,
  onEffortChange,
  effortLevels,
  autoMode,
  onAutoModeChange,
  disabled,
}: {
  agents: AgentCli[] | null
  detectTimedOut: boolean
  onRetry: () => void
  agentCli: AgentCliId
  onAgentChange: (agentCli: AgentCliId) => void
  model: string
  onModelChange: (model: string) => void
  /** From useAgentModels; `null` while the list loads. */
  models: AgentModel[] | null
  effort: AgentEffort
  onEffortChange: (effort: AgentEffort) => void
  effortLevels: readonly ManualEffort[]
  autoMode: boolean
  onAutoModeChange: (autoMode: boolean) => void
  disabled: boolean
}) {
  const [customOpen, setCustomOpen] = useState(false)
  useEffect(() => {
    setCustomOpen(false)
  }, [agentCli])
  const listed = models ?? []
  const description = customOpen ? undefined : modelFor(listed, model || undefined)?.description
  const modelOptions = model && !customOpen && !listed.some((m) => m.id === model)
    ? [{ id: model, label: model }, ...listed]
    : listed

  return (
    <PropertyGroup label="執行">
      {agents === null ? (
        <PropertyNote tone={detectTimedOut ? 'danger' : undefined}>
          {detectTimedOut ? (
            <>
              偵測逾時，請確認 Agent CLI 已安裝。
              <button
                type="button"
                onClick={onRetry}
                className="ml-1 rounded-sm text-primary underline outline-none hover:no-underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                重新偵測
              </button>
            </>
          ) : (
            <span className="flex items-center gap-1.5">
              <Loader2 className="size-3 animate-spin" />
              偵測 Agent CLI…
            </span>
          )}
        </PropertyNote>
      ) : agents.length === 0 ? (
        <PropertyNote tone="danger">未偵測到 Agent CLI（claude / codex）。</PropertyNote>
      ) : (
        <PropertyRow label="Agent">
          <select
            name="agent-agent-cli"
            value={agentCli}
            disabled={disabled}
            onChange={(e) => onAgentChange(e.target.value as AgentCliId)}
            className={ROW_FIELD}
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </PropertyRow>
      )}
      <PropertyRow label="Model">
        <select
          name="agent-model"
          value={customOpen ? CUSTOM_MODEL : model}
          disabled={disabled}
          title={description}
          onChange={(e) => {
            if (e.target.value === CUSTOM_MODEL) {
              setCustomOpen(true)
              return
            }
            setCustomOpen(false)
            onModelChange(e.target.value)
          }}
          className={ROW_FIELD}
        >
          <option value="">使用 CLI 預設模型</option>
          {modelOptions.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
          <option value={CUSTOM_MODEL}>自訂…</option>
        </select>
      </PropertyRow>
      {customOpen && (
        <PropertyRow label="Model id">
          <input
            name="agent-custom-model"
            value={model}
            onChange={(e) => onModelChange(e.target.value.trim())}
            placeholder="例如 claude-opus-5-5"
            autoFocus
            className={ROW_FIELD}
          />
        </PropertyRow>
      )}
      {models === null && (
        <PropertyNote>
          <span className="flex items-center gap-1.5">
            <Loader2 className="size-3 animate-spin" />
            讀取 model list…
          </span>
        </PropertyNote>
      )}
      <PropertyRow label="推理強度">
        <TaskEffortSelect
          value={effort}
          onChange={onEffortChange}
          levels={effortLevels}
          disabled={disabled}
          className="h-8 px-2 py-1 text-sm"
        />
      </PropertyRow>
      <div className="grid grid-cols-[76px_minmax(0,1fr)] items-center gap-2 px-1">
        <span className="text-sm text-muted-foreground">Auto Mode</span>
        <span className="flex items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">
            {autoMode ? '不逐次確認' : '每步等你允許'}
          </span>
          <AutoModeSwitch value={autoMode} onChange={onAutoModeChange} disabled={disabled} />
        </span>
      </div>
    </PropertyGroup>
  )
}
