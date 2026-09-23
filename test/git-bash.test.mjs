import test from 'node:test'
import assert from 'node:assert/strict'
import { gitBashCandidates } from '../main/helpers/git-bash.ts'

test('gitBashCandidates — explicit overrides come before the install locations', () => {
  const candidates = gitBashCandidates({
    GIT_BASH_PATH: 'D:\\tools\\git\\bin\\bash.exe',
    CLAUDE_CODE_GIT_BASH_PATH: 'E:\\git\\bin\\bash.exe',
    ProgramFiles: 'C:\\Program Files',
  })
  assert.deepEqual(candidates.slice(0, 3), [
    'D:\\tools\\git\\bin\\bash.exe',
    'E:\\git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\bin\\bash.exe',
  ])
})

test('gitBashCandidates — covers per-user and scoop installs', () => {
  const candidates = gitBashCandidates({
    LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
    USERPROFILE: 'C:\\Users\\me',
  })
  assert.deepEqual(candidates, [
    'C:\\Users\\me\\AppData\\Local\\Programs\\Git\\bin\\bash.exe',
    'C:\\Users\\me\\scoop\\apps\\git\\current\\bin\\bash.exe',
  ])
})

test('gitBashCandidates — derives bash.exe from every layout git.exe ships in', () => {
  const candidates = gitBashCandidates({}, [
    'D:\\PortableGit\\cmd\\git.exe',
    'E:\\Git\\bin\\git.exe',
    'F:\\Git\\mingw64\\bin\\git.exe',
  ])
  assert.deepEqual(candidates, [
    'D:\\PortableGit\\bin\\bash.exe',
    'E:\\Git\\bin\\bash.exe',
    'F:\\Git\\bin\\bash.exe',
  ])
})

test('gitBashCandidates — ignores a git that is not a Git for Windows layout', () => {
  // A scoop shim or a wrapper somewhere else says nothing about where bash is.
  const candidates = gitBashCandidates({}, ['C:\\Users\\me\\scoop\\shims\\git.exe'])
  assert.deepEqual(candidates, [])
})
