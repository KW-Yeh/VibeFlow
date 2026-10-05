import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import {
  decisionsKey,
  decisionsPath,
  deleteDecisions,
} from '../packages/core/src/decisions.ts'

async function tmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'vf-decisions-'))
}

// --- decisionsKey ---

test('decisionsKey — uses the worktree folder while the worktree exists', () => {
  assert.equal(decisionsKey('/ws/project/vf-abc123', 'vf-abc123'), 'vf-abc123')
})

test('decisionsKey — a completed task falls back to its branch', () => {
  assert.equal(decisionsKey(undefined, 'fix/login-flow'), 'fix-login-flow')
})

test('decisionsKey — both inputs agree for a slashed branch', () => {
  assert.equal(
    decisionsKey('/ws/project/fix-login-flow', 'fix/login-flow'),
    decisionsKey(undefined, 'fix/login-flow')
  )
})

// --- deleteDecisions (legacy cleanup) ---

test('deleteDecisions — removes a legacy record, and tolerates its absence', async () => {
  const dir = await tmpDir()
  const file = decisionsPath(dir, 'vf-abc123')
  assert.equal(file, path.join(dir, 'vf-abc123.DECISIONS.md'))
  await fs.writeFile(file, '## 決策')
  deleteDecisions(dir, 'vf-abc123')
  await assert.rejects(fs.stat(file))
  deleteDecisions(dir, 'vf-abc123')
})
