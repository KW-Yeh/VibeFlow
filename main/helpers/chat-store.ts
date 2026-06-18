import Store from 'electron-store'

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
}

interface ChatStoreSchema {
  conversations: Record<string, Conversation>
}

let _chatStore: Store<ChatStoreSchema> | null = null

function getChatStore(): Store<ChatStoreSchema> {
  if (!_chatStore) {
    _chatStore = new Store<ChatStoreSchema>({
      name: 'vibeflow-chats',
      defaults: { conversations: {} },
    })
  }
  return _chatStore
}

export function loadConversation(taskId: string): Conversation | null {
  return getChatStore().get(`conversations.${taskId}`) ?? null
}

export function appendMessage(taskId: string, message: ChatMessage): void {
  const store = getChatStore()
  const existing = store.get(`conversations.${taskId}`) ?? {
    taskId,
    messages: [],
    updatedAt: 0,
  }
  existing.messages.push(message)
  existing.updatedAt = Date.now()
  store.set(`conversations.${taskId}`, existing)
}

export function clearConversation(taskId: string): void {
  const store = getChatStore()
  store.delete(`conversations.${taskId}` as keyof ChatStoreSchema)
}
