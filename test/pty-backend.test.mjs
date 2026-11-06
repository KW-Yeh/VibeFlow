import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PtyBackend } from '../packages/core/src/pty.ts'
import { findGitBash } from '../packages/core/src/git-bash.ts'

// Echoes through the program, not the tty, so `got:` proves this agent still runs.
const AGENT = `echo ready; while read line; do [ "$line" = quit ] && exit 0; echo "got:$line $(stty size)"; done`

async function until(check, what) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.fail(`timed out waiting for ${what}`)
}

// A killed session on Windows holds its folder until the process is gone.
const removeFolder = (folder) => fs.rm(folder, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })

async function setup(t) {
  // Keeps the user's shell rc files, and whatever they print, out of the test.
  const shell = process.env.SHELL
  process.env.SHELL = '/bin/sh'
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-pty-'))
  let output = ''
  const exits = []
  const backend = new PtyBackend({
    isDestroyed: () => false,
    send(channel, payload) {
      if (channel === 'pty:data') output += payload.data
      if (channel === 'pty:exit') exits.push(payload)
    },
  })
  t.after(async () => {
    backend.shutdown()
    if (shell === undefined) delete process.env.SHELL
    else process.env.SHELL = shell
    await removeFolder(cwd)
  })
  return { backend, cwd, exits, output: () => output, clear: () => { output = '' } }
}

const skip = process.platform === 'win32' && !findGitBash() && 'Git Bash not installed'

test('opening a running session again joins it instead of replacing it', { skip }, async (t) => {
  const { backend, cwd, exits, output } = await setup(t)
  const first = await backend.start('card', { cwd, command: AGENT })
  await until(() => output().includes('ready'), 'the agent to start')

  let joinedExits = 0
  const joined = await backend.start('card', { cwd, cols: 100, rows: 30, onExit: () => { joinedExits += 1 } })
  assert.equal(joined.attached, true)
  assert.equal(joined.pid, first.pid)
  assert.match(joined.scrollback ?? '', /ready/)

  backend.write('card', 'ping\n')
  await until(() => output().includes('got:ping 30 100'), 'the original agent to answer at the new size')
  assert.deepEqual(exits, [])

  backend.write('card', 'quit\n')
  await until(() => joinedExits === 1, 'the joining frontend to hear the session end')
  assert.equal(exits[0].intentional, false)
})

test('a fresh start, a new command or another folder still replaces the session', { skip }, async (t) => {
  const { backend, cwd, exits, output, clear } = await setup(t)
  const elsewhere = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-pty-other-'))
  t.after(() => removeFolder(elsewhere))

  const replacements = [
    ['fresh', { cwd, fresh: true }],
    ['command', { cwd, command: AGENT }],
    ['cwd', { cwd: elsewhere }],
  ]
  for (const [name, options] of replacements) {
    clear()
    const before = exits.length
    const first = await backend.start(name, { cwd, command: AGENT })
    await until(() => output().includes('ready'), `the ${name} agent to start`)
    const second = await backend.start(name, options)
    assert.notEqual(second.attached, true, name)
    assert.notEqual(second.pid, first.pid, name)
    await until(() => exits.length > before, `the ${name} agent to end`)
    assert.equal(exits.at(-1).intentional, true, name)
    await backend.kill(name)
    await until(() => exits.length > before + 1, `the ${name} replacement to end`)
  }
})

test('a session that already ended is started again', { skip }, async (t) => {
  const { backend, cwd, exits } = await setup(t)
  await backend.start('card', { cwd, command: 'exit 0' })
  await until(() => exits.length === 1, 'the command to end')
  const next = await backend.start('card', { cwd })
  assert.notEqual(next.attached, true)
  assert.equal(await backend.isAlive('card'), true)
})
