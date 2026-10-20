import type { JevRoute } from './types'

export function jevRoutingLabel(route: JevRoute): string {
  return route.status === 'routing' ? '選擇 effort 中…' : ''
}
