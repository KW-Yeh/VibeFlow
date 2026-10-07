import { execFile } from 'child_process'
import { promisify } from 'util'
import type { AgentEffort } from './effort'
import { execEnv } from './env'

export { AGENT_EFFORTS, type AgentEffort } from './effort'

const pexec = promisify(execFile)

/** Agent CLIs VibeFlow knows how to launch inside a task's PTY. */
export type AgentCliId = 'claude' | 'codex'

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
  /** One-line summary from the agent CLI's catalog. */
  description?: string
  /**
   * Effort levels the CLI says this model accepts. Absent = unknown (the
   * list came from a source without effort data); `[]` = takes no effort.
   */
  efforts?: AgentEffort[]
  /** The model the CLI runs when the card picks none. */
  isDefault?: boolean
}

export interface AgentCli {
  id: AgentCliId
  /** Executable name looked up on PATH. */
  bin: string
  /** Human-readable name shown in the UI. */
  name: string
  /** Offered when the CLI's own catalog is unavailable. */
  models: AgentModel[]
}

/**
 * Registry of supported agents. launch.ts owns the matching per-agent
 * launch-command builders (launch.ts) — keep both in sync when
 * adding an agent.
 */
export const AGENT_CLIS: AgentCli[] = [
  {
    id: 'claude',
    bin: 'claude',
    name: 'Claude Code',
    models: [
      { id: 'sonnet', label: 'Sonnet（平衡）' },
      { id: 'haiku', label: 'Haiku（輕量）' },
      { id: 'opus', label: 'Opus（最強）' },
    ],
  },
  {
    id: 'codex',
    bin: 'codex',
    name: 'Codex CLI',
    models: [
      { id: 'gpt-5.5', label: 'GPT-5.5' },
      { id: 'gpt-5.4', label: 'GPT-5.4' },
      { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
    ],
  },
]

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
