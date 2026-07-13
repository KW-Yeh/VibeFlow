import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import {
  readProgressFile,
  watchProgress,
  unwatchProgress,
  agentProgressPath,
  agentReviewPath,
  deleteAgentFiles,
  PROGRESS_FILE,
  REVIEW_FILE,
} from '../main/helpers/progress.ts'

async function tmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'vf-progress-'))
}

async function writeProgress(dir, raw) {
  await fs.writeFile(path.join(dir, PROGRESS_FILE), raw, 'utf8')
}

test('readProgressFile — parses a valid file', async () => {
  const dir = await tmpDir()
  try {
    await writeProgress(
      dir,
      JSON.stringify({
        summary: 'half done',
        steps: [
          { text: 'a', done: true },
          { text: 'b', done: false },
        ],
      })
    )
    const p = readProgressFile(path.join(dir, PROGRESS_FILE))
    assert.ok(p)
    assert.equal(p.summary, 'half done')
    assert.deepEqual(p.steps, [
      { text: 'a', done: true },
      { text: 'b', done: false },
    ])
    assert.equal(typeof p.updatedAt, 'number')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('readProgressFile — null when the file is absent', async () => {
  const dir = await tmpDir()
  try {
    assert.equal(readProgressFile(path.join(dir, PROGRESS_FILE)), null)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('readProgressFile — null on malformed JSON', async () => {
  const dir = await tmpDir()
  try {
    await writeProgress(dir, '{ this is not json')
    assert.equal(readProgressFile(path.join(dir, PROGRESS_FILE)), null)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('readProgressFile — null on non-object / wrong-shaped roots', async () => {
  const dir = await tmpDir()
  try {
    for (const raw of ['123', '"a string"', 'null', 'true', '[]']) {
      await writeProgress(dir, raw)
      assert.equal(readProgressFile(path.join(dir, PROGRESS_FILE)), null, `root ${raw} should be rejected`)
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('readProgressFile — null when steps is missing or not an array', async () => {
  const dir = await tmpDir()
  try {
    await writeProgress(dir, JSON.stringify({ summary: 'x' }))
    assert.equal(readProgressFile(path.join(dir, PROGRESS_FILE)), null)
    await writeProgress(dir, JSON.stringify({ steps: 'nope' }))
    assert.equal(readProgressFile(path.join(dir, PROGRESS_FILE)), null)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('readProgressFile — null when any step is malformed', async () => {
  const dir = await tmpDir()
  try {
    await writeProgress(
      dir,
      JSON.stringify({ steps: [{ text: 'ok', done: true }, { done: true }] })
    )
    assert.equal(readProgressFile(path.join(dir, PROGRESS_FILE)), null, 'a step without text invalidates all')
    await writeProgress(dir, JSON.stringify({ steps: [{ text: 42 }] }))
    assert.equal(readProgressFile(path.join(dir, PROGRESS_FILE)), null, 'non-string text is rejected')
    await writeProgress(dir, JSON.stringify({ steps: [null] }))
    assert.equal(readProgressFile(path.join(dir, PROGRESS_FILE)), null, 'a null step is rejected')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('readProgressFile — coerces done to a strict boolean', async () => {
  const dir = await tmpDir()
  try {
    await writeProgress(
      dir,
      JSON.stringify({
        steps: [
          { text: 'truthy-but-not-true', done: 1 },
          { text: 'missing-done' },
          { text: 'explicit-true', done: true },
        ],
      })
    )
    const p = readProgressFile(path.join(dir, PROGRESS_FILE))
    assert.equal(p.steps[0].done, false, 'done:1 is not boolean true')
    assert.equal(p.steps[1].done, false, 'absent done defaults to false')
    assert.equal(p.steps[2].done, true)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('readProgressFile — drops a non-string summary', async () => {
  const dir = await tmpDir()
  try {
    await writeProgress(
      dir,
      JSON.stringify({ summary: 123, steps: [{ text: 'a', done: false }] })
    )
    const p = readProgressFile(path.join(dir, PROGRESS_FILE))
    assert.equal(p.summary, undefined)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('readProgressFile — review absent when the field is missing', async () => {
  const dir = await tmpDir()
  try {
    await writeProgress(
      dir,
      JSON.stringify({ steps: [{ text: 'a', done: true }] })
    )
    const p = readProgressFile(path.join(dir, PROGRESS_FILE))
    assert.equal(p.review, undefined)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('readProgressFile — parses an approve verdict', async () => {
  const dir = await tmpDir()
  try {
    await writeProgress(
      dir,
      JSON.stringify({
        steps: [{ text: 'a', done: true }],
        review: { verdict: 'approve', summary: 'looks good', comments: [] },
      })
    )
    const p = readProgressFile(path.join(dir, PROGRESS_FILE))
    assert.deepEqual(p.review, {
      verdict: 'approve',
      summary: 'looks good',
      comments: [],
    })
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('readProgressFile — parses request_changes and keeps only string comments', async () => {
  const dir = await tmpDir()
  try {
    await writeProgress(
      dir,
      JSON.stringify({
        steps: [{ text: 'a', done: true }],
        review: {
          verdict: 'request_changes',
          comments: ['fix the off-by-one', 42, null, 'handle null input'],
        },
      })
    )
    const p = readProgressFile(path.join(dir, PROGRESS_FILE))
    assert.equal(p.review.verdict, 'request_changes')
    assert.deepEqual(p.review.comments, ['fix the off-by-one', 'handle null input'])
    assert.equal(p.review.summary, undefined)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('readProgressFile — drops review with an unknown verdict', async () => {
  const dir = await tmpDir()
  try {
    for (const review of [
      { verdict: 'maybe', comments: [] },
      { comments: ['x'] },
      'not-an-object',
      42,
    ]) {
      await writeProgress(
        dir,
        JSON.stringify({ steps: [{ text: 'a', done: true }], review })
      )
      const p = readProgressFile(path.join(dir, PROGRESS_FILE))
      assert.equal(p.review, undefined, `review ${JSON.stringify(review)} should be dropped`)
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('readProgressFile — defaults comments to [] when not an array', async () => {
  const dir = await tmpDir()
  try {
    await writeProgress(
      dir,
      JSON.stringify({
        steps: [{ text: 'a', done: true }],
        review: { verdict: 'approve', comments: 'oops' },
      })
    )
    const p = readProgressFile(path.join(dir, PROGRESS_FILE))
    assert.deepEqual(p.review.comments, [])
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('agentProgressPath / agentReviewPath — compose <baseDir>/<workspace><suffix>', () => {
  const base = '/Users/x/Library/Application Support/VibeFlow'
  const wt = '/Users/x/Desktop/proj-workspace/feature-WR-5105'
  assert.equal(
    agentProgressPath(base, wt),
    path.join(base, `feature-WR-5105${PROGRESS_FILE}`)
  )
  assert.equal(
    agentReviewPath(base, wt),
    path.join(base, `feature-WR-5105${REVIEW_FILE}`)
  )
})

test('deleteAgentFiles — removes both files and is a no-op when absent', async () => {
  const base = await tmpDir()
  const wt = '/anywhere/feature-xyz'
  try {
    await fs.writeFile(agentProgressPath(base, wt), '{}', 'utf8')
    await fs.writeFile(agentReviewPath(base, wt), '{}', 'utf8')
    deleteAgentFiles(base, wt)
    assert.equal(readProgressFile(agentProgressPath(base, wt)), null, 'progress removed')
    // Second call on already-absent files must not throw.
    deleteAgentFiles(base, wt)
  } finally {
    await fs.rm(base, { recursive: true, force: true })
  }
})

test('watchProgress — emits pre-existing content immediately', async () => {
  const dir = await tmpDir()
  try {
    await writeProgress(
      dir,
      JSON.stringify({ summary: 'first', steps: [{ text: 'a', done: false }] })
    )
    const calls = []
    watchProgress('task-1', path.join(dir, PROGRESS_FILE), (p) => calls.push(p))
    // watchProgress runs an immediate synchronous sync() for existing content.
    assert.equal(calls.length, 1)
    assert.equal(calls[0].summary, 'first')
    unwatchProgress('task-1')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('watchProgress — final sync on unwatch flushes a late change', async () => {
  const dir = await tmpDir()
  try {
    await writeProgress(
      dir,
      JSON.stringify({ summary: 'first', steps: [{ text: 'a', done: false }] })
    )
    const calls = []
    watchProgress('task-2', path.join(dir, PROGRESS_FILE), (p) => calls.push(p))
    assert.equal(calls.length, 1)

    // Change landing between polls: unwatch runs one final sync to capture it.
    await writeProgress(
      dir,
      JSON.stringify({ summary: 'second', steps: [{ text: 'a', done: true }] })
    )
    unwatchProgress('task-2')
    assert.equal(calls.length, 2)
    assert.equal(calls[1].summary, 'second')
    assert.equal(calls[1].steps[0].done, true)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('watchProgress — ignores a malformed write (no spurious emit)', async () => {
  const dir = await tmpDir()
  try {
    await writeProgress(
      dir,
      JSON.stringify({ summary: 'valid', steps: [{ text: 'a', done: false }] })
    )
    const calls = []
    watchProgress('task-3', path.join(dir, PROGRESS_FILE), (p) => calls.push(p))
    assert.equal(calls.length, 1)

    await writeProgress(dir, '{ broken json')
    unwatchProgress('task-3') // final sync reads null → must not emit
    assert.equal(calls.length, 1)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})
