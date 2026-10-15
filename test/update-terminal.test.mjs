import test from 'node:test'
import assert from 'node:assert/strict'
import { openUpdateTerminal, updateTerminalCommands } from '../packages/cli/src/update-terminal.ts'

test('update terminal commands use the requested privilege level on each platform', () => {
  const windows = updateTerminalCommands('win32')
  const mac = updateTerminalCommands('darwin')
  const linux = updateTerminalCommands('linux')
  assert.match(windows[0].args.join(' '), /vibeflow update/)
  assert.doesNotMatch(windows[0].args.join(' '), /sudo/)
  assert.match(mac[0].args.join(' '), /sudo vibeflow update/)
  assert.ok(linux.length > 1)
  for (const command of linux) assert.match(command.args.join(' '), /sudo vibeflow update/)
})

test('a launch failure reaches the caller', async () => {
  const tried = []
  await openUpdateTerminal('darwin', async (command) => { tried.push(command.cmd) })
  assert.deepEqual(tried, ['osascript'])
  await assert.rejects(
    openUpdateTerminal('darwin', async () => { throw new Error('permission denied') }),
    /permission denied/
  )
})

test('Linux tries another terminal only when an executable is missing', async () => {
  const previous = process.env.DISPLAY
  process.env.DISPLAY = ':test'
  try {
    const tried = []
    await openUpdateTerminal('linux', async (command) => {
      tried.push(command.cmd)
      if (tried.length === 1) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    })
    assert.deepEqual(tried, ['gnome-terminal', 'x-terminal-emulator'])
  } finally {
    if (previous === undefined) delete process.env.DISPLAY
    else process.env.DISPLAY = previous
  }
})
