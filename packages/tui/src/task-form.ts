import { spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import React, { useEffect, useRef, useState } from 'react'
import { Box, Text, render, useApp, useInput } from 'ink'
import type { VibeFlowApi } from '../../core/src/client'
import type { AgentCli, AgentCliId, AgentEffort } from '../../core/src/agents'
import type { GitInfo } from '../../core/src/git'
import type { RecentProjectEntry } from '../../core/src/recent-projects'
import type { AgentConnections, Task, VibeFlowState } from '../../core/src/store'
import { fileToAttachmentInput } from '../../core/src/attachments'

const h = React.createElement

/** Mirrors the Web UI's effort slider (renderer/components/task-effort-slider.tsx). */
export const EFFORTS: { value: AgentEffort; label: string; description: string }[] = [
  { value: 'low', label: '快速', description: '適合範圍明確、低風險的小任務。' },
  { value: 'medium', label: '標準', description: '兼顧速度與推理深度，適合一般開發任務。' },
  { value: 'high', label: '深入', description: '適合跨檔案、除錯或需要較多判斷的任務。' },
  { value: 'xhigh', label: '極致', description: '適合高複雜度、長鏈推理或高風險變更。' },
]
const DEFAULT_EFFORT: AgentEffort = 'medium'

export type FieldId =
  | 'title'
  | 'project'
  | 'gitInit'
  | 'baseBranch'
  | 'branch'
  | 'attachments'
  | 'description'
  | 'effort'
  | 'autoMode'
  | 'agent'
  | 'model'
  | 'submit'

export interface FormState {
  mode: 'new' | 'edit'
  taskId?: string
  /** Edit only: the card has run, so its project and base branch are locked. */
  launched: boolean
  title: string
  description: string
  projectPath: string | null
  /** The card's project when the edit form opened; null for a new card. */
  originalProjectPath: string | null
  gitInfo: GitInfo | null
  /** The folder `gitInfo` describes; a lookup runs only when the project moves away from it. */
  gitInfoPath: string | null
  baseBranch: string
  branch: string
  /** Local file paths; read when the card is created. */
  attachments: string[]
  effort: AgentEffort
  autoMode: boolean
  agentCli: AgentCliId
  model: string
}

export interface FormContext {
  recent: RecentProjectEntry[]
  /** null while detection timed out. */
  agents: AgentCli[] | null
  connections: AgentConnections
  workstationPath: string
}

export function newFormState(defaultAutoMode: boolean, agents: AgentCli[] | null): FormState {
  const agentCli = agents && agents.length > 0 && !agents.some((a) => a.id === 'claude') ? agents[0].id : 'claude'
  return {
    mode: 'new',
    launched: false,
    title: '',
    description: '',
    projectPath: null,
    originalProjectPath: null,
    gitInfo: null,
    gitInfoPath: null,
    baseBranch: '',
    branch: '',
    attachments: [],
    effort: DEFAULT_EFFORT,
    autoMode: defaultAutoMode,
    agentCli,
    model: '',
  }
}

export function editFormState(task: Task, defaultAutoMode: boolean): FormState {
  return {
    mode: 'edit',
    taskId: task.id,
    launched: Boolean(task.launchedAt),
    title: task.title,
    description: task.description ?? '',
    projectPath: task.projectPath ?? null,
    originalProjectPath: task.projectPath ?? null,
    gitInfo: null,
    gitInfoPath: null,
    baseBranch: task.baseBranch ?? '',
    branch: task.branch,
    attachments: [],
    effort: task.effort ?? DEFAULT_EFFORT,
    autoMode: task.autoMode ?? defaultAutoMode,
    agentCli: task.agentCli ?? 'claude',
    model: task.model ?? '',
  }
}

export function isProjectMissing(recent: RecentProjectEntry[], projectPath: string | null): boolean {
  return Boolean(projectPath && recent.some((p) => p.path === projectPath && p.missing))
}

function projectChanged(s: FormState): boolean {
  return s.mode === 'edit' && s.projectPath !== s.originalProjectPath
}

/** The fields the Web UI shows for this state, in display order. */
export function visibleFields(s: FormState, ctx: FormContext): FieldId[] {
  const missing = isProjectMissing(ctx.recent, s.projectPath)
  const isRepo = s.gitInfo?.isRepo ?? false
  const hasRemote = s.gitInfo?.hasRemote ?? false
  if (s.mode === 'new') {
    const fields: FieldId[] = ['title', 'project']
    if (s.gitInfo && !missing && !isRepo) fields.push('gitInit')
    if (isRepo && hasRemote) fields.push('baseBranch')
    if (isRepo) fields.push('branch')
    fields.push('attachments', 'description', 'effort', 'autoMode', 'agent', 'model', 'submit')
    return fields
  }
  const fields: FieldId[] = ['title', 'description', 'effort', 'autoMode', 'project']
  if (projectChanged(s) && isRepo && hasRemote) fields.push('baseBranch')
  fields.push('agent', 'model', 'submit')
  return fields
}

/** Model choices: '' (agent default), the connected agent's list, and the current model if it is not listed. */
export function modelOptions(ctx: FormContext, agentCli: AgentCliId, current: string): string[] {
  const listed = ctx.connections[agentCli]?.models ?? []
  const options = ['', ...listed]
  if (current && !listed.includes(current)) options.push(current)
  return options
}

/** Why the form cannot be submitted yet, or null when it can. */
export function blockReason(s: FormState, ctx: FormContext, loadingGit: boolean): string | null {
  if (!s.title.trim()) return '請輸入任務標題'
  if (loadingGit) return '偵測 Git 狀態中…'
  const missing = isProjectMissing(ctx.recent, s.projectPath)
  if (s.mode === 'new') {
    if (!s.projectPath) return '請先選擇專案資料夾'
    if (missing) return '找不到專案資料夾，請重新選取'
    if (!s.gitInfo?.isRepo) return '這個資料夾不是 Git repository'
    return null
  }
  if (projectChanged(s)) {
    if (missing) return '找不到專案資料夾，請重新選取'
    if (s.gitInfo && !s.gitInfo.isRepo) return '這個資料夾不是 Git repository，請改選一個 Git 專案。'
  }
  return null
}

export function createPayload(s: FormState) {
  const hasRemote = s.gitInfo?.hasRemote ?? false
  return {
    title: s.title.trim(),
    description: s.description.trim(),
    projectPath: s.projectPath as string,
    baseBranch: hasRemote ? s.baseBranch || null : null,
    branch: s.branch.trim() || undefined,
    agentCli: s.agentCli,
    model: s.model || undefined,
    effort: s.effort,
    autoMode: s.autoMode,
    attachments: s.attachments.map(fileToAttachmentInput),
  }
}

export function updatePayload(s: FormState) {
  return {
    taskId: s.taskId as string,
    title: s.title.trim(),
    description: s.description.trim(),
    agentCli: s.agentCli,
    model: s.model || undefined,
    effort: s.effort,
    autoMode: s.autoMode,
    ...(!s.launched && s.projectPath ? { projectPath: s.projectPath, baseBranch: s.baseBranch || null } : {}),
  }
}

/** `$VISUAL`, then `$EDITOR`, then the platform's always-present editor. */
export function editorCommand(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  return env.VISUAL?.trim() || env.EDITOR?.trim() || (platform === 'win32' ? 'notepad' : 'vi')
}

/**
 * Edit `text` in the user's editor. The command may carry arguments
 * (`code --wait`), so it runs through the shell. An editor that fails
 * leaves the text as it was.
 */
export function editInEditor(text: string): { text: string } | { error: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibeflow-'))
  const file = path.join(dir, 'description.md')
  try {
    fs.writeFileSync(file, text)
    const cmd = editorCommand(process.env, process.platform)
    const r = spawnSync(`${cmd} "${file}"`, { stdio: 'inherit', shell: true })
    if (r.error) return { error: `無法啟動編輯器（${cmd}）：${r.error.message}` }
    if (r.status !== 0) return { error: `編輯器（${cmd}）結束碼 ${r.status}，描述未變更` }
    return { text: fs.readFileSync(file, 'utf8').replace(/\r?\n$/, '') }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

export type FormResult =
  | { type: 'cancel' }
  | { type: 'editor'; state: FormState; focus: number }
  | { type: 'created'; task: Task; state: VibeFlowState }
  | { type: 'updated'; state: VibeFlowState }

interface FormViewProps {
  api: VibeFlowApi
  ctx: FormContext
  initial: FormState
  initialFocus: number
  initialMessage?: string
  /** The state the form opened with, for the leave-without-saving check. */
  pristine: FormState
  onResult: (result: FormResult) => void
}

const LABELS: Record<FieldId, string> = {
  title: '任務標題',
  project: '專案資料夾',
  gitInit: '初始化 Git',
  baseBranch: '基準分支',
  branch: '分支名稱（選填）',
  attachments: '附件（選填）',
  description: '詳細描述（選填）',
  effort: '任務複雜度',
  autoMode: 'Auto Mode',
  agent: 'Agent CLI',
  model: 'Model',
  submit: '',
}

const TEXT_FIELDS: FieldId[] = ['title', 'branch', 'project', 'attachments']

function cycle<T>(list: T[], current: T, step: number): T {
  if (list.length === 0) return current
  const i = list.indexOf(current)
  return list[(((i < 0 ? 0 : i + step) % list.length) + list.length) % list.length]
}

function sameForm(a: FormState, b: FormState): boolean {
  const pick = (s: FormState) => [s.title, s.description, s.projectPath, s.baseBranch, s.branch, s.attachments.join('\n'), s.effort, s.autoMode, s.agentCli, s.model]
  return JSON.stringify(pick(a)) === JSON.stringify(pick(b))
}

function FormView({ api, ctx, initial, initialFocus, initialMessage, pristine, onResult }: FormViewProps) {
  const { exit } = useApp()
  const [s, setS] = useState<FormState>(initial)
  const [focus, setFocus] = useState(initialFocus)
  const [editing, setEditing] = useState<FieldId | null>(null)
  const [draft, setDraft] = useState('')
  const [message, setMessage] = useState(initialMessage ?? '')
  const [busy, setBusy] = useState<string | null>(null)
  const [loadingGit, setLoadingGit] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const lookup = useRef(0)

  const fields = visibleFields(s, ctx)
  const field = fields[Math.min(focus, fields.length - 1)]
  const projectLocked = s.mode === 'edit' && s.launched
  const missing = isProjectMissing(ctx.recent, s.projectPath)

  // Git state follows the chosen project, as in the Web UI. An unchanged
  // project in the edit form needs no lookup: its base branch is fixed.
  useEffect(() => {
    if (!s.projectPath || missing || s.gitInfoPath === s.projectPath || (s.mode === 'edit' && !projectChanged(s))) return
    const target = s.projectPath
    const id = ++lookup.current
    setLoadingGit(true)
    void api
      .getGitInfo(target)
      .then((info) => {
        if (id !== lookup.current) return
        setS((prev) => ({ ...prev, gitInfo: info, gitInfoPath: target, baseBranch: info.defaultBase ?? '' }))
      })
      .catch((err) => id === lookup.current && setMessage(`偵測 Git 失敗：${(err as Error).message}`))
      .finally(() => id === lookup.current && setLoadingGit(false))
  }, [s.projectPath])

  const leave = (result: FormResult) => {
    onResult(result)
    exit()
  }

  const setProject = (projectPath: string | null) => {
    if (projectLocked) return
    setS((prev) => ({ ...prev, projectPath, gitInfo: null, gitInfoPath: null, baseBranch: '' }))
  }

  const submit = async () => {
    const reason = blockReason(s, ctx, loadingGit)
    if (reason) return setMessage(reason)
    setBusy(s.mode === 'new' ? '建立 Worktree 中…' : '儲存中…')
    try {
      if (s.mode === 'new') {
        const payload = createPayload(s)
        const { task, state } = await api.createTask(payload)
        leave({ type: 'created', task, state })
      } else {
        const state = await api.updateTask(updatePayload(s))
        leave({ type: 'updated', state })
      }
    } catch (err) {
      setMessage((err as Error).message)
      setBusy(null)
    }
  }

  const commitDraft = () => {
    const value = draft.trim()
    if (editing === 'title') setS((prev) => ({ ...prev, title: draft }))
    else if (editing === 'branch') setS((prev) => ({ ...prev, branch: value }))
    else if (editing === 'project') {
      if (value) setProject(path.resolve(value.replace(/^~(?=$|\/)/, os.homedir())))
    } else if (editing === 'attachments' && value) {
      const file = path.resolve(value.replace(/^~(?=$|\/)/, os.homedir()))
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        setMessage(`找不到檔案：${file}`)
        return
      }
      setS((prev) => ({ ...prev, attachments: [...prev.attachments, file] }))
    }
    setEditing(null)
  }

  useInput((input, key) => {
    if (busy) return
    if (confirmLeave) {
      setConfirmLeave(false)
      if (input === 'y' || input === 'Y') leave({ type: 'cancel' })
      return
    }
    if (editing) {
      if (key.escape) return setEditing(null)
      if (key.return) return commitDraft()
      if (key.backspace || key.delete) return setDraft((d) => Array.from(d).slice(0, -1).join(''))
      if (key.ctrl && input === 'u') return setDraft('')
      if (!key.ctrl && !key.meta && input && !input.includes('\x1b')) setDraft((d) => d + input.replace(/[\r\n]/g, ''))
      return
    }
    setMessage('')
    if (key.escape) {
      if (sameForm(s, pristine)) return leave({ type: 'cancel' })
      return setConfirmLeave(true)
    }
    if (key.ctrl && input === 's') return void submit()
    if (key.upArrow || (key.tab && key.shift)) return setFocus((f) => Math.max(0, Math.min(f, fields.length - 1) - 1))
    if (key.downArrow || key.tab) return setFocus((f) => Math.min(fields.length - 1, f + 1))
    const step = key.leftArrow ? -1 : key.rightArrow ? 1 : 0
    if (step) {
      if (field === 'project' && !projectLocked) {
        const paths = ctx.recent.map((p) => p.path)
        if (paths.length) setProject(cycle(paths, s.projectPath ?? paths[paths.length - 1], step))
      } else if (field === 'baseBranch') {
        setS((prev) => ({ ...prev, baseBranch: cycle(prev.gitInfo?.branches ?? [], prev.baseBranch, step) }))
      } else if (field === 'effort') {
        setS((prev) => ({ ...prev, effort: cycle(EFFORTS.map((e) => e.value), prev.effort, step) }))
      } else if (field === 'autoMode') {
        setS((prev) => ({ ...prev, autoMode: !prev.autoMode }))
      } else if (field === 'agent' && ctx.agents?.length) {
        setS((prev) => ({ ...prev, agentCli: cycle(ctx.agents!.map((a) => a.id), prev.agentCli, step), model: '' }))
      } else if (field === 'model') {
        setS((prev) => ({ ...prev, model: cycle(modelOptions(ctx, prev.agentCli, prev.model), prev.model, step) }))
      }
      return
    }
    if (field === 'autoMode' && input === ' ') return setS((prev) => ({ ...prev, autoMode: !prev.autoMode }))
    if (field === 'attachments' && input === 'x') return setS((prev) => ({ ...prev, attachments: prev.attachments.slice(0, -1) }))
    if (!key.return) return
    if (field === 'submit') return void submit()
    if (field === 'description') return leave({ type: 'editor', state: s, focus })
    if (field === 'gitInit' && s.projectPath) {
      setBusy('初始化 Git…')
      void api
        .initRepository(s.projectPath)
        .then((info) => setS((prev) => ({ ...prev, gitInfo: info, gitInfoPath: prev.projectPath, baseBranch: info.defaultBase ?? '' })))
        .catch((err) => setMessage((err as Error).message))
        .finally(() => setBusy(null))
      return
    }
    if (TEXT_FIELDS.includes(field) && !(field === 'project' && projectLocked)) {
      setEditing(field)
      setDraft(field === 'title' ? s.title : field === 'branch' ? s.branch : field === 'project' ? (s.projectPath ?? '') : '')
    }
  })

  const value = (f: FieldId): string => {
    if (editing === f) return `${draft}▏`
    switch (f) {
      case 'title':
        return s.title || '（例如：實作登入頁面）'
      case 'project': {
        if (projectLocked) return `${s.projectPath ? path.basename(s.projectPath) : '—'}（任務已開始，鎖定）`
        if (!s.projectPath) return ctx.recent.length ? '←/→ 選擇使用過的專案，或 Enter 輸入路徑' : 'Enter 輸入專案資料夾的絕對路徑'
        return `${s.projectPath}${missing ? '（路徑遺失）' : ''}`
      }
      case 'gitInit':
        return 'Enter：執行 git init 並建立一個空的初始 commit'
      case 'baseBranch':
        return `‹ ${s.baseBranch || '—'} ›`
      case 'branch':
        return s.branch || '（留空則自動命名，例如 feature/login-fix）'
      case 'attachments':
        return s.attachments.length ? s.attachments.map((a) => path.basename(a)).join('、') : '（Enter 輸入檔案路徑加入）'
      case 'description': {
        if (!s.description) return '（Enter 用編輯器撰寫）'
        const lines = s.description.split('\n')
        return lines.length > 1 ? `${lines[0]} …（共 ${lines.length} 行）` : lines[0]
      }
      case 'effort': {
        const e = EFFORTS.find((x) => x.value === s.effort)!
        return `‹ ${e.label} · ${e.value} ›`
      }
      case 'autoMode':
        return s.autoMode ? '‹ 開啟 ›' : '‹ 關閉 ›'
      case 'agent': {
        if (ctx.agents === null) return '偵測逾時，請確認 Agent CLI 已安裝'
        if (ctx.agents.length === 0) return '未偵測到 Agent CLI（claude / codex）'
        return `‹ ${ctx.agents.find((a) => a.id === s.agentCli)?.name ?? s.agentCli} ›`
      }
      case 'model':
        return modelOptions(ctx, s.agentCli, s.model).length > 1 ? `‹ ${s.model || '使用預設 model'} ›` : '尚未連線或無法取得 model list，將使用預設 model'
      case 'submit':
        return busy ?? (s.mode === 'new' ? '［ 建立任務 ］' : '［ 儲存變更 ］')
    }
  }

  const note = (): string | null => {
    const info = s.gitInfo
    if (field === 'project' && !projectLocked) {
      if (loadingGit) return '偵測 Git 狀態中…'
      if (missing) return `找不到 ${s.projectPath}，專案可能已被移動或刪除。`
      if (info && !info.isRepo) return '這個資料夾不是 Git repository。請改選一個 Git 專案，或在下方初始化。'
      if (s.mode === 'edit' && projectChanged(s)) return '更換專案會在新專案重建 worktree（此任務尚未開始，無變更會遺失）。'
      if (info?.isRepo && !info.hasRemote) return `此 repository 沒有 remote，將以目前分支 (${info.currentBranch ?? 'HEAD'}) 為基準建立本地 worktree。`
      if (info?.isRepo && s.projectPath) return `worktree 會建在 ${ctx.workstationPath || '~/Desktop'}/${path.basename(s.projectPath)}`
    }
    if (field === 'branch') return info?.hasRemote ? '填寫後會建立同名分支；若 remote 已有這個分支，則直接取回並接續上面的工作。' : '填寫後會建立同名分支。'
    if (field === 'effort') return `${EFFORTS.find((x) => x.value === s.effort)!.description} Claude Code 與 Codex 會在啟動此任務時套用；實際可用級距依 model 而定。`
    if (field === 'autoMode') return s.autoMode ? '開啟：Agent 會直接修改檔案、執行指令，不會逐次向你確認。' : '關閉：Agent 每次要動作前，都會在終端機裡等你允許。'
    if (field === 'submit') return blockReason(s, ctx, loadingGit)
    return null
  }

  const hint = editing
    ? 'Enter 確認 · Esc 放棄 · Backspace 刪除 · Ctrl+U 清空'
    : field === 'attachments'
      ? '↑/↓ 換欄位 · Enter 加入檔案 · x 移除最後一個 · Ctrl+S 送出 · Esc 取消'
      : field === 'description'
        ? '↑/↓ 換欄位 · Enter 開啟編輯器（$EDITOR） · Ctrl+S 送出 · Esc 取消'
        : '↑/↓ 換欄位 · ←/→ 切換選項 · Enter 編輯／執行 · Ctrl+S 送出 · Esc 取消'

  const extra = note()
  return h(
    Box,
    { flexDirection: 'column', borderStyle: 'round', borderColor: 'cyan', paddingX: 1 },
    h(Text, { bold: true, color: 'cyan' }, s.mode === 'new' ? '新增任務' : '編輯任務'),
    ...fields.map((f, i) =>
      h(
        Box,
        { key: f },
        h(Text, { color: i === focus ? 'cyan' : undefined }, i === focus ? '› ' : '  '),
        f === 'submit' ? null : h(Box, { width: 20 }, h(Text, { bold: i === focus }, LABELS[f])),
        h(
          Text,
          {
            // Paths and what is being typed keep their end in view: that is the part that tells them apart.
            wrap: editing === f || f === 'project' ? 'truncate-start' : 'truncate-end',
            inverse: i === focus && f === 'submit',
            dimColor: !editing && ((f === 'title' && !s.title) || (f === 'branch' && !s.branch) || (f === 'description' && !s.description)),
            color: editing === f ? 'yellow' : undefined,
          },
          value(f)
        )
      )
    ),
    extra ? h(Text, { dimColor: true }, `  ${extra}`) : null,
    confirmLeave
      ? h(Text, { color: 'yellow' }, '有未儲存的變更，確定要離開？（y/n）')
      : message
        ? h(Text, { color: 'yellow' }, message)
        : h(Text, { dimColor: true }, hint)
  )
}

export function showForm(
  api: VibeFlowApi,
  ctx: FormContext,
  initial: FormState,
  pristine: FormState,
  initialFocus = 0,
  initialMessage?: string
): Promise<FormResult> {
  return new Promise((resolve) => {
    let result: FormResult = { type: 'cancel' }
    const instance = render(
      h(FormView, { api, ctx, initial, initialFocus, initialMessage, pristine, onResult: (r) => (result = r) }),
      { exitOnCtrlC: false }
    )
    void instance.waitUntilExit().then(() => resolve(result))
  })
}

/** What the form needs from core before it opens. Agent detection gives up after 6 s, as in the Web UI. */
export async function loadFormContext(api: VibeFlowApi): Promise<{ ctx: FormContext; autoMode: boolean }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((r) => (timer = setTimeout(() => r(null), 6000)))
  const [state, recent, agents] = await Promise.all([
    api.getState(),
    api.listRecentProjects(),
    Promise.race([api.detectAgents(), timeout]).catch(() => null),
  ]).finally(() => clearTimeout(timer))
  return {
    ctx: {
      recent,
      agents,
      connections: state.settings.agentConnections ?? {},
      workstationPath: state.settings.workstationPath?.trim() ?? '',
    },
    autoMode: state.settings.autoMode,
  }
}
