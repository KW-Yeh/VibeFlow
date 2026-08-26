import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import {
  agentArtifactsPath,
  listArtifacts,
  readArtifact,
  deleteArtifacts,
  ARTIFACTS_DIR_SUFFIX,
  MAX_ARTIFACTS,
  MAX_VIDEO_BYTES,
  SCRATCH_DIR_NAME,
} from '../main/helpers/artifacts.ts'

async function tmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'vf-artifacts-'))
}

/** A tiny but structurally valid PNG (1x1, transparent). */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYGD4DwABBAEAX+I4bwAAAABJRU5ErkJggg==',
  'base64'
)

// --- agentArtifactsPath ---

test('agentArtifactsPath — composes <baseDir>/<worktree-name>.artifacts', () => {
  assert.equal(
    agentArtifactsPath('/ws/proj', '/ws/proj/feature-x'),
    path.join('/ws/proj', `feature-x${ARTIFACTS_DIR_SUFFIX}`)
  )
})

// --- listArtifacts ---

test('listArtifacts — empty for a missing directory', () => {
  assert.deepEqual(listArtifacts('/definitely/not/here'), [])
})

test('listArtifacts — classifies images, text, and binary', async () => {
  const dir = await tmpDir()
  try {
    await fs.writeFile(path.join(dir, 'shot.png'), PNG_BYTES)
    await fs.writeFile(path.join(dir, 'report.md'), '# parity\n', 'utf8')
    // A NUL byte in the head is what marks a file unpreviewable.
    await fs.writeFile(path.join(dir, 'blob.bin'), Buffer.from([1, 2, 0, 3]))

    const byName = Object.fromEntries(listArtifacts(dir).map((a) => [a.name, a]))

    assert.equal(byName['shot.png'].kind, 'image')
    assert.equal(byName['shot.png'].mime, 'image/png')
    assert.equal(byName['shot.png'].size, PNG_BYTES.byteLength)
    assert.equal(typeof byName['shot.png'].modifiedAt, 'number')

    assert.equal(byName['report.md'].kind, 'text')
    assert.equal(byName['report.md'].mime, undefined)

    assert.equal(byName['blob.bin'].kind, 'binary')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('listArtifacts — recurses into subdirectories using slash-joined names', async () => {
  const dir = await tmpDir()
  try {
    await fs.mkdir(path.join(dir, 'shots'), { recursive: true })
    await fs.writeFile(path.join(dir, 'shots', 'home.png'), PNG_BYTES)

    const names = listArtifacts(dir).map((a) => a.name)
    assert.deepEqual(names, ['shots/home.png'])
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('listArtifacts — stops descending past the depth cap', async () => {
  const dir = await tmpDir()
  try {
    // Depth cap is 3, so a file at the 4th level must not be reported.
    const deep = path.join(dir, 'a', 'b', 'c')
    await fs.mkdir(deep, { recursive: true })
    await fs.writeFile(path.join(deep, 'too-deep.txt'), 'x', 'utf8')
    await fs.writeFile(path.join(dir, 'a', 'b', 'ok.txt'), 'x', 'utf8')

    const names = listArtifacts(dir).map((a) => a.name)
    assert.deepEqual(names, ['a/b/ok.txt'])
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('listArtifacts — caps the number of entries', async () => {
  const dir = await tmpDir()
  try {
    await Promise.all(
      Array.from({ length: MAX_ARTIFACTS + 10 }, (_, i) =>
        fs.writeFile(path.join(dir, `f${i}.txt`), 'x', 'utf8')
      )
    )
    assert.equal(listArtifacts(dir).length, MAX_ARTIFACTS)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('listArtifacts — newest first', async () => {
  const dir = await tmpDir()
  try {
    await fs.writeFile(path.join(dir, 'old.txt'), 'x', 'utf8')
    await fs.writeFile(path.join(dir, 'new.txt'), 'x', 'utf8')
    // mtime resolution can tie on fast filesystems — set them explicitly.
    await fs.utimes(path.join(dir, 'old.txt'), new Date(1000), new Date(1000))
    await fs.utimes(path.join(dir, 'new.txt'), new Date(9000), new Date(9000))

    assert.deepEqual(listArtifacts(dir).map((a) => a.name), ['new.txt', 'old.txt'])
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('listArtifacts — flags the scratch subtree and keeps its slash-joined names', async () => {
  const dir = await tmpDir()
  try {
    await fs.mkdir(path.join(dir, SCRATCH_DIR_NAME, 'logs'), { recursive: true })
    await fs.writeFile(path.join(dir, 'shot.png'), PNG_BYTES)
    await fs.writeFile(path.join(dir, SCRATCH_DIR_NAME, 'probe.sh'), 'echo hi\n', 'utf8')
    await fs.writeFile(path.join(dir, SCRATCH_DIR_NAME, 'logs', 'run.log'), 'x\n', 'utf8')

    const byName = Object.fromEntries(listArtifacts(dir).map((a) => [a.name, a]))

    assert.equal(byName['shot.png'].scratch, false)
    assert.equal(byName[`${SCRATCH_DIR_NAME}/probe.sh`].scratch, true)
    assert.equal(byName[`${SCRATCH_DIR_NAME}/logs/run.log`].scratch, true)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('listArtifacts — scratch files never crowd user-facing ones out of the cap', async () => {
  const dir = await tmpDir()
  try {
    await fs.mkdir(path.join(dir, SCRATCH_DIR_NAME), { recursive: true })
    await Promise.all(
      Array.from({ length: MAX_ARTIFACTS }, (_, i) =>
        fs.writeFile(path.join(dir, SCRATCH_DIR_NAME, `tmp${i}.sh`), 'x', 'utf8')
      )
    )
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        fs.writeFile(path.join(dir, `shot${i}.png`), PNG_BYTES)
      )
    )

    const listed = listArtifacts(dir)
    assert.equal(listed.length, MAX_ARTIFACTS)
    const shots = listed.filter((a) => !a.scratch).map((a) => a.name).sort()
    assert.deepEqual(shots, ['shot0.png', 'shot1.png', 'shot2.png', 'shot3.png', 'shot4.png'])
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('listArtifacts — scratch files sort after user-facing ones regardless of mtime', async () => {
  const dir = await tmpDir()
  try {
    await fs.mkdir(path.join(dir, SCRATCH_DIR_NAME), { recursive: true })
    await fs.writeFile(path.join(dir, 'report.md'), 'x', 'utf8')
    await fs.writeFile(path.join(dir, SCRATCH_DIR_NAME, 'fresh.log'), 'x', 'utf8')
    await fs.utimes(path.join(dir, 'report.md'), new Date(1000), new Date(1000))
    await fs.utimes(path.join(dir, SCRATCH_DIR_NAME, 'fresh.log'), new Date(9000), new Date(9000))

    assert.deepEqual(
      listArtifacts(dir).map((a) => a.name),
      ['report.md', `${SCRATCH_DIR_NAME}/fresh.log`]
    )
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('listArtifacts — skips symlinks', async () => {
  const dir = await tmpDir()
  try {
    const outside = path.join(dir, '..', `outside-${path.basename(dir)}.txt`)
    await fs.writeFile(outside, 'secret', 'utf8')
    await fs.mkdir(path.join(dir, 'inner'), { recursive: true })
    await fs.symlink(outside, path.join(dir, 'inner', 'link.txt'))

    assert.deepEqual(listArtifacts(dir), [])
    await fs.rm(outside, { force: true })
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('listArtifacts — classifies playable video extensions with their mime', async () => {
  const dir = await tmpDir()
  try {
    // Content is irrelevant: video is decided by extension, never by sniffing.
    for (const name of ['clip.mp4', 'clip.m4v', 'clip.webm', 'clip.MOV', 'clip.mkv']) {
      await fs.writeFile(path.join(dir, name), Buffer.from([0, 1, 2]))
    }

    const byName = Object.fromEntries(listArtifacts(dir).map((a) => [a.name, a]))

    assert.equal(byName['clip.mp4'].kind, 'video')
    assert.equal(byName['clip.mp4'].mime, 'video/mp4')
    assert.equal(byName['clip.m4v'].mime, 'video/mp4')
    assert.equal(byName['clip.webm'].mime, 'video/webm')
    // Extension match is case-insensitive. .mov is labelled video/mp4 on
    // purpose — Chromium's canPlayType rejects video/quicktime.
    assert.equal(byName['clip.MOV'].kind, 'video')
    assert.equal(byName['clip.MOV'].mime, 'video/mp4')
    // Chromium cannot demux .mkv, so it stays an unpreviewable binary.
    assert.equal(byName['clip.mkv'].kind, 'binary')
    assert.equal(byName['clip.mkv'].mime, undefined)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('listArtifacts — a video past the inline cap is demoted to binary', async () => {
  const dir = await tmpDir()
  try {
    // Sparse file: the size is what matters, writing 20MB of bytes is not.
    const handle = await fs.open(path.join(dir, 'huge.mp4'), 'w')
    await handle.truncate(MAX_VIDEO_BYTES + 1)
    await handle.close()

    const [artifact] = listArtifacts(dir)
    assert.equal(artifact.name, 'huge.mp4')
    assert.equal(artifact.kind, 'binary')
    assert.equal(artifact.mime, undefined)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

// --- readArtifact ---

test('readArtifact — image comes back as a data URL', async () => {
  const dir = await tmpDir()
  try {
    await fs.writeFile(path.join(dir, 'shot.png'), PNG_BYTES)
    const content = readArtifact(dir, 'shot.png')
    assert.equal(content.kind, 'image')
    assert.equal(
      content.dataUrl,
      `data:image/png;base64,${PNG_BYTES.toString('base64')}`
    )
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('readArtifact — video comes back as a data URL', async () => {
  const dir = await tmpDir()
  try {
    const bytes = Buffer.from([0, 1, 2, 3])
    await fs.writeFile(path.join(dir, 'clip.webm'), bytes)
    const content = readArtifact(dir, 'clip.webm')
    assert.equal(content.kind, 'video')
    assert.equal(content.dataUrl, `data:video/webm;base64,${bytes.toString('base64')}`)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('readArtifact — a video past the inline cap reports binary, no bytes', async () => {
  const dir = await tmpDir()
  try {
    const handle = await fs.open(path.join(dir, 'huge.mp4'), 'w')
    await handle.truncate(MAX_VIDEO_BYTES + 1)
    await handle.close()

    const content = readArtifact(dir, 'huge.mp4')
    assert.equal(content.kind, 'binary')
    assert.equal(content.dataUrl, undefined)
    assert.equal(content.text, undefined)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('readArtifact — text comes back verbatim and untruncated', async () => {
  const dir = await tmpDir()
  try {
    await fs.writeFile(path.join(dir, 'log.txt'), 'hello\nworld\n', 'utf8')
    const content = readArtifact(dir, 'log.txt')
    assert.equal(content.kind, 'text')
    assert.equal(content.text, 'hello\nworld\n')
    assert.equal(content.truncated, false)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('readArtifact — oversized text is truncated and flagged', async () => {
  const dir = await tmpDir()
  try {
    await fs.writeFile(path.join(dir, 'big.log'), 'x'.repeat(256 * 1024 + 10), 'utf8')
    const content = readArtifact(dir, 'big.log')
    assert.equal(content.kind, 'text')
    assert.equal(content.truncated, true)
    assert.equal(content.text.length, 256 * 1024)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('readArtifact — binary reports kind only, no content', async () => {
  const dir = await tmpDir()
  try {
    await fs.writeFile(path.join(dir, 'blob.bin'), Buffer.from([1, 0, 2]))
    const content = readArtifact(dir, 'blob.bin')
    assert.equal(content.kind, 'binary')
    assert.equal(content.text, undefined)
    assert.equal(content.dataUrl, undefined)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('readArtifact — null for a missing file', async () => {
  const dir = await tmpDir()
  try {
    assert.equal(readArtifact(dir, 'nope.txt'), null)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('readArtifact — refuses to escape the artifacts directory', async () => {
  const dir = await tmpDir()
  try {
    const outside = path.join(dir, '..', `escape-${path.basename(dir)}.txt`)
    await fs.writeFile(outside, 'secret', 'utf8')
    const escapes = [
      `../${path.basename(outside)}`,
      `../../${path.basename(path.dirname(outside))}/${path.basename(outside)}`,
      '/etc/hosts',
    ]
    for (const name of escapes) {
      assert.equal(readArtifact(dir, name), null, `must refuse ${name}`)
    }
    await fs.rm(outside, { force: true })
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('readArtifact — refuses a symlink pointing outside the directory', async () => {
  const dir = await tmpDir()
  try {
    const outside = path.join(dir, '..', `linked-${path.basename(dir)}.txt`)
    await fs.writeFile(outside, 'secret', 'utf8')
    await fs.symlink(outside, path.join(dir, 'link.txt'))

    assert.equal(readArtifact(dir, 'link.txt'), null)
    await fs.rm(outside, { force: true })
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

// --- deleteArtifacts ---

test('deleteArtifacts — removes the directory and is a no-op when absent', async () => {
  const base = await tmpDir()
  try {
    const worktree = path.join(base, 'feature-x')
    const artifactsDir = agentArtifactsPath(base, worktree)
    await fs.mkdir(path.join(artifactsDir, 'nested'), { recursive: true })
    await fs.writeFile(path.join(artifactsDir, 'nested', 'shot.png'), PNG_BYTES)

    deleteArtifacts(base, worktree)
    assert.equal(listArtifacts(artifactsDir).length, 0)
    await assert.rejects(() => fs.stat(artifactsDir))

    // Second call must not throw.
    deleteArtifacts(base, worktree)
  } finally {
    await fs.rm(base, { recursive: true, force: true })
  }
})
