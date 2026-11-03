import type { Activity } from './progress'

/**
 * Text a program types into an agent's terminal on someone else's behalf (a
 * card's message, a host note). It arrives as one pasted user message, so it
 * must never answer a dialog, split into several messages, or land in the
 * middle of what a person is typing.
 */

const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'
const PASTE_GAP_MS = 200
const DEFAULT_QUIET_MS = 3000
const DEFAULT_TIMEOUT_MS = 120_000

export interface MailboxOptions {
  write(key: string, data: string): void
  /** The agent's latest reading in that session; null = unknown. */
  activity(key: string): Activity | null
  /** How long a person must have stopped typing first. Default: VIBEFLOW_QUIET_MS, else 3 s. */
  quietMs?: number
  /** Give up waiting for quiet after this long. */
  timeoutMs?: number
}

export interface DeliverOptions {
  /** Type even into a permission dialog (the text may answer it). */
  force?: boolean
}

export interface Mailbox {
  /** A person's keys: written now, or held while a delivery is mid-way. */
  userInput(key: string, data: string): void
  deliver(key: string, text: string, opts?: DeliverOptions): Promise<{ queuedMs: number }>
  /** The session is gone: drop what was kept for it. */
  forget(key: string): void
}

function coded(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

export function isBlocked(activity: Activity | null): boolean {
  return activity?.state === 'waiting' && activity.waitingFor === 'permission'
}

/** One paste: a program that sees the end marker inside it would end the paste early. */
export function bracketedPaste(text: string): string {
  return PASTE_START + text.split(PASTE_END).join('') + PASTE_END
}

/**
 * Wrap a message so the receiving agent can tell who sent it. `from` null =
 * VibeFlow itself. A sender cannot forge the tag from inside its text.
 */
export function frameMessage(from: { id: string; title: string } | null, text: string): string {
  const sender = from ? `${from.id} ${from.title}`.replace(/["\r\n]/g, ' ') : 'vibeflow'
  const body = text.replace(/<(\/?)vibeflow/gi, '‹$1vibeflow')
  return `<vibeflow from="${sender}">\n${body}\n</vibeflow>`
}

function quietFromEnv(): number {
  const n = Number(process.env.VIBEFLOW_QUIET_MS)
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_QUIET_MS
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function createMailbox(options: MailboxOptions): Mailbox {
  const lastInput = new Map<string, number>()
  const held = new Map<string, string[]>()
  const turns = new Map<string, Promise<unknown>>()

  async function waitForQuiet(key: string, started: number): Promise<void> {
    const quiet = options.quietMs ?? quietFromEnv()
    const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    for (;;) {
      const left = (lastInput.get(key) ?? 0) + quiet - Date.now()
      if (left <= 0) return
      if (Date.now() - started > timeout) throw coded('TIMEOUT', 'the terminal never went quiet')
      await sleep(Math.min(left, 250))
    }
  }

  async function type(key: string, text: string, opts: DeliverOptions, started: number) {
    await waitForQuiet(key, started)
    if (!opts.force && isBlocked(options.activity(key))) {
      throw coded('TARGET_BLOCKED', 'the agent is on a permission dialog; typing could answer it')
    }
    held.set(key, [])
    try {
      options.write(key, bracketedPaste(text))
      await sleep(PASTE_GAP_MS)
      options.write(key, '\r')
    } finally {
      const keys = held.get(key) ?? []
      held.delete(key)
      if (keys.length) {
        options.write(key, keys.join(''))
        lastInput.set(key, Date.now())
      }
    }
    return { queuedMs: Date.now() - started }
  }

  return {
    userInput(key, data) {
      const buffer = held.get(key)
      if (buffer) {
        buffer.push(data)
        return
      }
      lastInput.set(key, Date.now())
      options.write(key, data)
    },

    deliver(key, text, opts = {}) {
      const started = Date.now()
      const run = (turns.get(key) ?? Promise.resolve()).catch(() => {}).then(() => type(key, text, opts, started))
      turns.set(key, run)
      void run.finally(() => {
        if (turns.get(key) === run) turns.delete(key)
      }).catch(() => {})
      return run
    },

    forget(key) {
      lastInput.delete(key)
      held.delete(key)
    },
  }
}
