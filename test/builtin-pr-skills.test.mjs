import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { HANDLED_MARKER, itemKey, pendingItems } from '../packages/core/builtin-skills/pr-watch/scripts/pr-lib.mjs'
import {
  EXIT,
  baseline,
  decide,
  defaultStatePath,
  parseArgs,
  readState,
  watch,
} from '../packages/core/builtin-skills/pr-watch/scripts/pr-watch.mjs'
import { formatPending } from '../packages/core/builtin-skills/address-review/scripts/review.mjs'

const SKILLS = path.resolve('packages/core/builtin-skills')
const WATCH_SCRIPT = path.join(SKILLS, 'pr-watch', 'scripts', 'pr-watch.mjs')
const REVIEW_SCRIPT = path.join(SKILLS, 'address-review', 'scripts', 'review.mjs')

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-pr-skills-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

const comment = (id, body, createdAt, extra = {}) => ({ databaseId: id, author: { login: 'rev' }, body, createdAt, ...extra })

function makePr(overrides = {}) {
  return {
    number: 7,
    title: 'Add thing',
    state: 'OPEN',
    merged: false,
    headRefName: 'feat/thing',
    headRefOid: 'h1',
    baseRefName: 'main',
    isCrossRepository: false,
    reviews: { nodes: [] },
    comments: { nodes: [] },
    reviewThreads: { nodes: [] },
    ...overrides,
  }
}

const thread = (comments, isResolved = false) => ({ isResolved, comments: { nodes: comments } })
const inline = (id, body, at) => comment(id, body, at, { path: 'a.ts', line: 3, diffHunk: '@@ -1 +1 @@' })
const EMPTY_STATE = { seen: [], baseOid: null }

test('both skills ship the same pr-lib.mjs', () => {
  const a = fs.readFileSync(path.join(SKILLS, 'pr-watch', 'scripts', 'pr-lib.mjs'), 'utf8')
  const b = fs.readFileSync(path.join(SKILLS, 'address-review', 'scripts', 'pr-lib.mjs'), 'utf8')
  assert.equal(a, b)
})

test('pendingItems — resolved threads, empty bodies and answered threads do not count', () => {
  const pr = makePr({
    reviewThreads: {
      nodes: [
        thread([inline(1, 'resolved one', '2026-01-01T00:00:00Z')], true),
        thread([inline(2, 'fix this', '2026-01-01T00:00:00Z'), inline(3, `done\n\n${HANDLED_MARKER}`, '2026-01-02T00:00:00Z')]),
        thread([inline(4, 'and this', '2026-01-03T00:00:00Z'), inline(5, '   ', '2026-01-03T00:00:00Z')]),
      ],
    },
  })
  assert.deepEqual(pendingItems(pr).map(itemKey), ['inline:4'])
})

test('pendingItems — a follow-up after a marked reply reopens the thread', () => {
  const pr = makePr({
    reviewThreads: {
      nodes: [thread([
        inline(2, 'fix this', '2026-01-01T00:00:00Z'),
        inline(3, `done\n\n${HANDLED_MARKER}`, '2026-01-02T00:00:00Z'),
        inline(6, 'not quite', '2026-01-03T00:00:00Z'),
      ])],
    },
  })
  assert.deepEqual(pendingItems(pr).map(itemKey), ['inline:6'])
})

test('pendingItems — summaries and conversation comments count until a marked reply follows them', () => {
  const pr = makePr({
    reviews: {
      nodes: [
        { databaseId: 10, author: { login: 'bot' }, state: 'COMMENTED', body: 'old summary', createdAt: '2026-01-01T00:00:00Z' },
        { databaseId: 11, author: { login: 'rev' }, state: 'APPROVED', body: '', createdAt: '2026-01-05T00:00:00Z' },
        { databaseId: 12, author: { login: 'rev' }, state: 'CHANGES_REQUESTED', body: 'new summary', createdAt: '2026-01-05T00:00:00Z' },
      ],
    },
    comments: {
      nodes: [
        comment(20, 'ci report', '2026-01-01T00:00:00Z'),
        comment(21, `answered\n\n${HANDLED_MARKER}`, '2026-01-02T00:00:00Z'),
        comment(22, 'late question', '2026-01-06T00:00:00Z'),
      ],
    },
  })
  assert.deepEqual(pendingItems(pr).map(itemKey), ['review:12', 'conversation:22'])
})

