import { execFile } from 'child_process'
import os from 'os'
import * as nodePty from 'node-pty'
import { promisify } from 'util'
import { buildEnv, execEnv } from './env'

const pexec = promisify(execFile)
const SLASH_MODEL_TIMEOUT_MS = 7000

/** Agent CLIs VibeFlow knows how to launch inside a task's PTY. */
export type AgentCliId = 'claude' | 'codex' | 'gemini' | 'copilot'

export interface AgentModel {
  /** Value passed to the CLI's --model flag. */
  id: string
  /** Human-readable label shown in the UI. */
  label: string
}

export interface AgentCli {
  id: AgentCliId
  /** Executable name looked up on PATH. */
  bin: string
  /** Human-readable name shown in the UI. */
  name: string
  /** Selectable models; the first entry is the lightweight default. */
  models: AgentModel[]
}

/**
 * Registry of supported agents. The renderer owns the matching per-agent
 * launch-command builders (renderer/lib/claude.ts) — keep both in sync when
 * adding an agent.
 */
export const AGENT_CLIS: AgentCli[] = [
  {
    id: 'claude',
    bin: 'claude',
    name: 'Claude Code',
    models: [
      { id: 'sonnet', label: 'Sonnet（平衡・預設）' },
      { id: 'haiku', label: 'Haiku（輕量）' },
      { id: 'opus', label: 'Opus（最強）' },
    ],
  },
  {
    id: 'codex',
    bin: 'codex',
    name: 'Codex CLI',
    models: [
      { id: 'gpt-5.5', label: 'GPT-5.5（預設）' },
      { id: 'gpt-5.4', label: 'GPT-5.4' },
      { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
    ],
  },
  {
    id: 'gemini',
    bin: 'gemini',
    name: 'Gemini CLI',
    models: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash（輕量・預設）' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    ],
  },
  {
    id: 'copilot',
    bin: 'copilot',
    name: 'GitHub Copilot CLI',
    // Codex-series models per the task spec; lightest first. Values must match
    // the copilot CLI's `--model` choices exactly or the launch is rejected.
    models: [
      { id: 'gpt-5.1-codex-mini', label: 'GPT-5.1 Codex Mini（輕量・預設）' },
      { id: 'gpt-5.1-codex', label: 'GPT-5.1 Codex' },
      { id: 'gpt-5-mini', label: 'GPT-5 Mini' },
    ],
  },
]

/** Lightweight default model id for an agent (first entry in its model list). */
export function defaultModelFor(id: AgentCliId): string {
  const agent = AGENT_CLIS.find((a) => a.id === id) ?? AGENT_CLIS[0]
  return agent.models[0].id
}

async function which(bin: string): Promise<boolean> {
  try {
    await pexec('which', [bin], {
      env: execEnv(),
    })
    return true
  } catch {
    return false
  }
}

function modelLabel(id: string): string {
  const known = AGENT_CLIS.flatMap((agent) => agent.models)
    .find((model) => model.id === id)
  if (known) return known.label
  return id
}

function isLikelyTextModel(id: string): boolean {
  if (/embedding|audio|tts|whisper|dall-e|image|moderation|realtime|transcribe/i.test(id)) {
    return false
  }
  return /^(gpt|o\d|o-|codex)/i.test(id)
}

function sortCodexModels(ids: string[]): string[] {
  const preferred = ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini']
  const unique = Array.from(new Set(ids))
  return [
    ...preferred.filter((id) => unique.includes(id)),
    ...unique.filter((id) => !preferred.includes(id)).sort(),
  ]
}

function uniqueInOrder(ids: string[]): string[] {
  return Array.from(new Set(ids))
}

function stripAnsi(input: string): string {
  return input
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
}

function normalizeModelId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9.-]/g, '')
}

export function parseCodexModelChoices(output: string): AgentModel[] {
  const text = stripAnsi(output)
  const ids = Array.from(
    text.matchAll(/\b(?:gpt[-\s]?\d+(?:\.\d+)?(?:[-\s](?:codex|mini))?|gpt[-\s]?\d+(?:\.\d+)?[-\s][a-z0-9.-]+|o\d(?:[-\w.]+)?|o-[\w.-]+|codex[-\w.]*)\b/gi),
    (match) => normalizeModelId(match[0])
  ).filter(isLikelyTextModel)

  return sortCodexModels(ids).map((id) => ({ id, label: modelLabel(id) }))
}

