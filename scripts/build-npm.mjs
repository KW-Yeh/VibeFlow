#!/usr/bin/env node
// Assemble the npm package in ./dist-npm:
//   dist/vibeflow.mjs  core + cli + tui bundled by esbuild (plain JS, Node 22+)
//   dist/postinstall.mjs  makes node-pty's spawn-helper executable at install time
//   dist/web/          the renderer's static export, served by core
//   package.json       runtime dependencies only (node-pty, ws, ink, react)
//
//   npm run build:npm                 # then: npm pack ./dist-npm
//   npm run build:npm -- --name <other-name>
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { values } = parseArgs({ options: { name: { type: 'string', default: '@kw-yeh/vibeflow' } } })
const out = path.join(root, 'dist-npm')
const rootPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

/** Installed version of a dependency, pinned with ^ in the published package. */
function depVersion(name) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8'))
  return `^${pkg.version}`
}

const RUNTIME_DEPS = ['node-pty', 'ws', 'ink', 'react']

fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(path.join(out, 'dist'), { recursive: true })

const bundle = (entry, outName) => build({
  entryPoints: [path.join(root, 'packages', 'cli', 'src', entry)],
  outfile: path.join(out, 'dist', outName),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: [...RUNTIME_DEPS, 'react-devtools-core'],
  // Bundled CommonJS code calls require(); give ESM one. (esbuild keeps
  // bin.ts's shebang on line 1 by itself.)
  banner: {
    js: "import { createRequire as __vfCreateRequire } from 'node:module';\nconst require = __vfCreateRequire(import.meta.url);",
  },
  legalComments: 'none',
  logLevel: 'warning',
})

console.log('==> Bundling the CLI (core + cli + tui)')
await bundle('bin.ts', 'vibeflow.mjs')
await bundle('postinstall.ts', 'postinstall.mjs')

const webSrc = path.join(root, 'app')
if (!fs.existsSync(path.join(webSrc, 'home', 'index.html'))) {
  console.log('==> Building the Web UI')
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'build-web.mjs')], { stdio: 'inherit' })
  if (r.status !== 0) process.exit(r.status ?? 1)
}
console.log('==> Copying the Web UI')
// A checkout that predates the Electron removal may still hold its main/preload bundles in app/.
const ELECTRON_FILES = /^(main|preload)\.js(\.map)?$/
fs.cpSync(webSrc, path.join(out, 'dist', 'web'), {
  recursive: true,
  filter: (src) => !ELECTRON_FILES.test(path.basename(src)) || path.dirname(src) !== webSrc,
})
console.log('==> Copying the built-in skills')
fs.cpSync(path.join(root, 'packages', 'core', 'builtin-skills'), path.join(out, 'dist', 'builtin-skills'), {
  recursive: true,
  filter: (src) => path.basename(src) !== '__pycache__',
})

const pkg = {
  name: values.name,
  version: rootPkg.version,
  description: 'Intent-driven local kanban for coding agents: git worktree per card, Web UI and TUI.',
  license: 'MIT',
  author: rootPkg.author,
  type: 'module',
  bin: { vibeflow: 'dist/vibeflow.mjs' },
  scripts: { postinstall: 'node dist/postinstall.mjs' },
  files: ['dist', 'README.md', 'LICENSE'],
  engines: { node: '>=22' },
  repository: { type: 'git', url: 'git+https://github.com/KW-Yeh/VibeFlow.git' },
  keywords: ['kanban', 'claude-code', 'codex', 'git-worktree', 'tmux', 'agent'],
  dependencies: Object.fromEntries(RUNTIME_DEPS.map((d) => [d, depVersion(d)])),
}
fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(out, 'LICENSE'))
fs.copyFileSync(path.join(root, 'README.md'), path.join(out, 'README.md'))
console.log(`==> ${pkg.name}@${pkg.version} staged in dist-npm/ (npm pack ./dist-npm)`)
