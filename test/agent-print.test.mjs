import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { runAgentPrint } from '../main/helpers/agent-print.ts'

const isWindows = process.platform === 'win32'

/**
 * A stand-in agent CLI on its own PATH dir that echoes its args and stdin. On
 * Windows it is a `.cmd` shim — the shape npm installs claude/codex as, which
 * execFile cannot start.
 */
async function makeFakeAgent(name, script) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-agent-'))
  const js = path.join(dir, `${name}.js`)
  await fs.writeFile(js, script)
  if (isWindows) {
    await fs.writeFile(path.join(dir, `${name}.cmd`), `@node "%~dp0${name}.js" %*\r\n`)
  } else {
    const bin = path.join(dir, name)
    await fs.writeFile(bin, `#!/bin/sh\nexec node "${js}" "$@"\n`)
    await fs.chmod(bin, 0o755)
  }
  const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH'
  const env = { ...process.env, [pathKey]: `${dir}${path.delimiter}${process.env[pathKey] ?? ''}` }
  // The runner's NODE_OPTIONS imports the TS loader by a cwd-relative path,
  // which the fake agent (running in `dir`) cannot resolve.
  delete env.NODE_OPTIONS
  return { dir, env }
}

const ECHO = `
let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (c) => (input += c))
process.stdin.on('end', () => process.stdout.write(JSON.stringify({ args: process.argv.slice(2), input })))
`

test('runAgentPrint — starts a CLI found on PATH and passes the prompt on stdin', async () => {
  const { dir, env } = await makeFakeAgent('fake-agent', ECHO)
  // Everything cmd.exe would mangle as an argument: newlines, both quotes, % and &.
  const prompt = `line one\nit's "quoted" & 100% | <safe>\n任務標題：測試`
  const out = await runAgentPrint('fake-agent', ['-p', '--model', 'haiku'], prompt, { cwd: dir, env })
  assert.deepEqual(JSON.parse(out), { args: ['-p', '--model', 'haiku'], input: prompt })
})

test('runAgentPrint — a failing CLI rejects with its exit code and stderr', async () => {
  const { dir, env } = await makeFakeAgent(
    'failing-agent',
    `process.stderr.write('not logged in'); process.exit(3)`
  )
  await assert.rejects(
    runAgentPrint('failing-agent', ['-p'], 'hi', { cwd: dir, env }),
    /exited with code 3: not logged in/
  )
})

test('runAgentPrint — a missing CLI rejects instead of hanging', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-agent-'))
  await assert.rejects(runAgentPrint('vf-no-such-agent-cli', ['-p'], 'hi', { cwd: dir }))
})
