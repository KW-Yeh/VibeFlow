import type { JevRoute } from './types'

const PHASE_LABELS = {
  judging: '判斷任務中…',
  scouting: '補充 context 中…',
  selecting: '選擇模型中…',
} as const

export function jevRoutingLabel(route: JevRoute): string {
  if (route.status !== 'routing') return ''
  return route.phase ? PHASE_LABELS[route.phase] : '判斷任務中…'
}

/**
 * What a settled route ran on. `cardModel` is the card's own pick: then Jev
 * only chose effort and the model part says nothing new.
 */
export function jevResultLabel(route: JevRoute, cardModel?: string): string {
  const effort = route.effort ?? '模型預設 effort'
  if (cardModel) return `Jev effort：${effort}`
  return `Jev：${route.model ?? 'CLI 預設模型'} · ${effort}`
}
