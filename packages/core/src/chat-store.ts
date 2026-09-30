import { JsonStore } from './json-store'

export interface ChatAttachment {
  id: string
  name: string
  mime: string
  /** Absolute path inside the worktree's .vibeflow-attachments/ directory. */
  path: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  ts: number
  attachments?: ChatAttachment[]
  /** True on the separator message inserted when the user triggers compact. */
  isCompactMarker?: boolean
}

export interface Conversation {
  taskId: string
  messages: ChatMessage[]
  updatedAt: number
  /**
   * When set, overrides the default executorSessionId for subsequent sends.
   * Written by the compact handler to force a fresh Claude session.
   */
  activeSessionId?: string
}

interface ChatStoreSchema {
  conversations: Record<string, Conversation>
}

let _chatStore: JsonStore<ChatStoreSchema> | null = null

function getChatStore(): JsonStore<ChatStoreSchema> {
  if (!_chatStore) {
    _chatStore = new JsonStore<ChatStoreSchema>({
      name: 'vibeflow-chats',
      defaults: { conversations: {} },
    })
  }
  return _chatStore
}

function setConversation(taskId: string, conversation: Conversation | null): void {
  const store = getChatStore()
  const conversations = { ...store.get('conversations') }
  if (conversation) conversations[taskId] = conversation
  else delete conversations[taskId]
  store.set('conversations', conversations)
}

export function loadConversation(taskId: string): Conversation | null {
  return getChatStore().get('conversations')[taskId] ?? null
}

export function appendMessage(taskId: string, message: ChatMessage): void {
  const existing = loadConversation(taskId) ?? {
    taskId,
    messages: [],
    updatedAt: 0,
  }
  existing.messages.push(message)
  existing.updatedAt = Date.now()
  setConversation(taskId, existing)
}

export function clearConversation(taskId: string): void {
  setConversation(taskId, null)
}

/** Clear all messages and pin a new session ID so the next send starts fresh. */
export function clearMessages(taskId: string, newSessionId: string): void {
  setConversation(taskId, {
    taskId,
    messages: [],
    updatedAt: Date.now(),
    activeSessionId: newSessionId,
  })
}
