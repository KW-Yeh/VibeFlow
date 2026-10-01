#!/usr/bin/env node
// `npm start` from a checkout: build the Web UI once if it is missing, then
// run the vibeflow CLI from source. Extra args pass through:
//   npm start -- tui
//   npm start -- --profile dev --no-open
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
if (!fs.existsSync(path.join(root, 'app', 'home', 'index.html'))) {
  console.log('==> 第一次執行：建置 Web UI（npm run build:web）')
  const built = spawnSync(process.execPath, [path.join(root, 'scripts', 'build-web.mjs')], { stdio: 'inherit' })
  if (built.status !== 0) process.exit(built.status ?? 1)
}
const loader = pathToFileURL(path.join(root, 'test', 'support', 'register.mjs')).href
const child = spawn(
  process.execPath,
  ['--experimental-strip-types', '--no-warnings=ExperimentalWarning', '--import', loader,
    path.join(root, 'packages', 'cli', 'src', 'bin.ts'), ...process.argv.slice(2)],
  { stdio: 'inherit' }
)
// Ctrl+C reaches the child directly (same console); just mirror its exit.
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => {})
child.on('exit', (code) => process.exit(code ?? 0))
