#!/usr/bin/env node
import { main } from './main'

const code = await main(process.argv.slice(2))
// Exit explicitly: node-pty (ConPTY on Windows) can leave handles open after a
// pty ends. Flush stdout first, since pipes are asynchronous on POSIX and the
// JSON a `task` command prints must arrive whole.
process.stdout.write('', () => process.exit(code))