test('decide — a finished PR wins over everything else', () => {
  const busy = { comments: { nodes: [comment(1, 'hi', '2026-01-01T00:00:00Z')] } }
  assert.equal(decide(makePr({ ...busy, merged: true, state: 'MERGED' }), { oid: 'b', behindBy: 2 }, EMPTY_STATE).event.event, 'merged')
  assert.equal(decide(makePr({ ...busy, state: 'CLOSED' }), null, EMPTY_STATE).event.event, 'closed')
})

test('decide — comments come before a moved base, and are reported once', () => {
  const pr = makePr({ mergeStateStatus: 'BEHIND', comments: { nodes: [comment(1, 'hi', '2026-01-01T00:00:00Z')] } })
  const base = { oid: 'b2', behindBy: 1 }
  const first = decide(pr, base, EMPTY_STATE)
  assert.deepEqual(first.event, { event: 'comments', pr: 7, count: 1, items: ['conversation:1'] })
  const second = decide(pr, base, first.state)
  assert.equal(second.event.event, 'base')
  assert.equal(second.event.reason, 'behind')
  assert.equal(second.event.sha, 'b2')
  assert.equal(decide(pr, base, second.state).event, null, 'the same base commit is not reported twice')
  assert.equal(decide(pr, { oid: 'b3', behindBy: 2 }, second.state).event.event, 'base', 'a newer base commit is')
})

test('decide — an up-to-date head or a fork PR never asks for a rebase', () => {
  assert.equal(decide(makePr(), { oid: 'b2', behindBy: 0 }, EMPTY_STATE).event, null)
  assert.equal(decide(makePr(), null, EMPTY_STATE).event, null)
})

