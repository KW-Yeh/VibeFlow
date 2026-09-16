import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createTaskFromInput } from '../main/helpers/tasks.ts'
import { getStoreAtPath } from '../main/helpers/store.ts'
import { makeRepo } from './support/repo.mjs'

/**
 * A store whose workstation root is a throwaway directory, so provisioning
 * never writes into the developer's real workstation (~/Desktop by default).
 */
async function seedStore(t, autoMode = true) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-tasks-create-'))
  const workstation = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-workstation-'))
  t.after(() => Promise.all([
    fs.rm(dir, { recursive: true, force: true }),
    fs.rm(workstation, { recursive: true, force: true }),
  ]))
  getStoreAtPath(dir).set('settings', { autoMode, workstationPath: workstation })
  return dir
}

const BASE = {
  title: 'Fix login flow',
  branch: 'fix/login-flow',
}

test('a card records the Auto Mode it was created with', async (t) => {
  const { projectPath: project, cleanup } = await makeRepo()
  t.after(cleanup)
  const storePath = await seedStore(t)

  const { task } = await createTaskFromInput({
    ...BASE,
    projectPath: project,
    autoMode: false,
    storePath,
  })

  assert.equal(task.autoMode, false)
  assert.equal(getStoreAtPath(storePath).get('board').backlog[0].autoMode, false)
})

test('a card created without one stays unset, so it inherits the board default', async (t) => {
  const { projectPath: project, cleanup } = await makeRepo()
  t.after(cleanup)
  const storePath = await seedStore(t)

  const { task } = await createTaskFromInput({
    ...BASE,
    projectPath: project,
    storePath,
  })

  assert.equal(task.autoMode, undefined)
})
