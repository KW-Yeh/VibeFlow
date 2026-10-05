import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  blockReason,
  createPayload,
  editFormState,
  editorCommand,
  modelOptions,
  newFormState,
  updatePayload,
  visibleFields,
} from '../packages/tui/src/task-form.ts'

const ctx = (over = {}) => ({ recent: [], agents: [], models: {}, workstationPath: '', ...over })
const repo = (over = {}) => ({ isRepo: true, hasRemote: true, remoteUrl: 'x', currentBranch: 'main', branches: ['dev', 'main'], defaultBase: 'main', ...over })

test('a new card defaults like the Web UI: claude, medium, the board Auto Mode', () => {
  const s = newFormState(false, [{ id: 'claude' }, { id: 'codex' }])
  assert.equal(s.agentCli, 'claude')
  assert.equal(s.effort, 'medium')
  assert.equal(s.autoMode, false)
  assert.equal(newFormState(true, [{ id: 'codex' }]).agentCli, 'codex', 'falls back to the only detected agent')
})

test('new form fields follow the git state of the chosen folder', () => {
  const s = newFormState(true, [])
  assert.deepEqual(visibleFields(s, ctx()), ['title', 'project', 'attachments', 'description', 'effort', 'autoMode', 'agent', 'model', 'submit'])
  assert.ok(visibleFields({ ...s, projectPath: '/p', gitInfo: repo({ isRepo: false }) }, ctx()).includes('gitInit'))
  const withRemote = visibleFields({ ...s, projectPath: '/p', gitInfo: repo() }, ctx())
  assert.ok(withRemote.includes('baseBranch') && withRemote.includes('branch') && !withRemote.includes('gitInit'))
  const local = visibleFields({ ...s, projectPath: '/p', gitInfo: repo({ hasRemote: false }) }, ctx())
  assert.ok(!local.includes('baseBranch') && local.includes('branch'))
})

test('edit form offers the base branch and the branch of a Backlog card', () => {
  const task = { id: 't1', title: 'T', branch: 'b', projectPath: '/a', baseBranch: 'main' }
  const s = editFormState(task, true)
  assert.ok(!visibleFields(s, ctx()).includes('baseBranch'), 'no base list before git is known')
  assert.ok(visibleFields(s, ctx()).includes('branch'))
  assert.ok(visibleFields({ ...s, gitInfo: repo() }, ctx()).includes('baseBranch'))
})

test('submitting needs a title and a ready git project', () => {
  const s = { ...newFormState(true, []), title: 'Fix' }
  assert.match(blockReason({ ...s, title: '  ' }, ctx(), false), /標題/)
  assert.match(blockReason(s, ctx(), false), /專案/)
  assert.match(blockReason({ ...s, projectPath: '/p', gitInfo: repo({ isRepo: false }) }, ctx(), false), /不是 Git/)
  assert.match(blockReason({ ...s, projectPath: '/p', gitInfo: repo() }, ctx(), true), /偵測/)
  assert.match(blockReason({ ...s, projectPath: '/p', gitInfo: repo() }, ctx({ recent: [{ path: '/p', name: 'p', lastUsedAt: 0, missing: true }] }), false), /找不到/)
  assert.equal(blockReason({ ...s, projectPath: '/p', gitInfo: repo() }, ctx(), false), null)
  const edit = editFormState({ id: 't', title: 'T', branch: 'b', projectPath: '/a' }, true)
  assert.equal(blockReason(edit, ctx(), false), null, 'an unchanged project needs no git lookup')
})

test('the create payload matches the Web UI', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-form-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'shot.png')
  fs.writeFileSync(file, 'png')
  const s = { ...newFormState(true, []), title: ' Fix ', description: ' why \n', projectPath: '/p', gitInfo: repo(), baseBranch: 'dev', branch: ' feature/x ', attachments: [file], model: '' }
  const p = createPayload(s)
  assert.equal(p.title, 'Fix')
  assert.equal(p.description, 'why')
  assert.equal(p.baseBranch, 'dev')
  assert.equal(p.branch, 'feature/x')
  assert.equal(p.model, undefined)
  assert.deepEqual(p.attachments, [{ name: 'shot.png', mime: 'image/png', dataBase64: Buffer.from('png').toString('base64') }])
  assert.equal(createPayload({ ...s, gitInfo: repo({ hasRemote: false }) }).baseBranch, null, 'no remote, no base branch')
  assert.equal(createPayload({ ...s, branch: '' }).branch, undefined)
})

test('the update payload carries the git-bound fields', () => {
  const task = { id: 't1', title: 'T', branch: 'b', projectPath: '/a', baseBranch: 'main' }
  const p = updatePayload({ ...editFormState(task, true), branch: ' feature/y ' })
  assert.equal(p.projectPath, '/a')
  assert.equal(p.baseBranch, 'main')
  assert.equal(p.branch, 'feature/y')
})

test('model choices are the default, the agent list, and a model not on it', () => {
  const c = ctx({ models: { claude: ['opus', 'sonnet'] } })
  assert.deepEqual(modelOptions(c, 'claude', ''), ['', 'opus', 'sonnet'])
  assert.deepEqual(modelOptions(c, 'claude', 'haiku'), ['', 'opus', 'sonnet', 'haiku'])
  assert.deepEqual(modelOptions(c, 'codex', ''), [''])
})

test('the editor is $VISUAL, then $EDITOR, then the platform default', () => {
  assert.equal(editorCommand({ VISUAL: 'code --wait', EDITOR: 'nano' }, 'darwin'), 'code --wait')
  assert.equal(editorCommand({ EDITOR: 'nano' }, 'darwin'), 'nano')
  assert.equal(editorCommand({ EDITOR: '  ' }, 'linux'), 'vi')
  assert.equal(editorCommand({}, 'win32'), 'notepad')
})
