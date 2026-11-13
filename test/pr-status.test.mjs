import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// A `gh` that records its pid and then hangs, to see what becomes of a lookup that runs out of time.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-pr-status-'))
const pidFile = path.join(dir, 'gh.pid')
const skip = process.platform === 'win32' && 'a shell script cannot stand in for gh.exe'
if (!skip) {
  fs.writeFileSync(path.join(dir, 'gh'), '#!/bin/sh\necho $$ > "$VF_FAKE_GH_PID"\nexec sleep 30\n', { mode: 0o755 })
  process.env.PATH = `${dir}${path.delimiter}${process.env.PATH}`
  process.env.VF_FAKE_GH_PID = pidFile
}
// Imported once PATH is set: core memoizes the child-process env on first use.
const { getPrStatus } = await import('../packages/core/src/git.ts')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test('a PR lookup that runs out of time is stopped, not left running in the worktree', { skip }, async (t) => {
  let pid
  t.after(() => {
    if (pid && alive(pid)) process.kill(pid)
    fs.rmSync(dir, { recursive: true, force: true })
  })
  const startedAt = Date.now()
  const lookup = getPrStatus(dir, 1500)
  // The lookup only proves anything once the fake gh is really running.
  for (let attempt = 0; !pid && attempt < 150; attempt++) {
    await sleep(20)
    try {
      pid = Number(fs.readFileSync(pidFile, 'utf8').trim()) || undefined
    } catch {
      // not written yet
    }
  }
  assert.ok(pid, 'the fake gh started')
  assert.equal(await lookup, null)
  assert.ok(Date.now() - startedAt < 10_000, 'it gave up long before the hanging gh would have')

  for (let attempt = 0; alive(pid) && attempt < 100; attempt++) await sleep(50)
  assert.equal(alive(pid), false, 'the hanging gh was killed')
})
