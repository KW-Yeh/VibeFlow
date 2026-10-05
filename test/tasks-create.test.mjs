import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createTaskFromInput } from '../packages/core/src/tasks.ts'
import { getStoreAtPath } from '../packages/core/src/store.ts'
import { exists, git, makeRepo } from './support/repo.mjs'

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

test('a backlog card names its branch but creates nothing in git', async (t) => {
  const { projectPath: project, remotePath, cleanup } = await makeRepo()
  t.after(cleanup)
  const storePath = await seedStore(t)

  const { task } = await createTaskFromInput({ ...BASE, projectPath: project, storePath })

  assert.equal(task.branch, 'fix/login-flow')
  assert.equal(task.branchExplicit, true)
  assert.equal(task.baseBranch, 'main')
  assert.equal(task.worktreePath, undefined)
  assert.equal(await git(project, 'branch', '--list', 'fix/login-flow'), '')
  assert.equal(await git(remotePath, 'branch', '--list', 'fix/login-flow'), '')
})

test('a card created straight into In Progress is provisioned at once', async (t) => {
  const { projectPath: project, remotePath, cleanup } = await makeRepo()
  t.after(cleanup)
  const storePath = await seedStore(t)

  const { task } = await createTaskFromInput({
    ...BASE,
    projectPath: project,
    status: 'in_progress',
    storePath,
  })

  assert.ok(await exists(task.worktreePath))
  assert.equal(task.pushed, true)
  assert.match(await git(remotePath, 'branch', '--list', 'fix/login-flow'), /fix\/login-flow/)
})

test('a taken branch name is still refused at creation', async (t) => {
  const { projectPath: project, cleanup } = await makeRepo()
  t.after(cleanup)
  const storePath = await seedStore(t)
  await git(project, 'branch', 'fix/login-flow')

  await assert.rejects(
    createTaskFromInput({ ...BASE, projectPath: project, storePath }),
    { code: 'BRANCH_ALREADY_EXISTS' }
  )
})

test('attachments of an unprovisioned card live outside any worktree', async (t) => {
  const { projectPath: project, cleanup } = await makeRepo()
  t.after(cleanup)
  const storePath = await seedStore(t)

  const { task } = await createTaskFromInput({
    ...BASE,
    projectPath: project,
    attachments: [{ name: 'note.txt', mime: 'text/plain', dataBase64: Buffer.from('hi').toString('base64') }],
    storePath,
  })

  const [, filePath] = task.description.match(/\[附件: (.+)\]/)
  assert.ok(filePath.startsWith(path.join(task.workspacePath, '.attachments', task.id)))
  assert.equal(await fs.readFile(filePath, 'utf8'), 'hi')
})