test('decide — a base that only moved ahead does not wake the agent', () => {
  const base = { oid: 'b2', behindBy: 3 }
  assert.equal(decide(makePr({ mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' }), base, EMPTY_STATE).event, null)
  assert.equal(decide(makePr({ mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED' }), base, EMPTY_STATE).event, null)
  assert.equal(decide(makePr(), base, EMPTY_STATE).event, null, 'fields missing')
})

test('decide — CONFLICTING reports a conflict, BEHIND reports a catch-up', () => {
  const base = { oid: 'b2', behindBy: 1 }
  const conflict = decide(makePr({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }), base, EMPTY_STATE)
  assert.deepEqual(conflict.event, { event: 'base', reason: 'conflict', pr: 7, base: 'main', sha: 'b2', behindBy: 1 })
  const behind = decide(makePr({ mergeable: 'MERGEABLE', mergeStateStatus: 'BEHIND' }), base, EMPTY_STATE)
  assert.equal(behind.event.reason, 'behind')
  const both = decide(makePr({ mergeable: 'CONFLICTING', mergeStateStatus: 'BEHIND' }), base, EMPTY_STATE)
  assert.equal(both.event.reason, 'conflict')
})

test('decide — UNKNOWN is no event, and a head that is not behind never asks for a rebase', () => {
  const base = { oid: 'b2', behindBy: 1 }
  assert.equal(decide(makePr({ mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' }), base, EMPTY_STATE).event, null)
  assert.equal(decide(makePr({ mergeable: 'CONFLICTING' }), { oid: 'b2', behindBy: 0 }, EMPTY_STATE).event, null)
  assert.equal(decide(makePr({ mergeStateStatus: 'BEHIND' }), null, EMPTY_STATE).event, null)
})

test('decide — --rebase-on-any-base-change restores waking on every new base commit', () => {
  const opts = { rebaseOnAnyBaseChange: true }
  const pr = makePr({ mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' })
  const first = decide(pr, { oid: 'b2', behindBy: 1 }, EMPTY_STATE, opts)
  assert.equal(first.event.reason, 'behind')
  assert.equal(decide(pr, { oid: 'b2', behindBy: 1 }, first.state, opts).event, null)
  assert.equal(decide(pr, { oid: 'b3', behindBy: 2 }, first.state, opts).event.sha, 'b3')
  assert.equal(parseArgs(['--rebase-on-any-base-change']).rebaseOnAnyBaseChange, true)
  assert.equal(parseArgs([]).rebaseOnAnyBaseChange, false)
})

test('baseline — a base that would not wake the agent is not recorded as reported', () => {
  const quiet = makePr({ mergeStateStatus: 'CLEAN' })
  assert.equal(baseline(quiet, { oid: 'b1', behindBy: 3 }).baseOid, null)
  assert.equal(baseline(quiet, { oid: 'b1', behindBy: 3 }, { rebaseOnAnyBaseChange: true }).baseOid, 'b1')
})

test('baseline — --since-now treats what is already there as reported', () => {
  const pr = makePr({ mergeStateStatus: 'BEHIND', comments: { nodes: [comment(1, 'hi', '2026-01-01T00:00:00Z')] } })
  const state = baseline(pr, { oid: 'b1', behindBy: 3 })
  assert.equal(decide(pr, { oid: 'b1', behindBy: 3 }, state).event, null)
})

test('parseArgs — interval has a floor and unknown flags fail', () => {
  assert.equal(parseArgs(['--interval', '5']).interval, 20)
  assert.equal(parseArgs(['--pr', '#7', '--since-now']).pr, '#7')
  assert.throws(() => parseArgs(['--bogus']), /unknown option/)
  assert.throws(() => parseArgs(['--pr']), /needs a value/)
})

test('defaultStatePath — lives in the card scratch dir when there is one', () => {
  assert.equal(
    defaultStatePath('o/r', 7, { VIBEFLOW_SCRATCH_DIR: '/s' }),
    path.join('/s', 'pr-watch-o-r-7.json')
  )
  assert.equal(path.dirname(defaultStatePath('o/r', 7, {})), os.tmpdir())
})

function harness(t, polls) {
  const dir = tmp(t)
  const state = path.join(dir, 'state.json')
  const waits = []
  let i = 0
  const deps = {
    nwo: 'o/r',
    number: 7,
    env: {},
    sleep: async (ms) => { waits.push(ms) },
    fetch: () => {
      const next = polls[Math.min(i++, polls.length - 1)]
      if (next instanceof Error) throw next
      return next
    },
  }
  return { state, waits, deps, polled: () => i }
}

test('watch — waits silently until something happens, then persists what it reported', async (t) => {
  const quiet = { pr: makePr(), base: { oid: 'b1', behindBy: 0 } }
  const busy = { pr: makePr({ comments: { nodes: [comment(1, 'hi', '2026-01-01T00:00:00Z')] } }), base: quiet.base }
  const h = harness(t, [quiet, quiet, busy])
  const result = await watch({ interval: 60, state: h.state }, h.deps)
  assert.equal(result.code, EXIT.comments)
  assert.deepEqual(h.waits, [60_000, 60_000])
  assert.deepEqual(readState(h.state).seen, ['conversation:1'])

  const again = harness(t, [busy])
  const rerun = await watch({ interval: 60, state: h.state, once: true }, again.deps)
  assert.equal(rerun.code, EXIT.timeout, 'a restart does not report the same comment again')
})

test('watch — a first poll that fails is a setup error', async (t) => {
  const h = harness(t, [new Error('HTTP 404: Not Found')])
  const result = await watch({ interval: 60, state: h.state }, h.deps)
  assert.equal(result.code, EXIT.error)
  assert.match(result.event.message, /404/)
})

test('watch — later failures back off and recover', async (t) => {
  const quiet = { pr: makePr(), base: null }
  const h = harness(t, [quiet, new Error('502'), new Error('502'), { pr: makePr({ merged: true }), base: null }])
  const result = await watch({ interval: 60, state: h.state }, h.deps)
  assert.equal(result.code, EXIT.done)
  assert.equal(result.event.event, 'merged')
  assert.deepEqual(h.waits, [60_000, 120_000, 240_000])
})

test('watch — gives up after repeated failures', async (t) => {
  const h = harness(t, [{ pr: makePr(), base: null }, new Error('timeout')])
  const result = await watch({ interval: 60, state: h.state }, h.deps)
  assert.equal(result.code, EXIT.error)
  assert.equal(h.polled(), 11)
  assert.ok(h.waits.every((ms) => ms <= 300_000), 'backoff is capped')
})

test('watch — --max-wait ends a quiet watch with a timeout', async (t) => {
  let clock = 0
  const h = harness(t, [{ pr: makePr(), base: null }])
  h.deps.now = () => clock
  h.deps.sleep = async (ms) => { clock += ms }
  const result = await watch({ interval: 60, state: h.state, maxWait: 150 }, h.deps)
  assert.equal(result.code, EXIT.timeout)
})

test('formatPending — says when nothing is pending', () => {
  assert.match(formatPending(makePr(), []), /NOTHING PENDING/)
})

// --- the scripts as the agent runs them, against a fake gh ---

const FAKE_GH = `
import fs from 'node:fs'
const args = process.argv.slice(2)
fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify(args) + '\\n')
const fixture = JSON.parse(fs.readFileSync(process.env.FAKE_GH_FIXTURE, 'utf8'))
if (args[0] === 'repo') process.stdout.write('o/r\\n')
else if (args[0] === 'pr') process.stdout.write('7\\n')
else if (args[0] === 'api' && args[1] === 'graphql') {
  const query = args.find((a) => a.startsWith('query=')) ?? ''
  process.stdout.write(JSON.stringify(query.includes('compare(')
    ? { data: { repository: { ref: { target: { oid: 'b9' }, compare: { behindBy: 2 } } } } }
    : { data: { repository: { pullRequest: fixture } } }))
} else process.stdout.write('1\\n')
`

function fakeGh(t, pr) {
  const dir = tmp(t)
  const script = path.join(dir, 'gh.mjs')
  const fixture = path.join(dir, 'pr.json')
  const log = path.join(dir, 'log.jsonl')
  fs.writeFileSync(script, FAKE_GH)
  fs.writeFileSync(fixture, JSON.stringify(pr))
  fs.writeFileSync(log, '')
  const env = {
    ...process.env,
    NODE_OPTIONS: '',
    VIBEFLOW_GH_CMD: JSON.stringify([process.execPath, script]),
    FAKE_GH_FIXTURE: fixture,
    FAKE_GH_LOG: log,
    VIBEFLOW_SCRATCH_DIR: dir,
  }
  const calls = () => fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  return { env, calls, dir }
}

test('pr-watch.mjs — prints one JSON line and exits with the event code', (t) => {
  const { env, calls } = fakeGh(t, makePr({ mergeable: 'MERGEABLE', mergeStateStatus: 'BEHIND' }))
  const run = spawnSync(process.execPath, [WATCH_SCRIPT, '--pr', '7'], { env, encoding: 'utf8' })
  assert.equal(run.status, EXIT.base, run.stderr)
  assert.deepEqual(JSON.parse(run.stdout.trim()), { event: 'base', reason: 'behind', pr: 7, base: 'main', sha: 'b9', behindBy: 2 })
  assert.equal(run.stdout.trim().split('\n').length, 1)
  const graphql = calls().filter((c) => c[0] === 'api' && c[1] === 'graphql')
  assert.equal(graphql.length, 2, 'one poll is the PR query plus the base comparison')
})

test('review.mjs fetch — lists only unanswered items', (t) => {
  const pr = makePr({
    reviewThreads: { nodes: [thread([inline(4, 'rename this', '2026-01-03T00:00:00Z')]), thread([inline(1, 'x', '2026-01-01T00:00:00Z')], true)] },
  })
  const { env } = fakeGh(t, pr)
  const out = execFileSync(process.execPath, [REVIEW_SCRIPT, 'fetch', '7'], { env, encoding: 'utf8' })
  assert.match(out, /\[id=4\] a\.ts:3  @rev/)
  assert.doesNotMatch(out, /\[id=1\]/)
})

test('review.mjs reply — every reply carries the handled marker', (t) => {
  const { env, calls } = fakeGh(t, makePr())
  const input = JSON.stringify([{ id: 4, body: 'Fixed in abc1234.' }, { body: 'Answered the summary.' }])
  const out = execFileSync(process.execPath, [REVIEW_SCRIPT, 'reply', '7'], { env, encoding: 'utf8', input })
  assert.match(out, /replied to review comment 4/)
  const posts = calls().filter((c) => c.includes('POST'))
  assert.equal(posts.length, 2)
  assert.ok(posts[0].includes('repos/o/r/pulls/7/comments') && posts[0].includes('in_reply_to=4'))
  assert.ok(posts[1].includes('repos/o/r/issues/7/comments'))
  for (const post of posts) {
    assert.ok(post.find((a) => a.startsWith('body=')).endsWith(HANDLED_MARKER))
  }
})
