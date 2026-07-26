import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

// ── Static UI-consistency invariants (PLAN §2.1, I1–I6) ─────────────────────
// These scan the renderer source as text and assert the design-system rules
// established by side-menu.tsx hold across the rest of the UI. They test
// *authored source*, so they run without a browser / build step.

const here = dirname(fileURLToPath(import.meta.url))
const rendererRoot = join(here, '..', 'renderer')

/** Recursively collect *.tsx under a directory (skips build output). */
function walkTsx(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...walkTsx(full))
    else if (entry.endsWith('.tsx')) out.push(full)
  }
  return out
}

const FILES = [
  ...walkTsx(join(rendererRoot, 'components')),
  ...walkTsx(join(rendererRoot, 'pages')),
]

const read = (f) => readFileSync(f, 'utf8')
const rel = (f) => relative(rendererRoot, f).replaceAll('\\', '/')

/** Strip block comments (including JSX comment braces) so prose can't trip a scan. */
function stripBlockComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Line number (1-based) of a character offset. */
function lineOf(src, index) {
  return src.slice(0, index).split('\n').length
}

/**
 * Extract each hand-written `<button …>` opening tag as text, tracking quote
 * and brace state so `=>` arrows and `>` inside expressions don't end the tag
 * early.
 */
function extractButtonTags(content) {
  const tags = []
  let i = 0
  while ((i = content.indexOf('<button', i)) !== -1) {
    const after = content[i + 7]
    if (after && !/[\s/>]/.test(after)) {
      i += 7
      continue
    }
    let depth = 0
    let quote = null
    let j = i + 7
    for (; j < content.length; j++) {
      const c = content[j]
      if (quote) {
        if (c === quote) quote = null
        continue
      }
      if (c === '"' || c === "'" || c === '`') quote = c
      else if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) break
    }
    tags.push({ text: content.slice(i, j + 1), index: i })
    i = j + 1
  }
  return tags
}

test('I1 — no bare `rounded` class (radius must use the token ladder)', () => {
  const bareRounded = /\brounded(?![-\w])/g
  const violations = []
  for (const file of FILES) {
    const src = stripBlockComments(read(file))
    let m
    while ((m = bareRounded.exec(src)) !== null) {
      violations.push(`${rel(file)}:${lineOf(src, m.index)}`)
    }
  }
  assert.deepEqual(
    violations,
    [],
    `Bare \`rounded\` found (use rounded-xs/sm/md/lg/xl/full):\n${violations.join('\n')}`
  )
})

test('I2 — focus rings use ring-[3px], never ring-2', () => {
  const ringTwo = /focus-visible:ring-2\b/g
  const violations = []
  for (const file of FILES) {
    const src = read(file)
    let m
    while ((m = ringTwo.exec(src)) !== null) {
      violations.push(`${rel(file)}:${lineOf(src, m.index)}`)
    }
  }
  assert.deepEqual(
    violations,
    [],
    `\`focus-visible:ring-2\` found (use focus-visible:ring-[3px]):\n${violations.join('\n')}`
  )
})

test('I3 — every hand-written <button> has a visible keyboard focus ring', () => {
  // The shadcn primitives (Button, IconButton) carry the ring in their base
  // class via cva; assert that here so their <button> tags are exempt below.
  const buttonBase = read(join(rendererRoot, 'components/ui/button.tsx'))
  const iconButtonBase = read(join(rendererRoot, 'components/ui/icon-button.tsx'))
  assert.ok(
    buttonBase.includes('focus-visible:ring-[3px]'),
    'ui/button.tsx base class must define focus-visible:ring-[3px]'
  )
  assert.ok(
    iconButtonBase.includes('focus-visible:ring-[3px]'),
    'ui/icon-button.tsx base class must define focus-visible:ring-[3px]'
  )

  const violations = []
  for (const file of FILES) {
    if (rel(file).startsWith('components/ui/')) continue // design-system primitives
    const src = read(file)
    for (const tag of extractButtonTags(src)) {
      if (!tag.text.includes('focus-visible:ring-[3px]')) {
        violations.push(`${rel(file)}:${lineOf(src, tag.index)}`)
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    `Hand-written <button> without focus-visible:ring-[3px]:\n${violations.join('\n')}`
  )
})

test('I4 — the field class string lives only in ui/field.tsx', () => {
  const needle = 'w-full rounded-md border bg-background px-3 py-2'
  const owners = FILES.filter((f) => read(f).includes(needle)).map(rel)
  assert.deepEqual(
    owners,
    ['components/ui/field.tsx'],
    `Field class string must be a single source of truth (ui/field.tsx). Found in:\n${owners.join('\n')}`
  )
})

test('I5 — the section-eyebrow class string lives only in ui/section-label.tsx', () => {
  const needle = 'text-xs font-semibold uppercase tracking-wider'
  const owners = FILES.filter((f) => read(f).includes(needle)).map(rel)
  assert.deepEqual(
    owners,
    ['components/ui/section-label.tsx'],
    `Section eyebrow class string must be a single source of truth (ui/section-label.tsx). Found in:\n${owners.join('\n')}`
  )
})

test('I6 — drawers/dialogs use DialogShell headers, not hand-written <h2>', () => {
  const targets = ['components/sub-agent-drawer.tsx', 'components/remote-share-dialog.tsx']
  const violations = []
  for (const file of FILES) {
    if (!targets.includes(rel(file))) continue
    if (read(file).includes('<h2')) violations.push(rel(file))
  }
  assert.deepEqual(
    violations,
    [],
    `Hand-written <h2> found (use DialogShell showHeader):\n${violations.join('\n')}`
  )
})
