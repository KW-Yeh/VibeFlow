import test from 'node:test'
import assert from 'node:assert/strict'
import {
  slugify,
  buildCandidateBranch,
} from '../main/helpers/branch-name.ts'

test('slugify — happy path', () => {
  assert.equal(slugify('Hello World'), 'hello-world')
  assert.equal(slugify('Add OAuth2 login flow'), 'add-oauth2-login-flow')
  assert.equal(slugify('feature/login@v2!!'), 'feature-login-v2')
})

test('slugify — collapses symbols and trims junk', () => {
  assert.equal(slugify('---fix---'), 'fix')
  assert.equal(slugify('  spaced   out  words '), 'spaced-out-words')
})

test('slugify — caps at 6 words', () => {
  assert.equal(
    slugify('one two three four five six seven eight'),
    'one-two-three-four-five-six'
  )
})

test('slugify — caps length at 48 and never ends with a hyphen', () => {
  const long = slugify(
    'alphaaaa bravooo charlieee deltaaaa echooooo foxtrott'
  )
  assert.ok(long.length <= 48, `length ${long.length} exceeds 48`)
  assert.doesNotMatch(long, /-$/, 'must not end with a hyphen')
})

test('slugify — returns null for unusable input', () => {
  assert.equal(slugify(''), null)
  assert.equal(slugify('   '), null)
  assert.equal(slugify('a'), null, 'too short')
  assert.equal(slugify('ab'), null, 'too short')
  assert.equal(slugify('12345'), null, 'digits only, no letter')
  assert.equal(slugify('修復登入錯誤'), null, 'pure CJK has no ASCII')
  assert.equal(slugify('!@#$%^&*'), null, 'symbols only')
})

test('slugify — accepts the minimal valid slug', () => {
  assert.equal(slugify('abc'), 'abc')
})

test('buildCandidateBranch — eBug code wins (fix/)', () => {
  assert.equal(
    buildCandidateBranch('Crash on save WCL260522-0002'),
    'fix/WCL260522-0002'
  )
})

test('buildCandidateBranch — eBug beats the looser Jira pattern', () => {
  // An eBug code also satisfies the Jira regex; the more specific format must win.
  assert.equal(
    buildCandidateBranch('WCL260522-0002 something'),
    'fix/WCL260522-0002'
  )
})

test('buildCandidateBranch — Jira key (feature/) regardless of fix wording', () => {
  assert.equal(buildCandidateBranch('Implement WR-4832'), 'feature/WR-4832')
  // Ticket path ignores the fix hint — it always yields feature/<key>.
  assert.equal(buildCandidateBranch('Fix bug WR-1'), 'feature/WR-1')
})

test('buildCandidateBranch — ticket detected from description too', () => {
  assert.equal(
    buildCandidateBranch('Update something', 'tracked in WR-99'),
    'feature/WR-99'
  )
})

test('buildCandidateBranch — slug path picks fix vs feature from wording', () => {
  assert.equal(
    buildCandidateBranch('Add dark mode toggle'),
    'feature/add-dark-mode-toggle'
  )
  assert.equal(buildCandidateBranch('Login crash on submit'), 'fix/login-crash-on-submit')
  // Chinese fix hint with an English title slug.
  assert.equal(
    buildCandidateBranch('Login page', '這個畫面會崩潰'),
    'fix/login-page'
  )
})

test('buildCandidateBranch — fix hint comes from the combined text', () => {
  assert.equal(
    buildCandidateBranch('Refactor module', 'there is a regression here'),
    'fix/refactor-module'
  )
})

test('buildCandidateBranch — ticket matching is case-sensitive (uppercase only)', () => {
  // A lowercase "ticket" is NOT recognised — it falls through to the slug path.
  assert.equal(
    buildCandidateBranch('wcl260522-0002'),
    'feature/wcl260522-0002'
  )
})

test('buildCandidateBranch — null when nothing meaningful is derivable', () => {
  assert.equal(buildCandidateBranch('修復登入'), null)
  assert.equal(buildCandidateBranch(''), null)
  assert.equal(buildCandidateBranch('!!!'), null)
})
