import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { generateCommitMessage } from '../packages/core/src/git.ts'
import { git, makeRepo, writeFile } from './support/repo.mjs'

const isWindows = process.platform === 'win32'
const MESSAGE = '[What] Add model flag\n\n[Why] Keep the commit message run cheap\n\n[How]\n- Pass --model haiku'

let dir

/**
 * A stand-in agent CLI that records the argv and stdin it was started with, then
 * prints a valid commit message. Lives in `dir`, which is put first on PATH so
 * `generateCommitMessage` finds it instead of a real `claude` or `codex`.
 */
function fakeScript(name) {
  return `
const fs = require('fs')
const path = require('path')
let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (c) => (input += c))
process.stdin.on('end', () => {
  fs.writeFileSync(path.join(__dirname, '${name}.json'), JSON.stringify({ args: process.argv.slice(2), input }))
  process.stdout.write(${JSON.stringify(MESSAGE)})
})
`
}

async function installFakeCli(name) {
  const js = path.join(dir, `${name}.js`)
  await fs.writeFile(js, fakeScript(name))
  if (isWindows) {
    await fs.writeFile(path.join(dir, `${name}.cmd`), `@node "%~dp0${name}.js" %*\r\n`)
  } else {
    const bin = path.join(dir, name)
    await fs.writeFile(bin, `#!/bin/sh\nexec node "${js}" "$@"\n`)
    await fs.chmod(bin, 0o755)
  }
}

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-commit-msg-'))
  await installFakeCli('claude')
  await installFakeCli('codex')
  // Must happen before the first agent CLI call: env.ts memoizes the child env.
  const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH'
  process.env[pathKey] = `${dir}${path.delimiter}${process.env[pathKey] ?? ''}`
  // The runner's loader is cwd-relative and cannot resolve from the temp repo.
  delete process.env.NODE_OPTIONS
})

after(async () => {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 10 })
})

/** Commit one change on a feature branch, generate a message with `agentCli`, and return what the fake saw. */
async function generateWith(agentCli) {
  const repo = await makeRepo()
  try {
    await git(repo.projectPath, 'checkout', '-b', 'feature/add-a')
    await writeFile(repo.projectPath, 'src/a.ts', 'export const a = 1\n')
    await git(repo.projectPath, 'add', '-A')
    await git(repo.projectPath, 'commit', '-m', 'Add a')

    const message = await generateCommitMessage(repo.projectPath, 'main', agentCli)
    const seen = JSON.parse(await fs.readFile(path.join(dir, `${agentCli}.json`), 'utf8'))
    return { message, ...seen }
  } finally {
    await repo.cleanup()
  }
}

test('generateCommitMessage — claude runs headless on haiku with the prompt on stdin', async () => {
  const { message, args, input } = await generateWith('claude')
  assert.deepEqual(args, ['-p', '--model', 'haiku'])
  assert.equal(message, MESSAGE)
  assert.match(input, /\[What\]/)
  assert.match(input, /src\/a\.ts/)
  assert.match(input, /Commits on this branch:\n[0-9a-f]+ Add a/)
})

test('generateCommitMessage — codex runs exec on a low-cost model, not the -p profile flag', async () => {
  const { message, args, input } = await generateWith('codex')
  assert.deepEqual(args, ['exec', '--model', 'gpt-5.6-luna', '--sandbox', 'read-only', '-'])
  assert.ok(!args.includes('-p'))
  assert.equal(message, MESSAGE)
  assert.match(input, /\[What\]/)
})
