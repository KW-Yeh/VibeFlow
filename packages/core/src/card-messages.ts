import { randomUUID } from 'crypto'
import { JsonStore } from './json-store'
import { getPlatform } from './platform'

/**
 * The record of what cards (and the person) said to each other. Delivery
 * itself stays in mailbox.ts; this only remembers each message and whether
 * the receiving agent has read it. VibeFlow's own notes are not recorded.
 */

export type CardMessageSender = { kind: 'task'; id: string; title: string } | { kind: 'person' }
export type CardMessageState = 'unread' | 'read' | 'failed'
export type CardMessageVia = 'hook' | 'typed'

export interface CardMessageThread {
  /** The card the conversation comes from; the person's messages keep the thread they were written in. */
  from: string
  to: string
}

export interface CardMessage {
  id: string
  thread: CardMessageThread
  sender: CardMessageSender
  to: string
  text: string
  sentAt: number
  state: CardMessageState
  via?: CardMessageVia
  readAt?: number
  inboxName?: string
  error?: string
}

export interface CardMessageThreadSummary {
  from: string
  to: string
  fromTitle: string
  toTitle: string
  unread: number
  total: number
  last: { id: string; text: string; sentAt: number; state: CardMessageState; sender: CardMessageSender['kind'] }
}

interface MessageStoreSchema {
  version: number
  messages: CardMessage[]
}

const STORE_VERSION = 1

let _store: { dir: string; store: JsonStore<MessageStoreSchema> } | null = null

function getMessageStore(): JsonStore<MessageStoreSchema> {
  const dir = getPlatform().userDataDir()
  if (_store?.dir !== dir) {
    _store = {
      dir,
      store: new JsonStore<MessageStoreSchema>({
        name: 'vibeflow-messages',
        cwd: dir,
        defaults: { version: STORE_VERSION, messages: [] },
      }),
    }
  }
  return _store.store
}

export function listCardMessages(): CardMessage[] {
  const messages = getMessageStore().get('messages')
  return Array.isArray(messages) ? messages : []
}

function writeMessages(messages: CardMessage[]): void {
  const store = getMessageStore()
  store.set('version', STORE_VERSION)
  store.set('messages', messages)
}

export function recordCardMessage(input: Omit<CardMessage, 'id' | 'sentAt' | 'state'> & { sentAt?: number }): CardMessage {
  const message: CardMessage = { ...input, id: randomUUID(), sentAt: input.sentAt ?? Date.now(), state: 'unread' }
  writeMessages([...listCardMessages(), message])
  return message
}

export function updateCardMessages(patches: Map<string, Partial<CardMessage>>): CardMessage[] {
  if (!patches.size) return []
  const changed: CardMessage[] = []
  const next = listCardMessages().map((m) => {
    const patch = patches.get(m.id)
    if (!patch) return m
    const updated = { ...m, ...patch }
    changed.push(updated)
    return updated
  })
  if (changed.length) writeMessages(next)
  return changed
}

export function findCardMessage(id: string): CardMessage | undefined {
  return listCardMessages().find((m) => m.id === id)
}

export function threadMessages(from: string, to: string, messages = listCardMessages()): CardMessage[] {
  return messages
    .filter((m) => m.thread.from === from && m.thread.to === to)
    .sort((a, b) => a.sentAt - b.sentAt)
}

export function unreadMessagesTo(to: string, messages = listCardMessages()): CardMessage[] {
  return messages.filter((m) => m.to === to && m.state === 'unread').sort((a, b) => a.sentAt - b.sentAt)
}

export function deleteMessagesFor(taskId: string): string[] {
  const all = listCardMessages()
  const touched = (m: CardMessage) => m.to === taskId || m.thread.from === taskId || (m.sender.kind === 'task' && m.sender.id === taskId)
  const kept = all.filter((m) => !touched(m))
  if (kept.length === all.length) return []
  writeMessages(kept)
  return [...new Set(all.filter(touched).map((m) => m.to))]
}

export function summarizeThreads(messages: CardMessage[], titleOf: (taskId: string) => string | undefined): CardMessageThreadSummary[] {
  const groups = new Map<string, CardMessage[]>()
  for (const m of messages) {
    const key = `${m.thread.from}>${m.thread.to}`
    const list = groups.get(key)
    if (list) list.push(m)
    else groups.set(key, [m])
  }
  const summaries: CardMessageThreadSummary[] = []
  for (const list of groups.values()) {
    list.sort((a, b) => a.sentAt - b.sentAt)
    const last = list[list.length - 1]
    const { from, to } = last.thread
    const senderTitle = list.find((m) => m.sender.kind === 'task' && m.sender.id === from)
    summaries.push({
      from,
      to,
      fromTitle: titleOf(from) ?? (senderTitle?.sender.kind === 'task' ? senderTitle.sender.title : from),
      toTitle: titleOf(to) ?? to,
      unread: list.filter((m) => m.state === 'unread').length,
      total: list.length,
      last: { id: last.id, text: last.text, sentAt: last.sentAt, state: last.state, sender: last.sender.kind },
    })
  }
  return summaries.sort((a, b) => b.last.sentAt - a.last.sentAt)
}

/**
 * Which unread inbox messages the agent has now read: those whose file has
 * left the inbox. The host reports the ones it typed itself; any other that
 * is gone was taken by the agent's hook.
 */
export function readPatches(
  unread: CardMessage[],
  inInbox: (name: string) => boolean,
  typed: ReadonlySet<string>,
  now = Date.now(),
): Map<string, Partial<CardMessage>> {
  const patches = new Map<string, Partial<CardMessage>>()
  for (const m of unread) {
    if (m.state !== 'unread' || !m.inboxName) continue
    if (typed.has(m.inboxName)) patches.set(m.id, { state: 'read', via: 'typed', readAt: now })
    else if (!inInbox(m.inboxName)) patches.set(m.id, { state: 'read', via: 'hook', readAt: now })
  }
  return patches
}
