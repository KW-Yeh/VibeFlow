import { useEffect, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clipboard,
  ExternalLink,
  Loader2,
  Library,
  LogOut,
  RefreshCw,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { DialogShell } from '@/components/ui/dialog-shell'
import { LibraryPanel } from '@/components/library-panel'
import { JiraAuthTerminal } from '@/components/jira-auth-terminal'
import { TaskAutoModeToggle } from '@/components/task-auto-mode-toggle'
import { NotificationSettingsSection, desktopPermission } from '@/components/notification-settings'
import { fieldClass } from '@/components/ui/field'
import {
  cancelGithubAuthLogin,
  cancelJiraAuthLogin,
  detectAgents,
  getGithubAuthStatus,
  getJiraAuthStatus,
  listAgentModels,
  logoutGithubAuth,
  logoutJiraAuth,
  onGithubAuthEvent,
  onJiraAuthEvent,
  openExternal,
  startGithubAuthLogin,
  startJiraAuthLogin,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import type {
  NotificationSettings,
  AgentCliId,
  AgentModelList,
  AgentModelSource,
  GitHubCliAuthStatus,
  JiraAuthStatus,
} from '@/lib/types'

const MODEL_AGENTS: { id: AgentCliId; name: string }[] = [
  { id: 'claude', name: 'Claude Code' },
  { id: 'codex', name: 'Codex CLI' },
]

const MODEL_SOURCE_LABELS: Record<AgentModelSource, string> = {
  builtin: '內建清單',
  'claude-cli': 'Claude Code CLI',
  'codex-app-server': 'Codex CLI',
  'codex-cache': 'Codex 本機快取',
}

type GithubAuthPhase = 'idle' | 'starting' | 'waiting' | 'success' | 'error'

interface SettingsDialogProps {
  open: boolean
  /** Current custom system prompt ('' = no user prompt). */
  systemPrompt: string
  /** Current global workstation path ('' = the ~/Desktop default is in effect). */
  workstationPath: string
  /** Board-wide Auto Mode: the value new cards start with. */
  autoMode: boolean
  /** Stage notification preferences (defaults already applied). */
  notifications: NotificationSettings
  jiraStoryPointsFields: string[]
  saving: boolean
  error: string | null
  /** Called with the new custom prompt ('' = default), workstation path ('' = default), Auto Mode and notifications. */
  onSave: (
    systemPrompt: string,
    workstationPath: string,
    autoMode: boolean,
    notifications: NotificationSettings,
    jiraStoryPointsFields: string[]
  ) => void
  /** Native folder picker — returns the chosen absolute path, or null. */
  onPickFolder: () => Promise<string | null>
  onClose: () => void
}

export function SettingsDialog({
  open,
  systemPrompt,
  workstationPath,
  autoMode,
  notifications,
  jiraStoryPointsFields,
  saving,
  error,
  onSave,
  onPickFolder,
  onClose,
}: SettingsDialogProps) {
  const [text, setText] = useState('')
  const [workstation, setWorkstation] = useState('')
  const [auto, setAuto] = useState(true)
  const [notif, setNotif] = useState<NotificationSettings>(notifications)
  const [pointFieldsText, setPointFieldsText] = useState('')
  const [desktopBlocked, setDesktopBlocked] = useState(false)
  const [modelLists, setModelLists] = useState<Partial<Record<AgentCliId, AgentModelList | null>>>({})
  const [refreshing, setRefreshing] = useState<AgentCliId | null>(null)
  /** CLIs found on PATH; undefined while detecting, null when detection failed. */
  const [installed, setInstalled] = useState<AgentCliId[] | null | undefined>(undefined)
  const [githubPage, setGithubPage] = useState(false)
  const [jiraPage, setJiraPage] = useState(false)
  const [jiraStatus, setJiraStatus] = useState<JiraAuthStatus | null>(null)
  const [jiraPhase, setJiraPhase] = useState<'idle' | 'waiting' | 'error'>('idle')
  const [jiraUrl, setJiraUrl] = useState('')
  const [jiraOutput, setJiraOutput] = useState('')
  const [jiraError, setJiraError] = useState<string | null>(null)
  const [jiraBusy, setJiraBusy] = useState(false)
  const [githubStatus, setGithubStatus] = useState<GitHubCliAuthStatus | null>(null)
  const [githubPhase, setGithubPhase] = useState<GithubAuthPhase>('idle')
  const [githubCode, setGithubCode] = useState('')
  const [githubUrl, setGithubUrl] = useState('https://github.com/login/device')
  const [githubError, setGithubError] = useState<string | null>(null)
  const [githubBusy, setGithubBusy] = useState(false)
  const [copiedCode, setCopiedCode] = useState(false)

  useEffect(() => {
    if (open) {
      setText(systemPrompt)
      setWorkstation(workstationPath)
      setAuto(autoMode)
      setNotif(notifications)
      setPointFieldsText(jiraStoryPointsFields.join(', '))
      setDesktopBlocked(desktopPermission() === 'denied' || desktopPermission() === 'unsupported')
      setGithubPage(false)
      setJiraPage(false)
      setJiraPhase('idle')
      setJiraError(null)
      setJiraUrl('')
      setJiraOutput('')
      void getJiraAuthStatus().then(setJiraStatus)
      setGithubPhase('idle')
      setGithubCode('')
      setGithubError(null)
      setCopiedCode(false)
      void getGithubAuthStatus().then(setGithubStatus)
    }
  }, [open, systemPrompt, workstationPath, autoMode, notifications, jiraStoryPointsFields])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setModelLists({})
    setInstalled(undefined)
    void detectAgents()
      .then((found) => found.map((a) => a.id))
      .catch(() => null)
      .then((ids) => {
        if (!cancelled) setInstalled(ids)
      })
    for (const agent of MODEL_AGENTS) {
      void listAgentModels(agent.id)
        .catch(() => null)
        .then((list) => {
          if (!cancelled) setModelLists((prev) => ({ ...prev, [agent.id]: list }))
        })
    }
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    return onJiraAuthEvent((event) => {
      if (event.type === 'starting') { setJiraPhase('waiting'); setJiraBusy(true); setJiraError(null) }
      if (event.type === 'output') setJiraOutput((output) => (output + event.data).slice(-32000))
      if (event.type === 'url') setJiraUrl(event.url)
      if (event.type === 'success') { setJiraStatus(event.status); setJiraPhase('idle'); setJiraBusy(false) }
      if (event.type === 'signed-out') { setJiraStatus(event.status); setJiraPhase('idle'); setJiraBusy(false) }
      if (event.type === 'cancelled') { setJiraPhase('idle'); setJiraBusy(false) }
      if (event.type === 'error') { setJiraPhase('error'); setJiraBusy(false); setJiraError(event.error) }
    })
  }, [open])

  const refreshModels = async (agentId: AgentCliId) => {
    setRefreshing(agentId)
    try {
      const list = await listAgentModels(agentId, true).catch(() => null)
      setModelLists((prev) => ({ ...prev, [agentId]: list }))
    } finally {
      setRefreshing(null)
    }
  }

  useEffect(() => {
    if (!open) return
    return onGithubAuthEvent((event) => {
      if (event.type === 'starting') {
        setGithubPhase('starting')
        setGithubError(null)
        return
      }
      if (event.type === 'code') {
        setGithubPhase('waiting')
        setGithubCode(event.code)
        setGithubUrl(event.url)
        setCopiedCode(false)
        setGithubBusy(false)
        return
      }
      if (event.type === 'success') {
        setGithubStatus(event.status)
        setGithubPhase('success')
        setGithubBusy(false)
        return
      }
      if (event.type === 'cancelled') {
        setGithubPhase('idle')
        setGithubBusy(false)
        return
      }
      setGithubPhase('error')
      setGithubError(event.error)
      setGithubBusy(false)
    })
  }, [open])

  const [libraryPage, setLibraryPage] = useState(false)
  const [libraryEditing, setLibraryEditing] = useState(false)
  const trimmed = text.trim()
  const isUnset = trimmed === ''
  const pointFields = pointFieldsText.split(',').map((value) => value.trim()).filter(Boolean)
  const validPointFields = pointFields.every((field) => /^customfield_\d+$/.test(field))
  const canSubmit = !saving && !githubPage && !jiraPage && validPointFields

  const handleSubmit = () => {
    if (!canSubmit) return
    onSave(trimmed, workstation.trim(), auto, notif, pointFields)
  }

  const handlePickWorkstation = async () => {
    const picked = await onPickFolder()
    if (picked) setWorkstation(picked)
  }

  const openGithubLoginPage = async () => {
    setGithubPage(true)
    setGithubPhase('starting')
    setGithubCode('')
    setGithubError(null)
    setCopiedCode(false)
    setGithubBusy(true)
    try {
      await startGithubAuthLogin()
    } catch (err) {
      setGithubPhase('error')
      setGithubError(err instanceof Error ? err.message : String(err))
      setGithubBusy(false)
    }
  }

  const closeGithubPage = async () => {
    if (githubPhase === 'starting' || githubPhase === 'waiting') {
      await cancelGithubAuthLogin()
    }
    setGithubPage(false)
    setGithubPhase('idle')
    setGithubBusy(false)
    setGithubCode('')
    setGithubError(null)
    setCopiedCode(false)
    const status = await getGithubAuthStatus()
    setGithubStatus(status)
  }

  const handleGithubLogout = async () => {
    setGithubBusy(true)
    setGithubError(null)
    try {
      const status = await logoutGithubAuth()
      setGithubStatus(status)
    } catch (err) {
      setGithubError(err instanceof Error ? err.message : String(err))
    } finally {
      setGithubBusy(false)
    }
  }

  const handleClose = () => {
    if (jiraBusy) void cancelJiraAuthLogin()
    if (githubPage && (githubPhase === 'starting' || githubPhase === 'waiting')) {
      void cancelGithubAuthLogin()
    }
    onClose()
  }

  const startJira = async () => {
    setJiraPhase('waiting')
    setJiraBusy(true)
    setJiraError(null)
    setJiraUrl('')
    setJiraOutput('')
    try { await startJiraAuthLogin() }
    catch (err) { setJiraBusy(false); setJiraPhase('error'); setJiraError(err instanceof Error ? err.message : String(err)) }
  }

  const closeJiraPage = async () => {
    if (jiraBusy) await cancelJiraAuthLogin()
    setJiraPage(false)
    setJiraBusy(false)
    setJiraPhase('idle')
    setJiraStatus(await getJiraAuthStatus())
  }

  const copyGithubCode = async () => {
    if (!githubCode) return
    await navigator.clipboard.writeText(githubCode)
    setCopiedCode(true)
    window.setTimeout(() => setCopiedCode(false), 1500)
  }

  return (
    <AnimatePresence>
      {open && (
        <DialogShell
          key="settings-dialog"
      title={
        jiraPage ? 'Atlassian（Jira）' : githubPage
          ? '登入 GitHub CLI'
          : libraryPage
          ? 'Library'
          : '設定'
      }
      description={
        jiraPage ? '登入 Atlassian 以讀取指派給你的 Jira ticket。' : githubPage
          ? '使用 GitHub CLI 的網頁授權流程登入 github.com。'
          : libraryPage
          ? 'VibeFlow 自有的 skill / prompt / script，啟動任務時投遞給 Claude 與 Codex。'
          : '調整 system prompt 與 agent 帳號連線。'
      }
      saving={saving || githubBusy}
      onClose={handleClose}
      showHeader
      contentClassName="max-w-2xl"
      footer={
        jiraPage ? <>
          <Button variant="ghost" size="sm" onClick={() => void closeJiraPage()}>返回設定</Button>
          <Button size="sm" disabled={saving || jiraBusy || !validPointFields} onClick={() => onSave(trimmed, workstation.trim(), auto, notif, pointFields)}>儲存設定</Button>
        </> : githubPage ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void closeGithubPage()}
              disabled={githubBusy && githubPhase !== 'success'}
            >
              {githubPhase === 'success' ? '完成' : '返回'}
            </Button>
            {githubPhase === 'error' && (
              <Button size="sm" onClick={() => void openGithubLoginPage()}>
                重新登入
              </Button>
            )}
          </>
                ) : libraryPage ? (
          libraryEditing ? null : (
            <Button variant="ghost" size="sm" onClick={() => setLibraryPage(false)}>
              <ArrowLeft className="size-3.5" />
              返回設定
            </Button>
          )
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={handleClose} disabled={saving}>
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
      {jiraPage ? <div className="space-y-5">
        <button type="button" onClick={() => void closeJiraPage()}
          className="inline-flex items-center gap-1.5 rounded-sm text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50">
          <ArrowLeft className="size-4" />返回設定
        </button>
        <div className="space-y-1 text-sm">
          <p className="font-medium">{jiraStatus?.installed === false ? '找不到 Atlassian CLI（acli）。' : jiraStatus?.authenticated ? '已登入 Atlassian' : '尚未登入 Atlassian。'}</p>
          {jiraStatus?.authenticated && <p className="text-muted-foreground">{jiraStatus.email ?? '帳號'} · {jiraStatus.site}</p>}
          {jiraPhase === 'waiting' && <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" />請在瀏覽器完成授權；若帳號有多個 site，再於下方終端選擇。</p>}
          {jiraError && <p role="alert" className="text-destructive">{jiraError}</p>}
        </div>
        {(jiraBusy || jiraOutput) && <JiraAuthTerminal output={jiraOutput} active={jiraBusy} />}
        {jiraStatus?.installed === false ? <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void openExternal('https://developer.atlassian.com/cloud/acli/guides/install-acli/')}><ExternalLink />安裝說明</Button>
          <Button size="sm" onClick={() => void getJiraAuthStatus().then(setJiraStatus)}><RefreshCw />重新檢查</Button>
        </div> : <div className="flex flex-wrap gap-2">
          {jiraBusy ? <Button variant="outline" size="sm" onClick={() => void cancelJiraAuthLogin()}>取消</Button>
            : <Button size="sm" onClick={() => void startJira()}>{jiraStatus?.authenticated ? '重新登入' : '使用瀏覽器登入'}</Button>}
          {jiraStatus?.authenticated && <Button variant="outline" size="sm" disabled={jiraBusy} onClick={async () => {
            try { setJiraStatus(await logoutJiraAuth()) } catch (err) { setJiraError(err instanceof Error ? err.message : String(err)) }
          }}><LogOut />登出</Button>}
          {jiraUrl && <Button variant="ghost" size="sm" onClick={() => void openExternal(jiraUrl)}><ExternalLink />手動開啟登入頁</Button>}
        </div>}
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium">Story Points 欄位 ID</span>
          <input value={pointFieldsText} onChange={(event) => setPointFieldsText(event.target.value)}
            placeholder="customfield_10033, customfield_10016" className={cn(fieldClass, 'font-mono text-sm')} />
          {!validPointFields && <span className="text-destructive">請使用 customfield_12345 格式，以逗號分隔。</span>}
        </label>
      </div> : githubPage ? (
        <div className="space-y-5">
          <button
            type="button"
            onClick={() => void closeGithubPage()}
            disabled={githubBusy && githubPhase !== 'success'}
            className="inline-flex items-center gap-1.5 rounded-sm text-base text-muted-foreground outline-none transition-colors motion-reduce:transition-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
          >
            <ArrowLeft className="size-4" />
            返回設定
          </button>

          <div className="rounded-md border border-border/60 p-3">
            <div className="flex items-start gap-3">
              {githubPhase === 'success' ? (
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
              ) : githubPhase === 'error' ? (
                <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
              ) : (
                <Loader2 className="mt-0.5 size-5 shrink-0 animate-spin text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-base font-medium">
                  {githubPhase === 'success'
                    ? 'GitHub CLI 已完成授權'
                    : githubPhase === 'error'
                    ? 'GitHub CLI 授權失敗'
                    : githubPhase === 'waiting'
                    ? '等待 GitHub 授權完成'
                    : '正在啟動 GitHub CLI 登入'}
                </p>
                <p className="text-sm leading-5 text-muted-foreground">
                  {githubPhase === 'success'
                    ? `目前登入帳號：${githubStatus?.login ?? 'GitHub'}`
                    : githubPhase === 'error'
                    ? githubError
                    : githubPhase === 'waiting'
                    ? '請複製授權碼並開啟 GitHub 授權頁，完成後 VibeFlow 會自動更新狀態。'
                    : 'VibeFlow 正在背景準備 gh auth login。'}
                </p>
              </div>
            </div>
          </div>

          {(githubPhase === 'waiting' || githubCode) && (
            <div className="space-y-4">
              <label className="block space-y-1.5">
                <span className="text-base font-medium">授權碼</span>
                <div className="flex rounded-md border bg-background focus-within:ring-[3px] focus-within:ring-ring/50">
                  <input
                    readOnly
                    value={githubCode}
                    className="min-w-0 flex-1 bg-transparent px-3 py-2 font-mono text-base tracking-wider outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => void copyGithubCode()}
                    className="flex h-9 items-center gap-1.5 rounded-r-md px-3 text-base text-muted-foreground outline-none transition-colors motion-reduce:transition-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset disabled:opacity-50"
                    disabled={!githubCode}
                  >
                    <Clipboard className="size-4" />
                    {copiedCode ? '已複製' : '複製'}
                  </button>
                </div>
              </label>

              <label className="block space-y-1.5">
                <span className="text-base font-medium">登入網址</span>
                <div className="flex rounded-md border bg-background focus-within:ring-[3px] focus-within:ring-ring/50">
                  <input
                    readOnly
                    value={githubUrl}
                    className="min-w-0 flex-1 bg-transparent px-3 py-2 text-base outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => void openExternal(githubUrl)}
                    className="flex h-9 items-center gap-1.5 rounded-r-md px-3 text-base text-muted-foreground outline-none transition-colors motion-reduce:transition-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
                  >
                    <ExternalLink className="size-4" />
                    開啟
                  </button>
                </div>
              </label>
            </div>
          )}
        </div>
            ) : libraryPage ? (
        <LibraryPanel onEditingChange={setLibraryEditing} />
      ) : (
        <div className="space-y-6">
          <section className="space-y-2">
            <TaskAutoModeToggle value={auto} onChange={setAuto} />
            <p className="text-sm text-muted-foreground">
              新卡片的預設值；每張卡片可在建立或編輯時各自調整。
            </p>
          </section>

          <section className="space-y-2">
            <NotificationSettingsSection
              value={notif}
              onChange={setNotif}
              desktopBlocked={desktopBlocked}
              onRequestDesktop={async () => {
                if (desktopPermission() === 'unsupported') {
                  setDesktopBlocked(true)
                  return false
                }
                const granted = (await Notification.requestPermission()) === 'granted'
                setDesktopBlocked(!granted)
                return granted
              }}
            />
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-base font-medium">
                工作站資料夾
                <span
                  className={cn(
                    'ml-2 rounded-xs px-1.5 py-0.5 text-xs font-medium',
                    workstation.trim() === ''
                      ? 'bg-secondary text-secondary-foreground'
                      : 'bg-primary/15 text-primary'
                  )}
                >
                  {workstation.trim() === '' ? '預設（~/Desktop）' : '已自訂'}
                </span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                name="workstation-path"
                autoComplete="off"
                spellCheck={false}
                value={workstation}
                placeholder="~/Desktop"
                onChange={(e) => setWorkstation(e.target.value)}
                className={cn(fieldClass, 'font-mono text-sm')}
              />
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => void handlePickWorkstation()}
              >
                選擇資料夾
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              每個任務的 worktree 與執行期檔案會建立在 {'<工作站>/<專案名>/'} 底下；留空則預設為 ~/Desktop。
            </p>
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-base font-medium">
                System Prompt
                <span
                  className={cn(
                    'ml-2 rounded-xs px-1.5 py-0.5 text-xs font-medium',
                    isUnset
                      ? 'bg-secondary text-secondary-foreground'
                      : 'bg-primary/15 text-primary'
                  )}
                >
                  {isUnset ? '未設定' : '已自訂'}
                </span>
              </span>
            </div>
            <textarea
              name="system-prompt"
              autoComplete="off"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={10}
              spellCheck={false}
              className={cn(fieldClass, 'resize-y font-mono text-sm leading-5')}
            />
            <p className="text-sm text-muted-foreground">
              啟動 Agent 時會以此 prompt 作為 system prompt；留空則只帶入任務專屬的 Artifact 設定。
            </p>
          </section>

          <section className="space-y-2">
            <div>
              <h3 className="text-base font-medium">Library</h3>
              <p className="text-sm text-muted-foreground">
                VibeFlow 自有的 skill / prompt / script。啟用的項目會在啟動任務時自動投遞給
                Claude 與 Codex，不必依賴本機的 ~/.claude 或 ~/.codex 佈局。
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setLibraryPage(true)}>
              <Library className="size-3.5" />
              管理 Library
            </Button>
          </section>

          <section className="space-y-3">
            <div>
              <h3 className="text-base font-medium">CLI 與帳號設定</h3>
              <p className="text-sm text-muted-foreground">
                Model 清單直接取自已登入的 Agent CLI，不需要 API key；設定 GitHub CLI 以支援本機 GitHub 操作。
              </p>
            </div>
            <div className="grid gap-2">
              {MODEL_AGENTS.map((agent) => {
                const list = modelLists[agent.id]
                // A failed detection (null) falls back to showing the model list as before.
                const missing = Array.isArray(installed) && !installed.includes(agent.id)
                const loading =
                  installed === undefined ||
                  (!missing && (list === undefined || list?.pending === true || refreshing === agent.id))
                return (
                  <div
                    key={agent.id}
                    className="flex items-center gap-3 rounded-md border border-border/60 px-3 py-2.5"
                  >
                    {loading ? (
                      <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                    ) : missing ? (
                      <AlertTriangle className="size-4 shrink-0 text-muted-foreground" />
                    ) : list?.error || !list ? (
                      <AlertTriangle className="size-4 shrink-0 text-destructive" />
                    ) : (
                      <CheckCircle2 className="size-4 shrink-0 text-success" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-medium">{agent.name}</p>
                      <p className="truncate text-sm text-muted-foreground">
                        {installed === undefined
                          ? '偵測 CLI…'
                          : missing
                          ? `未安裝・PATH 中找不到 ${agent.id} 指令`
                          : list === undefined
                          ? '讀取 model 清單…'
                          : !list
                          ? '無法取得 model 清單'
                          : list.pending
                          ? `正在向 ${agent.name} 取得 model 清單…`
                          : `${list.models.length} 個 models 可用・來源：${MODEL_SOURCE_LABELS[list.source]}`}
                      </p>
                      {!missing && list?.loginRequired ? (
                        <p className="text-sm text-destructive">
                          尚未登入，請在終端機執行 <code>{agent.id} login</code> 後重新整理。
                        </p>
                      ) : !missing && list?.error && (
                        <p className="truncate text-sm text-destructive" title={list.error}>
                          {list.error}
                        </p>
                      )}
                    </div>
                    {!missing && installed !== undefined && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        disabled={refreshing === agent.id}
                        aria-label={`向 ${agent.name} 重新取得 model 清單`}
                        title={`向 ${agent.name} 重新取得 model 清單`}
                        onClick={() => void refreshModels(agent.id)}
                      >
                        <RefreshCw className={cn('size-4', refreshing === agent.id && 'animate-spin')} />
                      </Button>
                    )}
                  </div>
                )
              })}
              <div className="flex items-center gap-3 rounded-md border border-border/60 px-3 py-2.5">
                {githubStatus?.authenticated ? (
                  <CheckCircle2 className="size-4 shrink-0 text-success" />
                ) : githubStatus?.error ? (
                  <AlertTriangle className="size-4 shrink-0 text-destructive" />
                ) : (
                  <span className="size-4 shrink-0 rounded-full border border-muted-foreground/50" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-base font-medium">GitHub CLI</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {githubStatus?.authenticated
                      ? `${githubStatus.login ?? 'GitHub'} 已授權（${githubStatus.gitProtocol ?? 'https'}）`
                      : githubStatus?.installed === false
                      ? '找不到 GitHub CLI（gh）'
                      : githubStatus?.error
                      ? githubStatus.error
                      : '尚未授權'}
                  </p>
                </div>
                {githubStatus?.authenticated && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2"
                    disabled={githubBusy}
                    onClick={() => void openGithubLoginPage()}
                  >
                    切換使用者
                  </Button>
                )}
                {githubStatus?.authenticated && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2"
                    disabled={githubBusy}
                    onClick={() => void handleGithubLogout()}
                  >
                    {githubBusy ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <LogOut className="size-4" />
                    )}
                    登出
                  </Button>
                )}
                {!githubStatus?.authenticated && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={githubStatus?.installed === false || githubBusy}
                    onClick={() => void openGithubLoginPage()}
                  >
                    {githubBusy ? '啟動中…' : '登入'}
                  </Button>
                )}
              </div>
              <button type="button" onClick={() => setJiraPage(true)}
                className="flex w-full items-center gap-3 rounded-md border border-border/60 px-3 py-2.5 text-left outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50">
                {jiraStatus?.authenticated ? <CheckCircle2 className="size-4 shrink-0 text-success" /> : <span className="size-4 shrink-0 rounded-full border border-muted-foreground/50" />}
                <span className="min-w-0 flex-1"><span className="block text-base font-medium">Atlassian（Jira）</span>
                  <span className="block truncate text-sm text-muted-foreground">{jiraStatus?.authenticated ? `${jiraStatus.email ?? '帳號'} · ${jiraStatus.site}` : jiraStatus?.installed === false ? '找不到 Atlassian CLI（acli）' : '尚未登入'}</span>
                </span>
              </button>
            </div>
            {githubError && !githubPage && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-base">
                {githubError}
              </p>
            )}
          </section>

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-base">
              {error}
            </p>
          )}
        </div>
      )}
        </DialogShell>
      )}
    </AnimatePresence>
  )
}