function isLikelyClaudeModel(id: string): boolean {
  if (id === 'claude' || id === 'claude-code') return false
  return /^(claude-|sonnet|haiku|opus)/i.test(id)
}

export function parseClaudeModelChoices(output: string): AgentModel[] {
  const text = stripAnsi(output)
  const ids = Array.from(
    text.matchAll(/\b(?:claude(?:[-\s][a-z0-9.]+){1,5}|sonnet(?:[-\s]?\d+(?:\.\d+)?)?|haiku(?:[-\s]?\d+(?:\.\d+)?)?|opus(?:[-\s]?\d+(?:\.\d+)?)?)\b/gi),
    (match) => normalizeModelId(match[0])
  ).filter(isLikelyClaudeModel)

  return uniqueInOrder(ids).map((id) => ({ id, label: modelLabel(id) }))
}

function parseSlashModelChoices(agent: AgentCli, output: string): AgentModel[] {
  if (agent.id === 'claude') return parseClaudeModelChoices(output)
  if (agent.id === 'codex') return parseCodexModelChoices(output)
  return []
}

async function slashModelChoices(agent: AgentCli): Promise<AgentModel[]> {
  if (agent.id !== 'claude' && agent.id !== 'codex') return []

  return new Promise((resolve) => {
    let output = ''
    let settled = false
    const env = { ...buildEnv(), TERM: 'xterm-256color' }
    let proc: nodePty.IPty | null = null

    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      try {
        proc?.kill()
      } catch {
        // already exited
      }
      resolve(parseSlashModelChoices(agent, output))
    }

    const timeout = setTimeout(finish, SLASH_MODEL_TIMEOUT_MS)

    try {
      proc = nodePty.spawn(agent.bin, [], {
        name: 'xterm-256color',
        cwd: os.homedir(),
        env,
        cols: 100,
        rows: 30,
      })
    } catch {
      finish()
      return
    }

    proc.onData((data) => {
      output += data
    })
    proc.onExit(finish)

    setTimeout(() => {
      try {
        proc?.write('/model\r')
      } catch {
        finish()
      }
    }, 900)
  })
}

function parseModelChoices(output: string): AgentModel[] {
  // The choices must belong to the --model option itself: don't let the gap
  // cross into a later option line (2-space-indented flag), or we'd grab e.g.
  // --output-format's "text"/"json"/"stream-json" instead.
  const match = output.match(/--model\s+<model>((?:(?!\n {2}\S)[\s\S])*?)\(choices:\s*([^)]+)\)/i)
  if (!match) return []
  return Array.from(match[2].matchAll(/"([^"]+)"/g), (m) => m[1])
    .map((id) => ({ id, label: modelLabel(id) }))
}

async function helpModels(agent: AgentCli): Promise<AgentModel[]> {
  try {
    const { stdout, stderr } = await pexec(agent.bin, ['--help'], {
      env: execEnv(),
      timeout: 4000,
      maxBuffer: 1024 * 1024,
    })
    return parseModelChoices(`${stdout}\n${stderr}`)
  } catch {
    return []
  }
}

async function cliModels(agent: AgentCli): Promise<AgentModel[]> {
  if (agent.id === 'claude' || agent.id === 'codex') {
    const models = await slashModelChoices(agent)
    if (models.length > 0) return models
  }

  return helpModels(agent)
}

/**
 * Detect which known agent CLIs are available on PATH. Uses the same
 * PATH-augmented env as spawned PTYs (buildEnv), so what we report as
 * available matches what the task terminal can actually run.
 */
export async function detectAgents(): Promise<AgentCli[]> {
  const available = await Promise.all(
    AGENT_CLIS.map((agent) => which(agent.bin))
  )
  const installed = AGENT_CLIS.filter((_, i) => available[i])
  const detectedModels = await Promise.all(installed.map((agent) => cliModels(agent)))
  return installed.map((agent, i) => ({
    ...agent,
    models: detectedModels[i].length > 0 ? detectedModels[i] : agent.models,
  }))
}
