import type { Activity } from './progress'
import { pendingMessages, postMessage, takeMessages } from './inbox'

/**
 * Text a program hands an agent on someone else's behalf (a card's message, a
 * host note). It must never answer a dialog, split into several messages, or
 * be sent along with what a person has typed but not sent. Where the agent
 * reads an inbox through its hooks, the message waits there and is typed only
 * to wake an idle agent whose input box is empty; elsewhere it is typed once
 * the person's input box is empty and they have stopped typing.
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
  /** The inbox the session's agent reads through its hooks; null = it reads none. */
  inbox?(key: string): string | null
  /** Someone types into the session without going through userInput (a direct tmux attach). */
  typedElsewhere?(key: string): Promise<boolean>
  /** How long a person must have stopped typing first. Default: VIBEFLOW_QUIET_MS, else 3 s. */
  quietMs?: number
  /** Give up waiting for quiet after this long. */
  timeoutMs?: number
}

export interface DeliverOptions {
  /** Type even into a permission dialog (the text may answer it). Only where there is no inbox. */
  force?: boolean
}

/** typed = into the terminal; queued = waiting in the inbox for the agent's next hook; hook = a hook already took it. */
export type DeliveryVia = 'typed' | 'queued' | 'hook'

export interface Mailbox {
  /** A person's keys: written now, or held while a delivery is mid-way. */
  userInput(key: string, data: string): void
  deliver(key: string, text: string, opts?: DeliverOptions): Promise<{ queuedMs: number; via: DeliveryVia }>
  /** The agent's state changed: an inbox message may now be typed to wake it. */
  poke(key: string): void
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

const PASTED = /\x1b\[200~[\s\S]*?(\x1b\[201~|$)/g
const ESCAPES = /\x1b(\[[0-9;?<=>]*[ -\/]*[@-~]|O.|.)?/g
const CLEARS_INPUT = /[\r\n\x03\x15]/

/**
 * Whether a person's input box still holds text after these keys. Enter,
 * Ctrl+C and Ctrl+U empty it; any visible character or paste fills it.
 * Deleting it by hand still counts as text until one of those, so an unsure
 * reading never sends a message on top of someone's words.
 */
export function draftAfter(before: boolean, data: string): boolean {
  const keys = data.replace(PASTED, 'x').replace(ESCAPES, '')
  let draft = before
  for (const ch of keys) {
    if (CLEARS_INPUT.test(ch)) draft = false
    else if (ch >= ' ' && ch !== '\x7f') draft = true
  }
  return draft
}

const isIdle = (a: Activity | null) => !a || a.state === 'unknown' || (a.state === 'waiting' && a.waitingFor === 'input')

export function createMailbox(options: MailboxOptions): Mailbox {
  const lastInput = new Map<string, number>()
  const drafts = new Set<string>()
  const held = new Map<string, string[]>()
  const turns = new Map<string, Promise<unknown>>()

  function noteInput(key: string, data: string): void {
    lastInput.set(key, Date.now())
    if (draftAfter(drafts.has(key), data)) drafts.add(key)
    else drafts.delete(key)
  }

  async function waitForQuiet(key: string, started: number): Promise<void> {
    const quiet = options.quietMs ?? quietFromEnv()
    const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    for (;;) {
      const left = drafts.has(key) ? 250 : (lastInput.get(key) ?? 0) + quiet - Date.now()
      if (left <= 0) return
      if (Date.now() - started > timeout) {
        throw coded('TIMEOUT', drafts.has(key) ? 'the input box still holds unsent text' : 'the terminal never went quiet')
      }
      await sleep(Math.min(left, 250))
    }
  }

  function enqueue<T>(key: string, job: () => Promise<T>): Promise<T> {
    const run = (turns.get(key) ?? Promise.resolve()).catch(() => {}).then(job)
    turns.set(key, run)
    void run.finally(() => {
      if (turns.get(key) === run) turns.delete(key)
    }).catch(() => {})
    return run
  }

  async function canWake(key: string): Promise<boolean> {
    if (!isIdle(options.activity(key)) || drafts.has(key)) return false
    return !(await options.typedElsewhere?.(key))
  }

  /** Type what waits in the inbox only if the agent would otherwise not see it until someone types. */
  async function wake(key: string, dir: string): Promise<DeliveryVia> {
    const quiet = options.quietMs ?? quietFromEnv()
    for (;;) {
      if (!(await canWake(key))) return 'queued'
      const left = (lastInput.get(key) ?? 0) + quiet - Date.now()
      if (left <= 0) break
      await sleep(Math.min(left, 250))
    }
    const texts = takeMessages(dir)
    if (!texts.length) return 'hook'
    await write(key, texts.join('\n\n'))
    return 'typed'
  }

  async function type(key: string, text: string, opts: DeliverOptions, started: number) {
    await waitForQuiet(key, started)
    if (!opts.force && isBlocked(options.activity(key))) {
      throw coded('TARGET_BLOCKED', 'the agent is on a permission dialog; typing could answer it')
    }
    await write(key, text)
    return { queuedMs: Date.now() - started, via: 'typed' as const }
  }

  async function write(key: string, text: string): Promise<void> {
    held.set(key, [])
    try {
      options.write(key, bracketedPaste(text))
      await sleep(PASTE_GAP_MS)
      options.write(key, '\r')
    } finally {
      const keys = held.get(key) ?? []
      held.delete(key)
      if (keys.length) options.write(key, keys.join(''))
    }
  }

  return {
    userInput(key, data) {
      noteInput(key, data)
      const buffer = held.get(key)
      if (buffer) {
        buffer.push(data)
        return
      }
      options.write(key, data)
    },

    deliver(key, text, opts = {}) {
      const started = Date.now()
      return enqueue(key, async () => {
        const dir = options.inbox?.(key)
        if (!dir) return type(key, text, opts, started)
        postMessage(dir, text)
        const via = await wake(key, dir)
        return { queuedMs: Date.now() - started, via }
      })
    },

    poke(key) {
      const dir = options.inbox?.(key)
      if (!dir || !pendingMessages(dir) || turns.has(key)) return
      void enqueue(key, () => wake(key, dir)).catch(() => {})
    },

    forget(key) {
      lastInput.delete(key)
      drafts.delete(key)
      held.delete(key)
    },
  }
}
