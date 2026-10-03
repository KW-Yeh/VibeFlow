import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { copyIgnoredEntry } from '../packages/core/src/git.ts'

// npm workspaces link `node_modules/<pkg>` to the package directory: a junction
// on Windows, a symlink elsewhere. Both kinds have to survive the copy into a
// worktree, and must point at the worktree's own package rather than the source's.
async function makeWorkspaceProject(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-ignored-copy-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const projectPath = path.join(root, 'project')
  const worktreePath = path.join(root, 'worktree')
  for (const base of [projectPath, worktreePath]) {
    await fs.mkdir(path.join(base, 'packages', 'cli'), { recursive: true })
    await fs.writeFile(path.join(base, 'packages', 'cli', 'package.json'), '{}')
  }
  await fs.mkdir(path.join(projectPath, 'node_modules', '@vibeflow'), { recursive: true })
  await fs.symlink(
    path.join(projectPath, 'packages', 'cli'),
    path.join(projectPath, 'node_modules', '@vibeflow', 'cli'),
    'junction'
  )
  // Sorts after `@vibeflow`, so a copy that aborts on the link never reaches it.
  await fs.mkdir(path.join(projectPath, 'node_modules', 'zod'), { recursive: true })
  await fs.writeFile(path.join(projectPath, 'node_modules', 'zod', 'index.js'), 'ok')
  return { projectPath, worktreePath }
}

test('copyIgnoredEntry copies node_modules that holds a workspace link', async (t) => {
  const { projectPath, worktreePath } = await makeWorkspaceProject(t)

  await copyIgnoredEntry(projectPath, worktreePath, 'node_modules')

  assert.equal(
    await fs.readFile(path.join(worktreePath, 'node_modules', 'zod', 'index.js'), 'utf8'),
    'ok'
  )
})

test('copyIgnoredEntry points a workspace link at the worktree, not the source project', async (t) => {
  const { projectPath, worktreePath } = await makeWorkspaceProject(t)

  await copyIgnoredEntry(projectPath, worktreePath, 'node_modules')

  assert.equal(
    await fs.realpath(path.join(worktreePath, 'node_modules', '@vibeflow', 'cli')),
    await fs.realpath(path.join(worktreePath, 'packages', 'cli'))
  )
})
