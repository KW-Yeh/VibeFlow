import test from 'node:test'
import assert from 'node:assert/strict'

import { osc52Text } from '../renderer/lib/terminal-clipboard.ts'

const b64 = (text) => Buffer.from(text, 'utf8').toString('base64')

test('osc52Text decodes a copy request, including UTF-8', () => {
  assert.equal(osc52Text(`c;${b64('hello world')}`), 'hello world')
  assert.equal(osc52Text(`;${b64('終端機 ✅')}`), '終端機 ✅')
})

test('osc52Text refuses clipboard reads and malformed payloads', () => {
  assert.equal(osc52Text('c;?'), null)
  assert.equal(osc52Text('c;'), null)
  assert.equal(osc52Text('no-separator'), null)
  assert.equal(osc52Text('c;not base64!'), null)
  assert.equal(osc52Text(`c;${Buffer.from([0xff, 0xfe]).toString('base64')}`), null)
})
