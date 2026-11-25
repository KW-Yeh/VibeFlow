import os from 'os'
import type { AgentCliId } from './agents'
import { runAgentPrint } from './agent-print'

const PROBE_TIMEOUT_MS = 90_000
const LIMIT_TEXT = /hit your .*limit|usage limit|rate[ _-]?limit|quota/i

/**
 * The smallest request that tells whether a provider accepts work again: one
 * short headless prompt on the cheapest model, outside any project, leaving
 * no session behind. A refusal, a crash or a limit message all mean "not yet".
 */
export async function probeAgent(agent: AgentCliId): Promise<boolean> {
  const args = agent === 'claude'
    ? ['-p', '--model', 'haiku', '--no-session-persistence']
    : ['exec', '--skip-git-repo-check', '--ephemeral', '-']
  try {
    const out = await runAgentPrint(agent, args, 'Reply with the single word OK.', {
      cwd: os.tmpdir(),
      timeout: PROBE_TIMEOUT_MS,
      maxBuffer: 64 * 1024,
    })
    return !LIMIT_TEXT.test(out)
  } catch {
    return false
  }
}
