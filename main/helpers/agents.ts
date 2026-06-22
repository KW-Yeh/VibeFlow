import { execFile } from 'child_process'
import { promisify } from 'util'
import { execEnv } from './env'

const pexec = promisify(execFile)

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
      { id: 'gpt-5-codex', label: 'GPT-5 Codex（預設）' },
      { id: 'gpt-5', label: 'GPT-5' },
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

function parseModelChoices(output: string): AgentModel[] {
  const match = output.match(/--model\s+<model>[\s\S]*?\(choices:\s*([^)]+)\)/i)
  if (!match) return []
  return Array.from(match[1].matchAll(/"([^"]+)"/g), (m) => m[1])
    .map((id) => ({ id, label: modelLabel(id) }))
}

async function cliModels(agent: AgentCli): Promise<AgentModel[]> {
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
