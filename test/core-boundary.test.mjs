import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * packages/core must run in any host — the Electron shell, the CLI, the
 * future Web UI server and TUI. Anything UI- or Electron-specific reaches core
 * through PlatformServices / EventSink instead of an import. The repo has no
 * linter, so this test is the guard.
 */
const coreSrc = fileURLToPath(new URL('../packages/core/src/', import.meta.url))

const FORBIDDEN_PACKAGES = [
  'electron',
  'electron-store',
  'electron-serve',
  'electron-updater',
  'react',
  'react-dom',
  'next',
]

function coreFiles(dir = coreSrc) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return coreFiles(full)
    return /\.[mc]?[jt]sx?$/.test(entry.name) ? [full] : []
  })
}

/** Module specifiers from static imports/exports, dynamic import() and require(). */
function specifiers(source) {
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  return patterns.flatMap((re) => Array.from(source.matchAll(re), (m) => m[1]))
}

function packageName(spec) {
  const parts = spec.split('/')
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

test('packages/core imports no electron, react or next', () => {
  const files = coreFiles()
  assert.ok(files.length > 0, 'expected core sources')
  const violations = files.flatMap((file) =>
    specifiers(fs.readFileSync(file, 'utf8'))
      .filter((spec) => FORBIDDEN_PACKAGES.includes(packageName(spec)))
      .map((spec) => `${path.relative(coreSrc, file)} → ${spec}`)
  )
  assert.deepEqual(violations, [])
})

test('packages/core does not reach into main/ or renderer/', () => {
  const violations = coreFiles().flatMap((file) =>
    specifiers(fs.readFileSync(file, 'utf8'))
      .filter((spec) => spec.startsWith('.'))
      .filter((spec) => {
        const target = path.resolve(path.dirname(file), spec)
        return !target.startsWith(coreSrc)
      })
      .map((spec) => `${path.relative(coreSrc, file)} → ${spec}`)
  )
  assert.deepEqual(violations, [])
})
