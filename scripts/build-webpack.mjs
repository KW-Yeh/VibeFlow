#!/usr/bin/env node
import { rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const pack = !args.includes('--no-pack')
const builderArgs = args.filter((arg) => arg !== '--no-pack')

function run(command, commandArgs, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env, ...env },
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${command} ${commandArgs.join(' ')} exited with ${code}`))
      }
    })
  })
}

await rm(path.join(root, 'app'), { recursive: true, force: true })
await rm(path.join(root, 'dist'), { recursive: true, force: true })

console.log('==> Building renderer process (next build --webpack)')
await run('npx', ['next', 'build', '--webpack', 'renderer'], {
  NODE_ENV: 'production',
})

console.log('==> Building main process (nextron webpack config)')
await run('node', [path.join(root, 'node_modules/nextron/bin/webpack.config.cjs')], {
  NODE_ENV: 'production',
})

if (pack) {
  console.log('==> Packaging with electron-builder')
  await run('npx', ['electron-builder', ...builderArgs], {
    ELECTRON_BUILDER_ALLOW_UNRESOLVED_DEPENDENCIES: 'true',
  })
  console.log('==> See dist directory')
} else {
  console.log('==> Skip packaging')
}
