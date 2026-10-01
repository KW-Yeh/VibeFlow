import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { EventEmitter } from 'node:events'
import { TmuxBackend, hasTmux, TMUX_SOCKET } from '../packages/core/src/tmux-backend.ts'

/** A fake `tmux` that keeps its own set of sessions, plus fake attach clients. */
function harness(t) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-tmux-'))
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }))
  const sessions = new Set()
  const calls = []
  const clients = []
  const run = async (args) => {
    calls.push(args)
    const cmd = args[4] // -L vibeflow -f <conf> <cmd> …
    const rest = args.slice(5)
    const target = () => rest[rest.indexOf('-t') + 1].replace(/^=/, '')
    if (cmd === 'has-session') return { code: sessions.has(target()) ? 0 : 1, stdout: '' }
    if (cmd === 'new-session') {
      sessions.add(rest[rest.indexOf('-s') + 1])
      return { code: 0, stdout: '' }
    }
    if (cmd === 'kill-session') {
      sessions.delete(target())
      for (const c of clients) if (!c.dead) c.exit()
      return { code: 0, stdout: '' }
    }
    if (cmd === 'list-sessions') return { code: 0, stdout: [...sessions, 'user-own'].join('\n') + '\n' }
    return { code: 0, stdout: '' }
  }
  const attach = (args) => {
    const em = new EventEmitter()
    const client = {
      args,
      pid: 100 + clients.length,
      dead: false,
      onData: (cb) => em.on('data', cb),
      onExit: (cb) => em.on('exit', cb),
      write: () => {},
      resize: () => {},
      kill: () => client.exit(),
      exit: () => {
        if (client.dead) return
        client.dead = true
        em.emit('exit', { exitCode: 0 })
      },
      emitData: (d) => em.emit('data', d),
    }
    clients.push(client)
    return client
  }
  const events = []
  const sink = { send: (channel, payload) => events.push([channel, payload]), isDestroyed: () => false }
  const backend = new TmuxBackend(sink, { stateDir, run, attach })
  return { backend, sessions, calls, clients, events, stateDir }
}

const flush = () => new Promise((r) => setTimeout(r, 10))

test('a start creates the session on the vibeflow socket, logs it, and attaches', async (t) => {
  const { backend, calls, clients, events } = harness(t)
  await backend.start('abc12345', { cwd: '/w', command: 'claude --resume x', cols: 120, rows: 40 })
  const create = calls.find((c) => c[4] === 'new-session')
  assert.deepEqual(create.slice(0, 2), ['-L', TMUX_SOCKET])
  assert.equal(create[create.indexOf('-s') + 1], 'vf-abc12345')
  assert.equal(create[create.indexOf('-c') + 1], '/w')
  assert.equal(create[create.indexOf('-x') + 1], '120')
  assert.match(create.at(-1), /-lic 'claude --resume x'; code=\$\?; printf %s "\$code" > /)
  assert.ok(calls.some((c) => c[4] === 'pipe-pane' && c.at(-1).includes('vf-abc12345.log')))
  assert.ok(clients[0].args.includes('attach-session'))
  clients[0].emitData('hi')
  assert.deepEqual(events, [['pty:data', { sessionKey: 'abc12345', data: 'hi' }]])
})

test('a start without a command re-attaches to a running session instead of restarting it', async (t) => {
  const { backend, calls } = harness(t)
  await backend.start('abc12345', { cwd: '/w', command: 'agent' })
  const result = await backend.start('abc12345', { cwd: '/w' })
  assert.equal(result.attached, true)
  assert.equal(calls.filter((c) => c[4] === 'new-session').length, 1)
  assert.equal(calls.filter((c) => c[4] === 'kill-session').length, 0)
})

test('the session ending reports its exit status; our own detach reports nothing', async (t) => {
  const { backend, clients, events, sessions, stateDir } = harness(t)
  let ended = 0
  await backend.start('k1', { cwd: '/w', command: 'x', onExit: () => ended++ })
  // Re-attaching closes the first client on purpose: no exit event.
  await backend.start('k1', { cwd: '/w', onExit: () => ended++ })
  await flush()
  assert.equal(events.filter(([c]) => c === 'pty:exit').length, 0)
  // The pane's wrapper writes the status, then the session goes away.
  fs.writeFileSync(path.join(stateDir, 'logs', 'vf-k1.status'), '3')
  sessions.delete('vf-k1')
  clients[1].exit()
  await flush()
  assert.deepEqual(events.at(-1), ['pty:exit', { sessionKey: 'k1', exitCode: 3, intentional: false }])
  assert.equal(ended, 1)
})

test('kill is reported as intentional, and shutdown only detaches', async (t) => {
  const { backend, events, sessions } = harness(t)
  await backend.start('k2', { cwd: '/w', command: 'x' })
  await backend.start('k3', { cwd: '/w', command: 'y' })
  await backend.kill('k2')
  await flush()
  const exit = events.find(([c, p]) => c === 'pty:exit' && p.sessionKey === 'k2')
  assert.equal(exit[1].intentional, true)
  backend.shutdown()
  await flush()
  assert.ok(sessions.has('vf-k3'), 'the agent keeps running after core exits')
  assert.deepEqual(await backend.list(), ['k3'])
})

test('session names are safe for tmux', (t) => {
  const { backend } = harness(t)
  assert.equal(backend.sessionName('abc12345:tab.2'), 'vf-abc12345_tab_2')
})

test('against a real tmux: the session outlives the backend', { skip: !hasTmux() && 'tmux not installed' }, async (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-tmux-real-'))
  const sink = { send() {}, isDestroyed: () => false }
  const key = `test${process.pid}`
  const first = new TmuxBackend(sink, { stateDir })
  t.after(async () => {
    await new TmuxBackend(sink, { stateDir }).kill(key)
    fs.rmSync(stateDir, { recursive: true, force: true })
  })
  await first.start(key, { cwd: os.tmpdir(), command: 'echo vf-real; sleep 30' })
  first.shutdown()
  const second = new TmuxBackend(sink, { stateDir })
  assert.equal(await second.isAlive(key), true)
  assert.ok((await second.list()).includes(key))
  await second.kill(key)
  assert.equal(await second.isAlive(key), false)
})
