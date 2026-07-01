import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  RotateCcw,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { DialogShell } from '@/components/ui/dialog-shell'
import { DEFAULT_SYSTEM_PROMPT } from '@/lib/claude'
import { openExternal } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { AgentConnections, ConnectableAgentId } from '@/lib/types'

interface AgentInfo {
  id: ConnectableAgentId
  name: string
  platform: string
  keyUrl: string
}

const CONNECTABLE_AGENTS: AgentInfo[] = [
  {
    id: 'claude',
    name: 'Claude',
    platform: 'Anthropic Console',
    keyUrl: 'https://platform.claude.com/settings/workspaces/default/keys',
  },
  {
    id: 'codex',
    name: 'Codex',
    platform: 'OpenAI Platform',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
]

interface SettingsDialogProps {
  open: boolean
  /** Current custom system prompt ('' = the built-in default is in effect). */
  systemPrompt: string
  agentConnections?: AgentConnections
  saving: boolean
  error: string | null
  /** Called with the new custom prompt ('' = revert to the default). */
  onSave: (systemPrompt: string) => void
  onConnectAgent: (agentId: ConnectableAgentId, apiKey: string) => Promise<string | null>
  onRefreshModels?: (agentId: ConnectableAgentId) => Promise<void>
  onClose: () => void
}

export function SettingsDialog({
  open,
  systemPrompt,
  agentConnections,
  saving,
  error,
  onSave,
  onConnectAgent,
  onRefreshModels,
  onClose,
}: SettingsDialogProps) {
  const [text, setText] = useState('')
  const [agentPage, setAgentPage] = useState<AgentInfo | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [refreshing, setRefreshing] = useState<ConnectableAgentId | null>(null)

  useEffect(() => {
    if (open) {
      setText(systemPrompt.trim() ? systemPrompt : DEFAULT_SYSTEM_PROMPT)
      setAgentPage(null)
      setApiKey('')
      setShowKey(false)
      setConnectError(null)
      setConnecting(false)
    }
  }, [open, systemPrompt])

  const selectedConnection = agentPage ? agentConnections?.[agentPage.id] : undefined

  const connectedModelCount = useMemo(() => {
    return CONNECTABLE_AGENTS.reduce((sum, agent) => {
      const models = agentConnections?.[agent.id]?.models ?? []
      return sum + models.length
    }, 0)
  }, [agentConnections])

  if (!open) return null

  const trimmed = text.trim()
  const isDefault = trimmed === '' || trimmed === DEFAULT_SYSTEM_PROMPT.trim()
  const canSubmit = !saving && !agentPage

  const handleSubmit = () => {
    if (!canSubmit) return
    onSave(isDefault ? '' : trimmed)
  }

  const handleConnect = async () => {
    if (!agentPage || connecting) return
    setConnecting(true)
    setConnectError(null)
    const err = await onConnectAgent(agentPage.id, apiKey)
    if (!err) {
      setApiKey('')
      setAgentPage(null)
    } else {
      setConnectError(err)
    }
    setConnecting(false)
  }

  return (
    <DialogShell
      title={agentPage ? `連結 ${agentPage.name}` : '設定'}
      description={
        agentPage
          ? '綁定個人 API key 以取得可用 model list。'
          : '調整 system prompt 與 agent 帳號連線。'
      }
      saving={saving || connecting}
      onClose={onClose}
      showHeader
      contentClassName="max-w-2xl"
      footer={
        agentPage ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAgentPage(null)}
              disabled={connecting}
            >
              取消
            </Button>
            <Button
              size="sm"
              onClick={handleConnect}
              disabled={connecting || apiKey.trim().length === 0}
              className={cn(connecting && 'opacity-80')}
            >
              {connecting && <Loader2 className="animate-spin" />}
              {connecting ? '驗證中…' : '儲存 API key'}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
              取消
            </Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className={cn(saving && 'opacity-80')}
            >
              {saving && <Loader2 className="animate-spin" />}
              {saving ? '儲存中…' : '儲存設定'}
            </Button>
          </>
        )
      }
    >
      {agentPage ? (
        <div className="space-y-5">
          <button
            type="button"
            onClick={() => setAgentPage(null)}
            disabled={connecting}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <ArrowLeft className="size-4" />
            返回設定
          </button>

          <div className="space-y-3">
            <p className="text-sm leading-6 text-muted-foreground">
              為了使用 AI 功能，請綁定您的個人 API 金鑰。前往 {agentPage.platform}
              後台建立 API 金鑰並手動貼上。這是個本地執行的應用程式，因此不會將您所儲存的資訊上傳到任何地方。
            </p>
            <button
              type="button"
              onClick={() => void openExternal(agentPage.keyUrl)}
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              前往 {agentPage.platform}
              <ExternalLink className="size-3.5" />
            </button>
          </div>

          <label className="block space-y-1.5">
            <span className="text-sm font-medium">API key</span>
            <div className="flex rounded-md border bg-background focus-within:ring-[3px] focus-within:ring-ring/50">
              <input
                name={`${agentPage.id}-api-key`}
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                type={showKey ? 'text' : 'password'}
                placeholder={selectedConnection?.connected ? '輸入新的 API key 以更新連線' : '貼上 API key'}
                className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm outline-none"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="flex w-9 items-center justify-center text-muted-foreground hover:text-foreground"
                aria-label={showKey ? '隱藏 API key' : '顯示 API key'}
              >
                {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </label>

          {(connectError || selectedConnection?.error) && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm">
              {connectError ?? selectedConnection?.error}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                System Prompt
                <span
                  className={cn(
                    'ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium',
                    isDefault
                      ? 'bg-secondary text-secondary-foreground'
                      : 'bg-primary/15 text-primary'
                  )}
                >
                  {isDefault ? '預設' : '已自訂'}
                </span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={saving || trimmed === DEFAULT_SYSTEM_PROMPT.trim()}
                onClick={() => setText(DEFAULT_SYSTEM_PROMPT)}
              >
                <RotateCcw className="size-3" />
                重設為預設
              </Button>
            </div>
            <textarea
              name="system-prompt"
              autoComplete="off"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={10}
              spellCheck={false}
              className="w-full resize-y rounded-md border bg-background px-3 py-2 font-mono text-xs leading-5 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            <p className="text-xs text-muted-foreground">
              啟動 Agent 時會以此 prompt 作為 system prompt；進度追蹤協議會自動附加。
            </p>
          </section>

          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-medium">Agent 帳號連線</h3>
              <p className="text-xs text-muted-foreground">
                已連線的 agent 會在建立或編輯任務時顯示可選 model。未連線時使用預設 model。
              </p>
            </div>
            <div className="grid gap-2">
              {CONNECTABLE_AGENTS.map((agent) => {
                const connection = agentConnections?.[agent.id]
                const connected = connection?.connected && (connection.models?.length ?? 0) > 0
                return (
                  <div
                    key={agent.id}
                    className="flex items-center gap-3 rounded-md border border-border/60 px-3 py-2.5"
                  >
                    {connected ? (
                      <CheckCircle2 className="size-4 shrink-0 text-emerald-400" />
                    ) : connection?.error ? (
                      <AlertTriangle className="size-4 shrink-0 text-destructive" />
                    ) : (
                      <span className="size-4 shrink-0 rounded-full border border-muted-foreground/50" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{agent.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {connected
                          ? `${connection?.models?.length ?? 0} 個 models 可用`
                          : connection?.error ?? '尚未連線'}
                      </p>
                    </div>
                    {connected && onRefreshModels && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        disabled={refreshing === agent.id}
                        aria-label="重新整理 model 列表"
                        onClick={async () => {
                          setRefreshing(agent.id)
                          await onRefreshModels(agent.id)
                          setRefreshing(null)
                        }}
                      >
                        <RefreshCw className={cn('size-4', refreshing === agent.id && 'animate-spin')} />
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setAgentPage(agent)
                        setApiKey('')
                        setShowKey(false)
                        setConnectError(null)
                      }}
                    >
                      {connected ? '更新' : 'Connect'}
                    </Button>
                  </div>
                )
              })}
            </div>
            {connectedModelCount > 0 && (
              <p className="text-xs text-muted-foreground">
                目前共有 {connectedModelCount} 個已同步 model 可供 task 選擇。
              </p>
            )}
          </section>

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm">
              {error}
            </p>
          )}
        </div>
      )}
    </DialogShell>
  )
}
