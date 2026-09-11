import type { Element, ElementContent } from 'hast'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import rehypeHighlight from 'rehype-highlight'
import type { PluggableList } from 'unified'

import MermaidDiagram from '@/components/mermaid-diagram'
import { HIGHLIGHT_ALIASES, HIGHLIGHT_LANGUAGES } from '@/lib/markdown-plugins'
import { cn } from '@/lib/utils'

/**
 * The heavy half of MarkdownContent — react-markdown, the remark/rehype plugins
 * and the highlight.js grammars all land in this chunk, which markdown-content
 * pulls in lazily. Import it from there, not directly.
 *
 * Raw HTML is intentionally not enabled; artifact and task markdown remains
 * inert renderer content. The one thing that reaches the DOM as markup is a
 * ```mermaid fence, and only after mermaid has sanitised it — see
 * mermaid-diagram.tsx.
 */
const REMARK_PLUGINS: PluggableList = [remarkGfm, remarkBreaks]

const REHYPE_PLUGINS: PluggableList = [
  [
    rehypeHighlight,
    {
      languages: HIGHLIGHT_LANGUAGES,
      aliases: HIGHLIGHT_ALIASES,
      // mermaid is drawn, not highlighted; without this rehype-highlight warns
      // once per fence that the grammar is not registered.
      plainText: ['mermaid'],
    },
  ],
]

/** Flatten a hast subtree back to its source text. */
function textOf(node: ElementContent): string {
  if (node.type === 'text') return node.value
  if (node.type === 'element') return node.children.map(textOf).join('')
  return ''
}

/** The mermaid source of a `<pre>` wrapping a ```mermaid fence, else null. */
function mermaidSourceOf(node: Element | undefined): string | null {
  const code = node?.children.find((child) => child.type === 'element')
  if (code?.type !== 'element' || code.tagName !== 'code') return null
  const className = code.properties.className
  if (!Array.isArray(className) || !className.includes('language-mermaid')) {
    return null
  }
  return code.children.map(textOf).join('')
}

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
        // `node` is the hast element react-markdown hands every custom
        // component; it must be kept off the DOM elements below.
        a: ({ children, node, ...props }) => (
          <a
            {...props}
            className="break-words text-primary underline underline-offset-2"
          >
            {children}
          </a>
        ),
        code: ({ children, className, node, ...props }) => {
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
        pre: ({ children, node, ...props }) => {
          const mermaid = mermaidSourceOf(node)
          if (mermaid !== null) {
            return <MermaidDiagram code={mermaid} compact={compact} />
          }
          return (
            <pre
              {...props}
              className={cn(
                'max-w-full overflow-x-auto rounded-md bg-background/70 p-3',
                compact ? 'text-xs leading-snug' : 'text-sm'
              )}
            >
              {children}
            </pre>
          )
        },
      }}
    >
      {source}
    </ReactMarkdown>
  )
}
