import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { readTerminalFile, resolveTerminalFile, MAX_PREVIEW_IMAGE_BYTES } from '../packages/core/src/terminal-files.ts'
import { findTerminalFiles } from '../renderer/lib/terminal-file-links.ts'

test('file candidates support quotes, locations, local URLs and ignore web URLs', () => {
  const text = 'see ./src/app.ts:12:4 and "./my image.png" /tmp/screen.png ~/notes.md file:///tmp/a%20b.png README.md https://example.com/a.png'
  assert.deepEqual(findTerminalFiles(text).map((m) => m.path), [
    './src/app.ts', './my image.png', '/tmp/screen.png', '~/notes.md', 'file:///tmp/a%20b.png', 'README.md',
  ])
  for (const match of findTerminalFiles(text)) assert.ok(text.slice(match.start, match.end).includes(match.path))
  assert.deepEqual(findTerminalFiles('hello world 1.23 https://example.com/a.png user@example.com'), [])
  assert.deepEqual(findTerminalFiles('C:\\work\\a.ts:2:1').map((m) => m.path), ['C:\\work\\a.ts'])
})

test('file resolution uses launch cwd, home, and rejects remote URLs and NUL', () => {
  const cwd = path.join(os.tmpdir(), 'project')
  assert.equal(resolveTerminalFile(cwd, './image.png'), path.join(cwd, 'image.png'))
  assert.equal(resolveTerminalFile(cwd, '~/notes.md'), path.join(os.homedir(), 'notes.md'))
  assert.equal(resolveTerminalFile(cwd, pathToFileURL(path.join(cwd, 'a b.png')).href), path.join(cwd, 'a b.png'))
  for (const value of ['file://remote/share/a.png', 'https://example.com/a.png', 'file:///tmp/a%00b', '\0bad', '']) {
    assert.throws(() => resolveTerminalFile(cwd, value))
  }
})

test('previews cap reads, classify binary and images, and report missing/non-files', async (t) => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-file-preview-'))
  t.after(() => fs.rm(cwd, { recursive: true, force: true }))
  await fs.writeFile(path.join(cwd, 'notes.md'), '# Preview')
  assert.deepEqual(await readTerminalFile(cwd, 'notes.md'), {
    ok: true, path: path.join(cwd, 'notes.md'), kind: 'text', text: '# Preview', truncated: false,
  })
  await fs.writeFile(path.join(cwd, 'large.log'), 'x'.repeat(300 * 1024))
  const large = await readTerminalFile(cwd, 'large.log')
  assert.equal(large.text.length, 256 * 1024)
  assert.equal(large.truncated, true)
  await fs.writeFile(path.join(cwd, 'binary.bin'), Buffer.from([1, 0, 255]))
  assert.equal((await readTerminalFile(cwd, 'binary.bin')).kind, 'binary')
  await fs.writeFile(path.join(cwd, 'image.png'), Buffer.from([137, 80, 78, 71]))
  assert.equal((await readTerminalFile(cwd, 'image.png')).dataUrl, 'data:image/png;base64,iVBORw==')
  const huge = await fs.open(path.join(cwd, 'huge.png'), 'w')
  await huge.truncate(MAX_PREVIEW_IMAGE_BYTES + 1)
  await huge.close()
  assert.equal((await readTerminalFile(cwd, 'huge.png')).kind, 'binary')
  assert.equal((await readTerminalFile(cwd, 'missing')).error, 'not_found')
  assert.equal((await readTerminalFile(cwd, '.')).error, 'not_file')
  assert.equal((await readTerminalFile(cwd, 'file://remote/a')).error, 'invalid_path')
  if (process.platform !== 'win32') {
    assert.equal((await readTerminalFile(cwd, os.devNull)).error, 'not_file')
    if (process.getuid() !== 0) {
      const locked = path.join(cwd, 'locked.txt')
      await fs.writeFile(locked, 'private', { mode: 0o000 })
      assert.equal((await readTerminalFile(cwd, locked)).error, 'unreadable')
      await fs.chmod(locked, 0o600)
    }
  }
})
