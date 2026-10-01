#!/usr/bin/env node
// Static export of the renderer into ./app (the build `vibeflow` serves).
// Pass --webpack in runners where Turbopack cannot bind.
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const nextBin = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next')
const args = [nextBin, 'build', ...process.argv.slice(2)]
const child = spawn(process.execPath, args, {
  cwd: path.join(root, 'renderer'),
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'production' },
})
child.on('exit', (code) => process.exit(code ?? 1))
