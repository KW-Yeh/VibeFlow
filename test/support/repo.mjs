import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const pexec = promisify(execFile)

/** Run a git command in `cwd`; returns trimmed stdout. */
export async function git(cwd, ...args) {
  const { stdout } = await pexec('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 })
  return stdout.toString().trim()
}

/**
 * Create a throwaway sandbox with a project repo and (optionally) a bare
 * "origin" remote it is cloned from. The project gets one `main` commit and
 * deterministic identity/signing config so tests never touch the user's git.
 *
 * Returns { root, projectPath, remotePath|null, cleanup }.
 */
export async function makeRepo({ withRemote = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-test-'))
  const projectPath = path.join(root, 'project')
  let remotePath = null

  if (withRemote) {
    remotePath = path.join(root, 'remote.git')
    await git(root, 'init', '--bare', '-b', 'main', remotePath)
    await git(root, 'clone', remotePath, projectPath)
  } else {
    await fs.mkdir(projectPath, { recursive: true })
    await git(projectPath, 'init', '-b', 'main')
  }

  // Deterministic, isolated identity — never inherit the user's config.
  await git(projectPath, 'config', 'user.email', 'qa@vibeflow.test')
  await git(projectPath, 'config', 'user.name', 'VibeFlow QA')
  await git(projectPath, 'config', 'commit.gpgsign', 'false')

  await fs.writeFile(path.join(projectPath, 'README.md'), '# sandbox\n')
  await git(projectPath, 'add', '-A')
  await git(projectPath, 'commit', '-m', 'init')
  await git(projectPath, 'branch', '-M', 'main')
  if (withRemote) await git(projectPath, 'push', '-u', 'origin', 'main')

  const cleanup = () => fs.rm(root, { recursive: true, force: true })
  return { root, projectPath, remotePath, cleanup }
}

/** Write a file (creating parent dirs) inside a worktree/repo. */
export async function writeFile(cwd, relPath, content) {
  const full = path.join(cwd, relPath)
  await fs.mkdir(path.dirname(full), { recursive: true })
  await fs.writeFile(full, content, 'utf8')
  return full
}

/** Read a file as utf8, or null when absent. */
export async function readFileOrNull(cwd, relPath) {
  try {
    return await fs.readFile(path.join(cwd, relPath), 'utf8')
  } catch {
    return null
  }
}

/** True when a path exists. */
export async function exists(p) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}
