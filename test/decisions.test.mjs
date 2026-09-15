import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import {
  DECISIONS_FILE_SUFFIX,
  decisionsKey,
  decisionsPath,
  deleteDecisions,
  readDecisions,
} from '../main/helpers/decisions.ts'

async function tmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'vf-decisions-'))
}

// --- decisionsKey ---

test('decisionsKey — uses the worktree folder while the worktree exists', () => {
  assert.equal(decisionsKey('/ws/project/vf-abc123', 'vf-abc123'), 'vf-abc123')
})

test('decisionsKey — a completed task falls back to its branch', () => {
  // Completing a card clears worktreePath, but the record has to stay readable,
  // so the fallback must reproduce git.ts worktreeDirName exactly.
  assert.equal(decisionsKey(undefined, 'fix/login-flow'), 'fix-login-flow')
})

test('decisionsKey — both inputs agree for a slashed branch', () => {
  assert.equal(
    decisionsKey('/ws/project/fix-login-flow', 'fix/login-flow'),
    decisionsKey(undefined, 'fix/login-flow')
  )
})

// --- decisionsPath ---

test('decisionsPath — composes <workspace>/<key>.DECISIONS.md', () => {
  assert.equal(
    decisionsPath('/ws/project', 'vf-abc123'),
    path.join('/ws/project', `vf-abc123${DECISIONS_FILE_SUFFIX}`)
  )
})

// --- readDecisions ---

test('readDecisions — reports the path even when the agent wrote nothing', async () => {
  const dir = await tmpDir()
  const result = readDecisions(dir, 'vf-abc123')
  assert.equal(result.markdown, null)
  assert.equal(result.updatedAt, undefined)
  // The empty state tells the user where the record will appear, so the path
  // has to survive the miss.
  assert.equal(result.path, decisionsPath(dir, 'vf-abc123'))
})

test('readDecisions — returns the record and its mtime', async () => {
  const dir = await tmpDir()
  await fs.writeFile(decisionsPath(dir, 'vf-abc123'), '## 用 sqlite\n\n理由。\n')
  const result = readDecisions(dir, 'vf-abc123')
  assert.match(result.markdown, /## 用 sqlite/)
  assert.ok(result.updatedAt > 0)
  assert.equal(result.truncated, undefined)
})

test('readDecisions — a directory in the record’s place reads as absent', async () => {
  const dir = await tmpDir()
  await fs.mkdir(decisionsPath(dir, 'vf-abc123'))
  assert.equal(readDecisions(dir, 'vf-abc123').markdown, null)
})

test('readDecisions — an oversized record is cut and flagged', async () => {
  const dir = await tmpDir()
  await fs.writeFile(decisionsPath(dir, 'vf-abc123'), 'x'.repeat(300 * 1024))
  const result = readDecisions(dir, 'vf-abc123')
  assert.equal(result.truncated, true)
  assert.equal(result.markdown.length, 256 * 1024)
})

// --- deleteDecisions ---

test('deleteDecisions — removes the record, and tolerates its absence', async () => {
  const dir = await tmpDir()
  const file = decisionsPath(dir, 'vf-abc123')
  await fs.writeFile(file, '## 決策')
  deleteDecisions(dir, 'vf-abc123')
  assert.equal(readDecisions(dir, 'vf-abc123').markdown, null)
  deleteDecisions(dir, 'vf-abc123')
})
