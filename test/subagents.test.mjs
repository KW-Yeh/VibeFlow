import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'

import {
  resetSubAgents,
  SUBAGENTS_DIR,
} from '../main/helpers/subagents.ts'

test('resetSubAgents — removes prior hook events without touching worktree files', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-subagents-'))
  try {
    const eventsDir = path.join(cwd, SUBAGENTS_DIR)
    await fs.mkdir(eventsDir)
    await fs.writeFile(path.join(eventsDir, 'event.json'), '{}')
    await fs.writeFile(path.join(cwd, 'source.ts'), 'keep-me')

    resetSubAgents(cwd)

    await assert.rejects(fs.access(eventsDir), { code: 'ENOENT' })
    assert.equal(await fs.readFile(path.join(cwd, 'source.ts'), 'utf8'), 'keep-me')
    resetSubAgents(cwd)
  } finally {
    await fs.rm(cwd, { recursive: true, force: true })
  }
})
