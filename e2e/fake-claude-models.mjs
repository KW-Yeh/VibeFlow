// Stands in for `claude -p --input-format stream-json ...`: answers the
// initialize handshake with the captured catalog, echoing the request id.
import fs from 'node:fs'
import readline from 'node:readline'

const fixture = JSON.parse(
  fs.readFileSync(new URL('../test/fixtures/agent-models/claude-initialize.jsonl', import.meta.url), 'utf8')
)

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line)
  if (message.type !== 'control_request') return
  const reply = { ...fixture, response: { ...fixture.response, request_id: message.request_id } }
  process.stdout.write(`${JSON.stringify(reply)}\n`)
})
