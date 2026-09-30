import { execFile } from 'child_process'
import { promisify } from 'util'
import { execEnv } from './env'

const pexec = promisify(execFile)

/** Agent CLIs VibeFlow knows how to launch inside a task's PTY. */
export type AgentCliId = 'claude' | 'codex'

/**
 * Provider-neutral reasoning depth stored on a task. Claude Code and Codex
 * share these four levels; the launch builder translates them to each CLI's
 * session-scoped flag.
 */
export type AgentEffort = 'low' | 'medium' | 'high' | 'xhigh'

/** Every valid effort level, ordered shallow → deep. Backs input validation. */
export const AGENT_EFFORTS: readonly AgentEffort[] = ['low', 'medium', 'high', 'xhigh']

/**
 * Effort a task gets when the caller does not pick one. Applied at task
 * creation (helpers/tasks.ts) so the UI and the CLI produce identical cards.
 * The renderer cannot import main at runtime, so the slider's default is a
 * deliberate duplicate — test/agents.test.mjs asserts the two literals agree.
 */
export const DEFAULT_TASK_EFFORT: AgentEffort = 'medium'

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
]

/** Lightweight default model id for an agent (first entry in its model list). */
export function defaultModelFor(id: AgentCliId): string {
  const agent = AGENT_CLIS.find((a) => a.id === id) ?? AGENT_CLIS[0]
  return agent.models[0].id
}

async function commandExists(bin: string): Promise<boolean> {
  try {
    const command = process.platform === 'win32' ? 'where.exe' : 'which'
    await pexec(command, [bin], {
      env: execEnv(),
      timeout: 2500,
      windowsHide: true,
    })
    return true
  } catch {
    return false
  }
}

/**
 * Detect which known agent CLIs are available on PATH.
 *
 * Keep this intentionally lightweight: opening the new/edit task UI calls this
 * method, so it must not spawn interactive agent TUIs or issue `/model` probes.
 * Model options come from AGENT_CLIS and can be changed by the user's native
 * agent picker when a task terminal is launched.
 */
export async function detectAgents(): Promise<AgentCli[]> {
  const available = await Promise.all(
    AGENT_CLIS.map((agent) => commandExists(agent.bin))
  )
  return AGENT_CLIS.filter((_, i) => available[i])
}
