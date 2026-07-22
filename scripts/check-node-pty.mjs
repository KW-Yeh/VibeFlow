#!/usr/bin/env node
import { accessSync, chmodSync, constants, existsSync, statSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function fail(message, error) {
  console.error(`\n[node-pty] ${message}`)
  if (error) console.error(error)
  console.error(
    [
      '[node-pty] VibeFlow intentionally does not run `electron-builder install-app-deps` here.',
      '[node-pty] node-pty 1.1.0 ships prebuilt binaries for our Windows/macOS targets;',
      '[node-pty] forcing an Electron native rebuild on Windows requires MSVC and fails in winpty.',
      '[node-pty] If this breaks after bumping Electron or node-pty, check prebuild support first.',
    ].join('\n')
  )
  process.exit(1)
}

let nodePtyRoot
try {
  nodePtyRoot = path.dirname(require.resolve('node-pty/package.json', { paths: [root] }))
} catch (error) {
  fail('node-pty is not installed.', error)
}

const platformArch = `${process.platform}-${process.arch}`
const releaseDir = path.join(nodePtyRoot, 'build', 'Release')
const prebuildDir = path.join(nodePtyRoot, 'prebuilds', platformArch)
const nativeNames =
  process.platform === 'win32'
    ? ['pty', 'conpty', 'conpty_console_list']
    : ['pty']
const smokeTimeoutMs = 5_000

const hasRelease = nativeNames.every((name) =>
  existsSync(path.join(releaseDir, `${name}.node`))
)
const hasPrebuild = nativeNames.every((name) =>
  existsSync(path.join(prebuildDir, `${name}.node`))
)

if (!hasRelease && !hasPrebuild) {
  fail(
    `No node-pty native binaries found for ${platformArch}. Expected ${releaseDir} or ${prebuildDir}.`
  )
}

let loadedPty
try {
  const utils = require(path.join(nodePtyRoot, 'lib', 'utils.js'))
  for (const name of nativeNames) {
    const loadedNative = utils.loadNativeModule(name)
    if (name === 'pty') loadedPty = loadedNative
  }
} catch (error) {
  fail(`Failed to load node-pty native binaries for ${platformArch}.`, error)
}

if (!loadedPty) {
  fail(`Failed to resolve the loaded node-pty native source for ${platformArch}.`)
}

const loadedNativeDir = path.resolve(nodePtyRoot, 'lib', loadedPty.dir)
const source = path.relative(nodePtyRoot, loadedNativeDir) || '.'
let helper = `not required on ${process.platform}`
let helperMode = 'n/a'

if (process.platform === 'darwin') {
  const helperPath = path.join(loadedNativeDir, 'spawn-helper')
  if (!existsSync(helperPath)) {
    fail(`No node-pty spawn helper found at ${helperPath}.`)
  }

  try {
    const currentMode = statSync(helperPath).mode & 0o7777
    chmodSync(helperPath, currentMode | 0o111)
    const repairedMode = statSync(helperPath).mode & 0o7777
    if ((repairedMode & 0o111) !== 0o111) {
      throw new Error(`Expected executable bits, received ${repairedMode.toString(8)}`)
    }
    accessSync(helperPath, constants.X_OK)
    helper = helperPath
    helperMode = repairedMode.toString(8).padStart(4, '0')
  } catch (error) {
    fail(`Failed to make node-pty spawn helper executable at ${helperPath}.`, error)
  }
}

async function smokeTest() {
  const nodePty = require('node-pty')
  const token = `vibeflow-node-pty-${randomUUID()}`
  let child
  let dataListener
  let exitListener
  let timeout
  let killTimeout
  let exited = false
  let timedOut = false
  let output = ''

  try {
    const exit = await new Promise((resolve, reject) => {
      try {
        child = nodePty.spawn(
          process.execPath,
          ['-e', `process.stdout.write(${JSON.stringify(token)})`],
          {
            name: 'xterm-256color',
            cols: 80,
            rows: 24,
            cwd: root,
            env: process.env,
          }
        )
      } catch (error) {
        reject(error)
        return
      }

      dataListener = child.onData((data) => {
        output += data
      })
      exitListener = child.onExit((event) => {
        exited = true
        if (timedOut) {
          reject(new Error(`PTY smoke test timed out after ${smokeTimeoutMs}ms.`))
          return
        }
        resolve(event)
      })
      timeout = setTimeout(() => {
        timedOut = true
        try {
          child.kill()
        } catch (error) {
          reject(new Error('Failed to terminate timed out PTY smoke test.', { cause: error }))
          return
        }
        killTimeout = setTimeout(() => {
          reject(new Error(`PTY smoke test did not exit after timing out at ${smokeTimeoutMs}ms.`))
        }, 1_000)
      }, smokeTimeoutMs)
    })

    if (exit.exitCode !== 0) {
      throw new Error(`PTY smoke test exited with code ${exit.exitCode}.`)
    }
    if (!output.includes(token)) {
      throw new Error('PTY smoke test output did not contain its unique token.')
    }

    return token
  } finally {
    clearTimeout(timeout)
    clearTimeout(killTimeout)
    dataListener?.dispose()
    exitListener?.dispose()
    if (child && !exited) {
      try {
        child.kill()
      } catch {}
    }
  }
}

let smokeToken
try {
  smokeToken = await smokeTest()
} catch (error) {
  fail(`Failed to spawn a process through node-pty for ${platformArch}.`, error)
}

console.log(
  `[node-pty] OK: source=${source}; helper=${helper}; mode=${helperMode}; smoke=${smokeToken}; Electron rebuild skipped.`
)
