import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const parity = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', 'packages', 'core', 'builtin-skills', 'visual-parity', 'scripts', 'parity.py'
)

// Windows runners ship `python` but not always `python3`.
const python = ['python3', 'python'].find(
  (cmd) => spawnSync(cmd, ['--version'], { stdio: 'ignore' }).status === 0
)

// Loads parity.py with a stub playwright so only its path helpers run.
const probe = `
import importlib.util, json, sys, types
api = types.ModuleType("playwright.sync_api")
api.sync_playwright = None
sys.modules["playwright"] = types.ModuleType("playwright")
sys.modules["playwright.sync_api"] = api
spec = importlib.util.spec_from_file_location("parity", sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
print(json.dumps({"out": m.output_path(sys.argv[2]), "scratch": m.scratch_dir()}))
`

function resolve(target, env) {
  const childEnv = { ...process.env }
  delete childEnv.VIBEFLOW_ARTIFACTS_DIR
  delete childEnv.VIBEFLOW_SCRATCH_DIR
  Object.assign(childEnv, env)
  const run = spawnSync(python, ['-I', '-c', probe, parity, target], { env: childEnv, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  const lines = run.stdout.trim().split('\n')
  return { ...JSON.parse(lines.at(-1)), log: lines.slice(0, -1).join('\n') }
}

async function tmp(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-parity-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  return dir
}

const skip = python ? false : 'needs python3 or python on PATH'

test('outside VibeFlow a relative output stays relative to the cwd', { skip }, () => {
  assert.deepEqual(resolve('parity-diff.md', {}), { out: 'parity-diff.md', scratch: null, log: '' })
})

test('an empty VIBEFLOW_ARTIFACTS_DIR counts as outside VibeFlow', { skip }, () => {
  const got = resolve('parity-diff.md', { VIBEFLOW_ARTIFACTS_DIR: '', VIBEFLOW_SCRATCH_DIR: '' })
  assert.equal(got.out, 'parity-diff.md')
  assert.equal(got.scratch, null)
})

test('inside a task a relative output goes to the Artifacts visual-parity folder', { skip }, async (t) => {
  const artifacts = path.join(await tmp(t), 'vf-abc.artifacts')
  const got = resolve(path.join('shots', 'home.png'), { VIBEFLOW_ARTIFACTS_DIR: artifacts })
  assert.equal(got.out, path.join(artifacts, 'visual-parity', 'shots', 'home.png'))
  assert.equal((await fs.stat(path.join(artifacts, 'visual-parity', 'shots'))).isDirectory(), true)
})

test('an absolute output is used as given, even inside a task', { skip }, async (t) => {
  const dir = await tmp(t)
  const target = path.join(dir, 'elsewhere', 'report.md')
  assert.equal(resolve(target, { VIBEFLOW_ARTIFACTS_DIR: path.join(dir, 'a') }).out, target)
})

test('an unwritable Artifacts folder falls back to the cwd instead of failing', { skip }, async (t) => {
  const file = path.join(await tmp(t), 'not-a-dir')
  await fs.writeFile(file, 'x')
  const got = resolve('parity-flow.md', { VIBEFLOW_ARTIFACTS_DIR: file })
  assert.equal(got.out, 'parity-flow.md')
  assert.match(got.log, /cannot write under/)
})

test('throwaway files use the task scratch folder when there is one', { skip }, async (t) => {
  const scratch = path.join(await tmp(t), 'vf-abc.artifacts', 'scratch')
  assert.equal(resolve('x', { VIBEFLOW_SCRATCH_DIR: scratch }).scratch, scratch)
  assert.equal((await fs.stat(scratch)).isDirectory(), true)
})
