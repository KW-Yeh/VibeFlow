import test from 'node:test'
import assert from 'node:assert/strict'
import { adfToMarkdown } from '../packages/core/src/jira-adf.ts'

test('ADF converts text, marks, lists and code to Markdown', () => {
  const document = { type: 'doc', content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
    { type: 'paragraph', content: [
      { type: 'text', text: 'bold', marks: [{ type: 'strong' }] },
      { type: 'text', text: ' link', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
    ] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'One' }] }] }] },
    { type: 'codeBlock', attrs: { language: 'js' }, content: [{ type: 'text', text: 'const a = 1' }] },
  ] }
  const result = adfToMarkdown(document)
  assert.match(result, /## Title/)
  assert.match(result, /\*\*bold\*\*/)
  assert.match(result, /\[ link\]\(https:\/\/example.com\)/)
  assert.match(result, /- One/)
  assert.match(result, /```js\nconst a = 1\n```/)
  assert.equal(adfToMarkdown('already markdown'), 'already markdown')
})
