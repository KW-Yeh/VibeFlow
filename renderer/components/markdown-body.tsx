import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import rehypeHighlight from 'rehype-highlight'
import type { PluggableList } from 'unified'

import { HIGHLIGHT_ALIASES, HIGHLIGHT_LANGUAGES } from '@/lib/markdown-plugins'
import { cn } from '@/lib/utils'

/**
 * The heavy half of MarkdownContent — react-markdown, the remark/rehype plugins
 * and the highlight.js grammars all land in this chunk, which markdown-content
 * pulls in lazily. Import it from there, not directly.
 *
 * The plugin set matches main/helpers/markdown.ts so PLAN.md (rendered in the
 * main process to a standalone document) and everything rendered here agree.
 * Raw HTML is not enabled on either side; see MARKDOWN_RENDERING_PLAN.md §6.
 */
const REMARK_PLUGINS: PluggableList = [remarkGfm, remarkBreaks]

const REHYPE_PLUGINS: PluggableList = [
  [
    rehypeHighlight,
    { languages: HIGHLIGHT_LANGUAGES, aliases: HIGHLIGHT_ALIASES },
  ],
]

export default function MarkdownBody({
  source,
  compact,
}: {
  source: string
  compact: boolean
}) {
  return (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={REHYPE_PLUGINS}
      components={{
        a: ({ children, ...props }) => (
          <a
            {...props}
            className="break-words text-primary underline underline-offset-2"
          >
            {children}
          </a>
        ),
        code: ({ children, className, ...props }) => {
          // rehype-highlight marks fenced blocks with `language-*`; only inline
          // code should get the chip styling, or every highlighted block would
          // pick up an inline background and padding on top of <pre>'s.
          const isBlock = /\blanguage-/.test(className ?? '')
          return (
            <code
              {...props}
              className={
                isBlock
                  ? className
                  : cn('break-words rounded-xs bg-background/70 px-1 py-0.5', className)
              }
            >
              {children}
            </code>
          )
        },
        pre: ({ children, ...props }) => (
          <pre
            {...props}
            className={cn(
              'max-w-full overflow-x-auto rounded-md bg-background/70 p-3',
              compact ? 'text-xs leading-snug' : 'text-sm'
            )}
          >
            {children}
          </pre>
        ),
      }}
    >
      {source}
    </ReactMarkdown>
  )
}
