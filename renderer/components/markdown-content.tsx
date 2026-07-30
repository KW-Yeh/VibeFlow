import { lazy, Suspense } from 'react'

import { cn } from '@/lib/utils'

const MarkdownBody = lazy(() => import('@/components/markdown-body'))

/**
 * Rendered GFM markdown on a muted card. The `prose` chrome and the highlight.js
 * palette are bound to the app's tokens in styles/globals.css.
 *
 * Used for anything the agent wrote for a human to read — task descriptions,
 * memory checkpoint outcomes, sub-agent results, `.md` artifacts. Verbatim text
 * (sub-agent prompts, logs, non-markdown artifacts) stays in a <pre>, since
 * whitespace carries meaning there and the copy button must match what is shown.
 */
export function MarkdownContent({
  source,
  compact = false,
  className,
}: {
  source: string
  compact?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        'prose max-w-none break-words rounded-md bg-muted/30 p-3 text-muted-foreground',
        compact ? 'prose-xs' : 'prose-sm',
        className
      )}
    >
      <Suspense fallback={null}>
        <MarkdownBody source={source} compact={compact} />
      </Suspense>
    </div>
  )
}
