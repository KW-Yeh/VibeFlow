import test from 'node:test'
import assert from 'node:assert/strict'
import {
  slugify,
  buildCandidateBranch,
  generateBranchName,
} from '../packages/core/src/branch-name.ts'

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

/** A translator that records its calls and answers with `answer` (or throws it). */
function spyTranslator(answer) {
  const calls = []
  const translate = async (title) => {
    calls.push(title)
    if (answer instanceof Error) throw answer
    return answer
  }
  return { translate, calls }
}

test('generateBranchName — short or letterless ASCII titles never reach the translator', async () => {
  const { translate, calls } = spyTranslator('some-slug')
  for (const title of ['S', 'QA', 'A', 'B', 'T', 'x', 'M', 'v1', '', '   ', '12345', '!@#']) {
    assert.equal(await generateBranchName(title, undefined, translate), null, JSON.stringify(title))
  }
  assert.deepEqual(calls, [])
})

test('generateBranchName — a Chinese title is translated and the result applied', async () => {
  const { translate, calls } = spyTranslator('login-flow')
  assert.equal(await generateBranchName('登入流程', undefined, translate), 'feature/login-flow')
  assert.equal(await generateBranchName('修復登入流程', undefined, translate), 'fix/login-flow')
  assert.deepEqual(calls, ['登入流程', '修復登入流程'])
})

test('generateBranchName — a title the local slug can read is not translated', async () => {
  const { translate, calls } = spyTranslator('unused')
  assert.equal(await generateBranchName('新增 dark mode 切換', undefined, translate), 'feature/dark-mode')
  assert.deepEqual(calls, [])
})

test('generateBranchName — a failed or unusable translation falls back', async () => {
  for (const answer of [null, '', '  ', '!!', 'a', '12', new Error('claude not found')]) {
    const { translate, calls } = spyTranslator(answer)
    assert.equal(await generateBranchName('登入流程', undefined, translate), null, String(answer))
    assert.equal(calls.length, 1)
  }
})

test('generateBranchName — a translation is re-sanitized before it becomes a ref', async () => {
  const { translate } = spyTranslator('Login Flow; rm -rf /')
  assert.equal(await generateBranchName('登入流程', undefined, translate), 'feature/login-flow-rm-rf')
})

test('generateBranchName — without a translator nothing is translated', async () => {
  assert.equal(await generateBranchName('登入流程'), null)
})
