#!/usr/bin/env node
// Cross-platform `npm test`: the type-stripping flags go through NODE_OPTIONS
// so they also reach the child process each test file runs in. An inline
// `NODE_OPTIONS=… node` prefix does not work in Windows' cmd.exe.
import { spawn } from 'node:child_process'

const files = process.argv.slice(2)
const child = spawn(
  process.execPath,
  [
    '--test',
    // A node-pty session on Windows holds handles after it ends, so a finished
    // test file would never exit (see check-node-pty.mjs). Elsewhere a file that
    // does not exit is a real leak and should stay visible.
    ...(process.platform === 'win32' ? ['--test-force-exit'] : []),
    ...(files.length ? files : ['./test/**/*.test.mjs']),
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --experimental-strip-types --import ./test/support/register.mjs`.trim(),
    },
  }
)
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)))
