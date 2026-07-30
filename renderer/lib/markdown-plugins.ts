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
 * Mirror of HIGHLIGHT_LANGUAGES / HIGHLIGHT_ALIASES in main/helpers/markdown.ts.
 *
 * It is duplicated rather than shared because the renderer must not import main
 * code at runtime (see AGENTS.md — only `export type` re-exports cross the
 * boundary), and both sides have to agree on highlight semantics so a plan and a
 * task description render the same code the same way. Change the two together.
 *
 * Passing `languages` to rehype-highlight REPLACES lowlight's default `common`
 * registry, so this list is the whole of what ships in the renderer bundle.
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
