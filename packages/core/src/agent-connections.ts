import type { ConnectableAgentId } from './store'

export interface AgentProviderInfo {
  id: ConnectableAgentId
  name: string
  keyUrl: string
}

export const CONNECTABLE_AGENTS: AgentProviderInfo[] = [
  {
    id: 'claude',
    name: 'Claude',
    keyUrl: 'https://platform.claude.com/settings/workspaces/default/keys',
  },
  {
    id: 'codex',
    name: 'OpenAI',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
]

function modelIdFromUnknown(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const id = (value as { id?: unknown }).id
  return typeof id === 'string' && id.trim() ? id.trim() : null
}

function sortModels(ids: string[]): string[] {
  return Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b))
}

function providerAuthError(status: number): string {
  if (status === 401 || status === 403) {
    return 'API key 無效或沒有權限，請確認後重新輸入。'
  }
  return `取得 model list 失敗（HTTP ${status}）。`
}

export async function fetchAgentModels(
  agentId: ConnectableAgentId,
  apiKey: string
): Promise<string[]> {
  const key = apiKey.trim()
  if (!key) throw new Error('請輸入 API key。')

  const response = agentId === 'claude'
    ? await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
      })
    : await fetch('https://api.openai.com/v1/models', {
        headers: {
          Authorization: `Bearer ${key}`,
        },
      })

  if (!response.ok) {
    throw new Error(providerAuthError(response.status))
  }

  const body = await response.json() as { data?: unknown }
  const data = Array.isArray(body.data) ? body.data : []
  return sortModels(data.map(modelIdFromUnknown).filter((id): id is string => Boolean(id)))
}
