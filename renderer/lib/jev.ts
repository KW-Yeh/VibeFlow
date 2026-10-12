import type { JevRoute } from './types'

const PHASE_LABEL = {
  judging: '判斷任務難度',
  planning: '強模型規劃中',
  selecting: '挑選執行模型',
} as const

export function jevRoutingLabel(route: JevRoute): string {
  return `${PHASE_LABEL[route.phase ?? 'judging']}…`
}
