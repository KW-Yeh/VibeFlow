import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ensurePtySpawnHelper } from '../packages/core/src/pty-helper.ts'

const posix = process.platform !== 'win32'

function fakeNodePty(mode) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-node-pty-'))
  const dir = path.join(root, 'prebuilds', `${process.platform}-${process.arch}`)
  fs.mkdirSync(dir, { recursive: true })
  const helper = path.join(dir, 'spawn-helper')
  fs.writeFileSync(helper, '')
  fs.chmodSync(helper, mode)
  return { root, helper }
}

test('a prebuilt spawn-helper without the executable bit is made executable', { skip: !posix && 'POSIX file modes' }, (t) => {
  const { root, helper } = fakeNodePty(0o644)
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  assert.deepEqual(ensurePtySpawnHelper(root), [])
  assert.equal(fs.statSync(helper).mode & 0o777, 0o755)
})

test('an executable helper and a missing build dir are left alone', { skip: !posix && 'POSIX file modes' }, (t) => {
  const { root, helper } = fakeNodePty(0o750)
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  assert.deepEqual(ensurePtySpawnHelper(root), [])
  assert.equal(fs.statSync(helper).mode & 0o777, 0o750)
})
