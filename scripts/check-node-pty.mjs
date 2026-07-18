#!/usr/bin/env node
import { existsSync } from 'node:fs'
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

try {
  const utils = require(path.join(nodePtyRoot, 'lib', 'utils.js'))
  for (const name of nativeNames) {
    utils.loadNativeModule(name)
  }
} catch (error) {
  fail(`Failed to load node-pty native binaries for ${platformArch}.`, error)
}

const source = hasRelease ? 'build/Release' : `prebuilds/${platformArch}`
console.log(`[node-pty] OK: loaded native binaries from ${source}; Electron rebuild skipped.`)
