import { lazy, Suspense } from 'react'

import { cn } from '@/lib/utils'

const MarkdownBody = lazy(() => import('@/components/markdown-body'))

/**
 * Rendered GFM markdown on a muted card. The `prose` chrome and the highlight.js
 * palette are bound to the app's tokens in styles/globals.css.
 *
 * Used for anything the agent wrote for a human to read — task descriptions,
 * specs, and `.md` artifacts. Verbatim text (logs and non-markdown artifacts)
 * stays in a <pre> so whitespace and copied text match the source.
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
