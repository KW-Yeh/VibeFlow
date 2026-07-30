import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import remarkRehype from 'remark-rehype'
import rehypeHighlight from 'rehype-highlight'
import rehypeStringify from 'rehype-stringify'

import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'

/**
 * Grammars registered for code highlighting. rehype-highlight defaults to
 * lowlight's `common` set (~40 grammars); passing `languages` REPLACES that
 * registry, so this list is the whole of what gets bundled — which is the point,
 * since both this bundle and the renderer's ship inside the app.
 *
 * The renderer keeps its own copy in renderer/lib/markdown-plugins.ts: the
 * renderer must not import main code at runtime (see AGENTS.md), and both sides
 * have to agree on the GFM/highlight semantics. Change the two together.
 */
export const HIGHLIGHT_LANGUAGES = {
  bash,
  css,
  diff,
  javascript,
  json,
  markdown,
  python,
  typescript,
  xml,
}

export const HIGHLIGHT_ALIASES = {
  bash: ['sh', 'zsh', 'shell'],
  javascript: ['js', 'jsx', 'mjs', 'cjs'],
  markdown: ['md'],
  typescript: ['ts', 'tsx'],
  xml: ['html'],
}

/**
 * `allowDangerousHtml` is deliberately left at its default (false), so raw HTML
 * in the source is dropped rather than passed through. The markdown reaching
 * this pipeline is written by the agent, which may have folded in text it read
 * from third-party sources, and the rendered plan is handed to an iframe in the
 * renderer. Supporting embedded HTML would require rehype-raw paired with
 * rehype-sanitize; see MARKDOWN_RENDERING_PLAN.md §6.
 */
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkBreaks)
  .use(remarkRehype)
  .use(rehypeHighlight, {
    languages: HIGHLIGHT_LANGUAGES,
    aliases: HIGHLIGHT_ALIASES,
  })
  .use(rehypeStringify)
  .freeze()

/** Render GFM markdown to an HTML fragment (no wrapping document). */
export async function renderMarkdownToHtml(md: string): Promise<string> {
  const file = await processor.process(md)
  return String(file)
}
