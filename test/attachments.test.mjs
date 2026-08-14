import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs/promises'

import {
  ATTACHMENTS_DIR,
  fileToAttachmentInput,
  writeAttachments,
} from '../main/helpers/attachments.ts'
import { git, makeRepo } from './support/repo.mjs'

test('writeAttachments writes exact bytes with safe filenames and stays ignored', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: false })
  try {
    const bytes = Buffer.from([0, 1, 2, 127, 128, 255])
    const [attachment] = writeAttachments(projectPath, [{
      name: `../unsafe\\name\n${'檔'.repeat(100)}.bin`,
      mime: 'application/octet-stream',
      dataBase64: bytes.toString('base64'),
    }])

    assert.equal(path.dirname(attachment.path), path.join(projectPath, ATTACHMENTS_DIR))
    assert.ok(!attachment.name.includes('/') && !attachment.name.includes('\\'))
    assert.ok(!attachment.name.includes('\n'))
    assert.ok(Buffer.byteLength(path.basename(attachment.path)) <= 255)
    assert.deepEqual(await fs.readFile(attachment.path), bytes)
    assert.equal(await git(projectPath, 'status', '--short'), '')
  } finally {
    await cleanup()
  }
})

test('writeAttachments rejects an invalid batch before writing any files', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: false })
  try {
    assert.throws(
      () => writeAttachments(projectPath, [
        { name: 'valid.txt', mime: 'text/plain', dataBase64: 'dmFsaWQ=' },
        { name: 'invalid.txt', mime: 'text/plain', dataBase64: '@@@=' },
      ]),
      /附件格式無效/
    )
    await assert.rejects(fs.access(path.join(projectPath, ATTACHMENTS_DIR)))
  } finally {
    await cleanup()
  }
})

test('fileToAttachmentInput reads bytes off disk and names a mime the CLI can pass on', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: false })
  try {
    const bytes = Buffer.from([137, 80, 78, 71, 0, 255])
    const source = path.join(projectPath, 'shot.PNG')
    await fs.writeFile(source, bytes)

    const input = fileToAttachmentInput(source)
    assert.equal(input.name, 'shot.PNG')
    assert.equal(input.mime, 'image/png')
    assert.deepEqual(Buffer.from(input.dataBase64, 'base64'), bytes)

    // The pair round-trips: what the CLI reads is what the worktree receives.
    const [written] = writeAttachments(projectPath, [input])
    assert.deepEqual(await fs.readFile(written.path), bytes)
  } finally {
    await cleanup()
  }
})

test('fileToAttachmentInput falls back to octet-stream for unknown extensions', async () => {
  const { projectPath, cleanup } = await makeRepo({ withRemote: false })
  try {
    const source = path.join(projectPath, 'dump.weird')
    await fs.writeFile(source, 'x')
    assert.equal(fileToAttachmentInput(source).mime, 'application/octet-stream')
    assert.throws(() => fileToAttachmentInput(path.join(projectPath, 'nope.txt')), /ENOENT/)
  } finally {
    await cleanup()
  }
})
