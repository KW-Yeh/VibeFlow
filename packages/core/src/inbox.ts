import fs from 'fs'
import path from 'path'
import { INBOX_DIR, INBOX_READY_FILE } from './launch'

/**
 * A card's inbox: messages for its agent, one file each, that the agent's own
 * hooks read (launch.ts `inboxHookCommand`). Names sort in arrival order;
 * dot-files are in-flight or claimed and never read as messages.
 */

export { INBOX_DIR }

let seq = 0

export function inboxDir(worktreePath: string): string {
  return path.join(worktreePath, INBOX_DIR)
}

/** Whether the session running in that worktree has hooks that read its inbox. */
export function inboxReady(dir: string): boolean {
  return fs.existsSync(path.join(dir, INBOX_READY_FILE))
}

/**
 * Before a launch: a session that may not read the inbox must not inherit an
 * older one's mark, and nothing in the inbox may ever be committed — worktrees
 * provisioned before the inbox existed have no exclude entry for it.
 */
export function prepareInbox(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, '.gitignore'), '*\n')
  fs.rmSync(path.join(dir, INBOX_READY_FILE), { force: true })
}

function messageNames(dir: string): string[] {
  try {
    return fs.readdirSync(dir).filter((n) => !n.startsWith('.')).sort()
  } catch {
    return []
  }
}

export function pendingMessages(dir: string): number {
  return messageNames(dir).length
}

/** Returns the message's name, which sorts after every earlier one. */
export function postMessage(dir: string, text: string): string {
  fs.mkdirSync(dir, { recursive: true })
  const name = `${String(Date.now()).padStart(13, '0')}-${String(seq++ % 1e6).padStart(6, '0')}`
  const tmp = path.join(dir, `.tmp-${name}`)
  fs.writeFileSync(tmp, text)
  fs.renameSync(tmp, path.join(dir, name))
  return name
}

export interface InboxMessage {
  name: string
  text: string
}

/**
 * Claim waiting messages for the host to type itself, oldest first, up to and
 * including `upTo` when given; what a hook already took is gone.
 */
export function takeMessages(dir: string, upTo?: string): InboxMessage[] {
  const taken: InboxMessage[] = []
  for (const name of messageNames(dir)) {
    if (upTo !== undefined && name > upTo) break
    const claimed = path.join(dir, `.host-${name}`)
    try {
      fs.renameSync(path.join(dir, name), claimed)
    } catch {
      continue
    }
    taken.push({ name, text: fs.readFileSync(claimed, 'utf8') })
    fs.rmSync(claimed, { force: true })
  }
  return taken
}

/** Whether a message is still in the inbox, waiting or mid-claim by a hook or the host. */
export function inboxHas(dir: string, name: string): boolean {
  return [name, `.hook-${name}`, `.host-${name}`].some((n) => fs.existsSync(path.join(dir, n)))
}
