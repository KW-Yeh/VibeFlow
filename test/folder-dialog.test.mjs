import test from 'node:test'
import assert from 'node:assert/strict'
import { folderDialogCommands, parseFolderDialogOutput } from '../packages/core/src/folder-dialog.ts'

test('macOS passes the prompt and start folder as argv, never inside the script', () => {
  const [mac] = folderDialogCommands('darwin', { title: 'Pick "it"', defaultPath: '/Users/me/My Repo' })
  assert.equal(mac.cmd, 'osascript')
  assert.deepEqual(mac.args.slice(-2), ['Pick "it"', '/Users/me/My Repo'])
  const script = mac.args.filter((_, i) => mac.args[i - 1] === '-e').join('\n')
  assert.ok(!script.includes('My Repo') && !script.includes('Pick'))
  assert.deepEqual(mac.cancelCodes, [1])
  assert.ok(mac.cancelStderr.test('execution error: User canceled. (-128)'))
  assert.equal(folderDialogCommands('darwin', { title: 't' })[0].args.at(-1), 't')
})

test('Windows hands the prompt and start folder over in the environment', () => {
  const [win] = folderDialogCommands('win32', { title: "a'; rm", defaultPath: 'C:\\code' })
  assert.equal(win.cmd, 'powershell.exe')
  assert.ok(!win.args.join(' ').includes("a'; rm"))
  assert.deepEqual(win.env, { VIBEFLOW_DIALOG_TITLE: "a'; rm", VIBEFLOW_DIALOG_PATH: 'C:\\code' })
})

test('Linux tries zenity, then kdialog', () => {
  const cmds = folderDialogCommands('linux', { defaultPath: '/home/me/' })
  assert.deepEqual(cmds.map((c) => c.cmd), ['zenity', 'kdialog'])
  assert.ok(cmds[0].args.includes('--filename=/home/me/'))
  assert.ok(cmds[0].args.includes('--title=選擇資料夾'))
})

test('the printed folder loses its trailing separator, roots keep theirs', () => {
  assert.equal(parseFolderDialogOutput('/Users/me/repo/\n'), '/Users/me/repo')
  assert.equal(parseFolderDialogOutput('C:\\code\\app\r\n'), 'C:\\code\\app')
  assert.equal(parseFolderDialogOutput('/\n'), '/')
  assert.equal(parseFolderDialogOutput('C:\\\r\n'), 'C:\\')
  assert.equal(parseFolderDialogOutput('\n'), null)
})
