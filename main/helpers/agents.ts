import { execFile } from 'child_process'
import { promisify } from 'util'
import { buildEnv } from './env'

const pexec = promisify(execFile)

/** Agent CLIs VibeFlow knows how to launch inside a task's PTY. */
export type AgentCliId = 'claude' | 'codex' | 'gemini'

export interface AgentCli {
  id: AgentCliId
  /** Executable name looked up on PATH. */
  bin: string
  /** Human-readable name shown in the UI. */
  name: string
}

/**
 * Registry of supported agents. The renderer owns the matching per-agent
 * launch-command builders (renderer/lib/claude.ts) — keep both in sync when
 * adding an agent.
 */
export const AGENT_CLIS: AgentCli[] = [
  { id: 'claude', bin: 'claude', name: 'Claude Code' },
  { id: 'codex', bin: 'codex', name: 'Codex CLI' },
  { id: 'gemini', bin: 'gemini', name: 'Gemini CLI' },
]

async function which(bin: string): Promise<boolean> {
  try {
    await pexec('which', [bin], {
      env: { ...process.env, PATH: buildEnv().PATH },
    })
    return true
  } catch {
    return false
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
  return AGENT_CLIS.filter((_, i) => available[i])
}
