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
