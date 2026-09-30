import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { acquireLock, liveHost, lockPath, readLock, releaseLock, updateLock } from '../packages/core/src/lock.ts'

function dir(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-lock-'))
  t.after(() => fs.rmSync(d, { recursive: true, force: true }))
  return d
}

const info = (pid, port = 0) => ({ pid, port, token: 't0k3n', version: '1.0.0', startedAt: 1 })

test('the first process becomes the host; a live holder keeps the lock', (t) => {
  const d = dir(t)
  assert.deepEqual(acquireLock(d, info(process.pid)), { acquired: true })
  // Another process (its parent is certainly alive) is told who holds it.
  const other = acquireLock(d, info(process.ppid))
  assert.equal(other.acquired, false)
  assert.equal(other.holder.pid, process.pid)
})

test('a lock left by a dead process is taken over', (t) => {
  const d = dir(t)
  fs.writeFileSync(lockPath(d), JSON.stringify(info(2 ** 22 + 12345, 4000)))
  assert.equal(liveHost(d), null)
  assert.deepEqual(acquireLock(d, info(process.pid)), { acquired: true })
  assert.equal(readLock(d).pid, process.pid)
})

test('the port is recorded once listening, and release removes only our own lock', (t) => {
  const d = dir(t)
  acquireLock(d, info(process.pid))
  updateLock(d, info(process.pid, 5555))
  assert.equal(liveHost(d).port, 5555)
  releaseLock(d)
  assert.equal(fs.existsSync(lockPath(d)), false)

  fs.writeFileSync(lockPath(d), JSON.stringify(info(process.ppid, 1)))
  releaseLock(d)
  assert.equal(fs.existsSync(lockPath(d)), true, 'another process holds it')
})

test('the lock file is private to the user (POSIX)', { skip: process.platform === 'win32' }, (t) => {
  const d = dir(t)
  acquireLock(d, info(process.pid))
  assert.equal(fs.statSync(lockPath(d)).mode & 0o777, 0o600)
  updateLock(d, info(process.pid, 1))
  assert.equal(fs.statSync(lockPath(d)).mode & 0o777, 0o600)
})
