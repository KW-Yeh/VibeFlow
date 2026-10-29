import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { existingTerminalFiles, readTerminalFile, resolveTerminalFile, MAX_PREVIEW_IMAGE_BYTES } from '../packages/core/src/terminal-files.ts'
import { findTerminalFiles, pickSpanningFiles, spanningFileCandidates } from '../renderer/lib/terminal-file-links.ts'

test('file candidates support quotes, locations, local URLs and ignore web URLs', () => {
  const text = 'see ./src/app.ts:12:4 and "./my image.png" /tmp/screen.png ~/notes.md file:///tmp/a%20b.png README.md https://example.com/a.png'
  assert.deepEqual(findTerminalFiles(text).map((m) => m.path), [
    './src/app.ts', './my image.png', '/tmp/screen.png', '~/notes.md', 'file:///tmp/a%20b.png', 'README.md',
  ])
  for (const match of findTerminalFiles(text)) assert.ok(text.slice(match.start, match.end).includes(match.path))
  assert.deepEqual(findTerminalFiles('hello world 1.23 https://example.com/a.png user@example.com'), [])
  assert.deepEqual(findTerminalFiles('C:\\work\\a.ts:2:1').map((m) => m.path), ['C:\\work\\a.ts'])
})

function spanning(lines, existing) {
  return pickSpanningFiles(spanningFileCandidates(lines), existing)
}

test('spanning candidates join unquoted spaces and agent-inserted line breaks, kept only when they exist', () => {
  const spaced = '⏺ Saved to /Users/me/My Shots/shot 1.png.'
  assert.deepEqual(spanning([spaced], ['/Users/me/My Shots/shot 1.png']), [{
    path: '/Users/me/My Shots/shot 1.png', start: { line: 0, offset: 11 }, end: { line: 0, offset: spaced.length - 1 },
  }])
  // Claude Code breaks a long word at the column edge and indents the rest.
  const hard = ['⏺ Screenshot: /Users/me/project/.vibeflow/vf-1234/artifa', '  cts/after.png (1440px)']
  assert.deepEqual(spanning(hard, ['/Users/me/project/.vibeflow/vf-1234/artifacts/after.png']).map((c) => [c.path, c.end]),
    [['/Users/me/project/.vibeflow/vf-1234/artifacts/after.png', { line: 1, offset: 15 }]])
  // Word wrap at the space inside the path.
  const soft = ['  - ./docs/My', '    Notes/plan.md:12 updated']
  assert.deepEqual(spanning(soft, ['./docs/My Notes/plan.md']).map((c) => c.path), ['./docs/My Notes/plan.md'])
  // Prose after a path is never swallowed unless that longer file exists.
  assert.deepEqual(spanning(['see /tmp/a and b.png'], ['/tmp/a']), [])
  assert.deepEqual(spanning(['see /tmp/a and b.png'], ['/tmp/a and b.png']).map((c) => c.path), ['/tmp/a and b.png'])
  assert.deepEqual(spanning(['open https://example.com/a b.png'], ['https://example.com/a b.png']), [])
  // A nested shorter match yields to the longest existing one.
  assert.deepEqual(spanning(['[x](/a/My Docs/b.md)'], ['/a/My Docs/b.md', 'Docs/b.md']).map((c) => c.path), ['/a/My Docs/b.md'])
  assert.ok(spanningFileCandidates(['/a b c d e f g h i j k l m n o p q r s t']).length < 20)
})

test('existing file check only accepts regular files', async (t) => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-file-exists-'))
  t.after(() => fs.rm(cwd, { recursive: true, force: true }))
  await fs.mkdir(path.join(cwd, 'My Shots'))
  await fs.writeFile(path.join(cwd, 'My Shots', 'shot 1.png'), '')
  assert.deepEqual(
    await existingTerminalFiles(cwd, ['./My Shots/shot 1.png', './My Shots', './missing.png', 'https://x/a.png', '\0']),
    ['./My Shots/shot 1.png'],
  )
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
