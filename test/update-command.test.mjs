import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runUpdate } from '../packages/cli/src/update-command.ts'

function fixture(t, name = '@kw-yeh/vibeflow') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-update-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const globalRoot = path.join(root, 'global', 'node_modules')
  const packageRoot = path.join(globalRoot, ...name.split('/'))
  fs.mkdirSync(path.join(packageRoot, 'dist'), { recursive: true })
  fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name, version: '1.0.0' }))
  const cliEntry = path.join(packageRoot, 'dist', 'vibeflow.mjs')
  fs.writeFileSync(cliEntry, '')
  return { root, globalRoot, packageRoot, cliEntry }
}

function run(options) {
  const calls = []
  const logs = []
  const errors = []
  const code = runUpdate({
    ...options,
    runNpm: options.runNpm ?? ((args, inherit) => {
      calls.push({ args, inherit })
      return args[0] === 'root' ? { status: 0, stdout: `${options.globalRoot}\n` } : { status: 0 }
    }),
    log: (message) => logs.push(message),
    error: (message) => errors.push(message),
  })
  return { code, calls, logs, errors }
}

test('global npm installation updates the package containing the CLI', (t) => {
  const f = fixture(t, '@example/renamed-vibeflow')
  const result = run({ ...f, sourceRoot: null })
  assert.equal(result.code, 0)
  assert.deepEqual(result.calls, [
    { args: ['root', '-g'], inherit: false },
    { args: ['install', '-g', '@example/renamed-vibeflow@latest'], inherit: true },
  ])
  assert.match(result.logs.at(-1), /重新啟動/)
})

test('source checkout, local package, npx cache, and npm link do not install globally', (t) => {
  const f = fixture(t)
  assert.equal(run({ ...f, sourceRoot: f.root }).code, 1)
  for (const alternate of ['local', 'npx']) {
    const entry = path.join(f.root, alternate, 'node_modules', '@kw-yeh', 'vibeflow', 'dist', 'vibeflow.mjs')
    fs.mkdirSync(path.dirname(entry), { recursive: true })
    fs.copyFileSync(path.join(f.packageRoot, 'package.json'), path.join(path.dirname(entry), '..', 'package.json'))
    fs.writeFileSync(entry, '')
    const result = run({ ...f, cliEntry: entry, sourceRoot: null })
    assert.equal(result.code, 1)
    assert.equal(result.calls.length, 1, `${alternate} must not run npm install`)
  }
  fs.rmSync(f.packageRoot, { recursive: true })
  const target = path.join(f.root, 'linked-package')
  fs.mkdirSync(path.join(target, 'dist'), { recursive: true })
  fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: '@kw-yeh/vibeflow' }))
  fs.symlinkSync(target, f.packageRoot, process.platform === 'win32' ? 'junction' : 'dir')
  assert.equal(run({ ...f, sourceRoot: null }).code, 1)
})

test('npm lookup or installation failure returns nonzero and never reports success', (t) => {
  const f = fixture(t)
  const lookup = run({ ...f, sourceRoot: null, runNpm: () => ({ status: 2, stdout: '' }) })
  assert.equal(lookup.code, 1)
  assert.match(lookup.errors[0], /npm 結束碼 2/)
  const install = run({ ...f, sourceRoot: null, runNpm: (args) => args[0] === 'root'
    ? { status: 0, stdout: f.globalRoot }
    : { status: 13 } })
  assert.equal(install.code, 13)
  assert.match(install.errors[0], /npm 結束碼 13/)
  assert.doesNotMatch(install.logs.join(' '), /更新完成/)
})
