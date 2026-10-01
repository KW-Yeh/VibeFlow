#!/usr/bin/env node
// Kept at this path because launched agents call it through $VIBEFLOW_CLI
// (packages/core/src/board-cli.ts). The commands live in packages/cli.
// Run via: node --experimental-strip-types --import ./test/support/register.mjs scripts/vibeflow.mjs <command>
import { main } from '../packages/cli/src/main.ts'

const code = await main(process.argv.slice(2))
// Exit explicitly: node-pty (ConPTY on Windows) can leave handles open after a
// pty ends. Flush stdout first, since pipes are asynchronous on POSIX and the
// JSON a `task` command prints must arrive whole.
process.stdout.write('', () => process.exit(code))
