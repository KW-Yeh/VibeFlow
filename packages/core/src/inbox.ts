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

export function postMessage(dir: string, text: string): void {
  fs.mkdirSync(dir, { recursive: true })
  const name = `${String(Date.now()).padStart(13, '0')}-${String(seq++ % 1e6).padStart(6, '0')}`
  const tmp = path.join(dir, `.tmp-${name}`)
  fs.writeFileSync(tmp, text)
  fs.renameSync(tmp, path.join(dir, name))
}

/** Claim every waiting message for the host to type itself; what a hook already took is gone. */
export function takeMessages(dir: string): string[] {
  const texts: string[] = []
  for (const name of messageNames(dir)) {
    const claimed = path.join(dir, `.host-${name}`)
    try {
      fs.renameSync(path.join(dir, name), claimed)
    } catch {
      continue
    }
    texts.push(fs.readFileSync(claimed, 'utf8'))
    fs.rmSync(claimed, { force: true })
  }
  return texts
}
