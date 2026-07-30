import test from 'node:test'
import assert from 'node:assert/strict'
import { renderMarkdownToHtml } from '../main/helpers/markdown.ts'

/**
 * These lock in the GFM features the hand-rolled regex converter in plan-html.ts
 * used to get wrong (blockquotes, images, nested lists, autolinks, code blocks
 * inside list items, setext headings, ordered-list start, footnotes) alongside
 * the ones it got right and must not regress (tables with alignment, task lists,
 * strikethrough, fenced code with a language class).
 */

const render = (md) => renderMarkdownToHtml(md)

test('blockquote becomes a real blockquote', async () => {
  const html = await render('> quoted line')
  assert.match(html, /<blockquote>/)
  assert.match(html, /<p>quoted line<\/p>/)
  assert.doesNotMatch(html, /&gt; quoted/)
})

test('image renders as img, not a link with a stray bang', async () => {
  const html = await render('![alt text](https://example.com/y.png)')
  assert.match(html, /<img src="https:\/\/example\.com\/y\.png" alt="alt text">/)
  assert.doesNotMatch(html, /!<a /)
})

test('bare URLs autolink (GFM)', async () => {
  const html = await render('see https://example.com now')
  assert.match(html, /<a href="https:\/\/example\.com">https:\/\/example\.com<\/a>/)
})

test('nested lists keep their depth', async () => {
  const html = await render('- a\n  - b\n    - c')
  // Three levels means three opening <ul> tags, not three flat <li>.
  assert.equal(html.match(/<ul>/g)?.length, 3)
})

test('fenced code inside a list item stays a code block', async () => {
  const html = await render('- item\n\n  ```js\n  const a = 1\n  ```')
  assert.match(html, /<li>[\s\S]*<pre><code class="hljs language-js">/)
  assert.doesNotMatch(html, /<p>\s*```/)
})

test('setext heading is a heading', async () => {
  const html = await render('Title\n=====')
  assert.match(html, /<h1>Title<\/h1>/)
})

test('ordered list preserves its start value', async () => {
  const html = await render('3. three\n4. four')
  assert.match(html, /<ol start="3">/)
})

test('footnotes render with a backref section', async () => {
  const html = await render('note[^1]\n\n[^1]: the note')
  assert.match(html, /<sup><a href="#user-content-fn-1"/)
  assert.match(html, /class="footnotes"/)
  assert.match(html, /the note/)
})

test('soft line breaks become <br> (remark-breaks)', async () => {
  const html = await render('line one\nline two')
  assert.match(html, /line one<br>/)
  // One paragraph, not two.
  assert.equal(html.match(/<p>/g)?.length, 1)
})

// ── Must-not-regress: what the old converter already handled ────────────────

test('table renders with per-column alignment', async () => {
  const html = await render('| a | b | c |\n| :-- | :-: | --: |\n| 1 | 2 | 3 |')
  assert.match(html, /<th align="left">a<\/th>/)
  assert.match(html, /<th align="center">b<\/th>/)
  assert.match(html, /<th align="right">c<\/th>/)
  assert.match(html, /<td align="left">1<\/td>/)
})

test('escaped pipes stay inside one table cell', async () => {
  const html = await render('| a | b |\n| --- | --- |\n| x\\|y | z |')
  assert.match(html, /<td>x\|y<\/td>/)
  assert.equal(html.match(/<td/g)?.length, 2)
})

test('task list carries the GFM classes and checkbox state', async () => {
  const html = await render('- [x] done\n- [ ] todo')
  assert.match(html, /<ul class="contains-task-list">/)
  assert.match(html, /<li class="task-list-item"><input type="checkbox" checked disabled>/)
  assert.match(html, /<li class="task-list-item"><input type="checkbox" disabled>/)
})

test('strikethrough renders as del', async () => {
  const html = await render('~~gone~~')
  assert.match(html, /<del>gone<\/del>/)
})

test('fenced code gets a language class and highlight spans', async () => {
  const html = await render('```ts\nconst x: number = 1\n```')
  assert.match(html, /<code class="hljs language-ts">/)
  assert.match(html, /<span class="hljs-keyword">const<\/span>/)
})

test('a language outside the registered set renders untokenised', async () => {
  const html = await render('```brainfuck\n+++\n```')
  assert.match(html, /<code class="hljs language-brainfuck">/)
  assert.match(html, /\+\+\+/)
  // No grammar registered for it, so nothing gets tokenised.
  assert.doesNotMatch(html, /hljs-/)
})

// ── Security: raw HTML must not survive ─────────────────────────────────────

test('raw HTML in the source is dropped, not passed through', async () => {
  const html = await render('text <script>alert(1)</script> <kbd>C</kbd>')
  assert.doesNotMatch(html, /<script/)
  assert.doesNotMatch(html, /<kbd/)
})

test('HTML-significant characters in text are escaped', async () => {
  const html = await render('a < b && c > d')
  assert.match(html, /a &#x3C; b &#x26;&#x26; c > d/)
})
