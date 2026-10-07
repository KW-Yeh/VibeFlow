import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * packages/core must run in any host — the CLI, the Web UI server and the TUI.
 * Anything UI-specific reaches core through PlatformServices / EventSink
 * instead of an import. The repo has no linter, so this test is the guard.
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

test('packages/core does not reach outside its own sources', () => {
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

/**
 * Modules the renderer bundles at runtime. A value import here would drag
 * `fs` / `child_process` into the browser build, so they import types only.
 */
const RENDERER_SAFE = ['launch.ts', 'client.ts', 'ws-transport.ts', 'effort.ts']

test('renderer-bundled core modules import types only', () => {
  const violations = RENDERER_SAFE.flatMap((name) => {
    const source = fs.readFileSync(path.join(coreSrc, name), 'utf8')
    return Array.from(source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+['"]([^'"]+)['"]/gm), (m) => `${name} → ${m[1]}`)
  })
  assert.deepEqual(violations, [])
})

/**
 * Node runs packages/* straight from source with --experimental-strip-types,
 * which only erases types. Syntax that needs a transform (enums, namespaces,
 * constructor parameter properties) would crash the CLI at load.
 */
test('packages use only erasable TypeScript syntax', () => {
  const packagesDir = fileURLToPath(new URL('../packages/', import.meta.url))
  const files = fs
    .readdirSync(packagesDir)
    .flatMap((pkg) => {
      const src = path.join(packagesDir, pkg, 'src')
      return fs.existsSync(src) ? coreFiles(src) : []
    })
  const patterns = [
    [/^\s*(export\s+)?(const\s+)?enum\s/m, 'enum'],
    [/^\s*(export\s+)?namespace\s/m, 'namespace'],
    [/constructor\s*\([^)]*\b(private|public|protected|readonly)\s/s, 'parameter property'],
  ]
  const violations = files.flatMap((file) => {
    const source = fs.readFileSync(file, 'utf8')
    return patterns.filter(([re]) => re.test(source)).map(([, what]) => `${path.relative(packagesDir, file)}: ${what}`)
  })
  assert.deepEqual(violations, [])
})
