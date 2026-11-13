#!/usr/bin/env node
// Wait, silently, until a PR needs the agent: prints ONE JSON line and exits.
//
//   node pr-watch.mjs [--pr N] [--interval 60] [--state FILE] [--since-now] [--max-wait SEC] [--once]
//                     [--rebase-on-any-base-change]
//
// exit 10 {"event":"comments",...}  review items nobody answered and not reported before
// exit 11 {"event":"base","reason":"conflict"|"behind",...}
//                                   the head lacks base commits AND GitHub says the PR conflicts
//                                   (mergeable CONFLICTING) or must catch up (mergeStateStatus BEHIND).
//                                   A base that merely moved ahead is silent, and so is UNKNOWN
//                                   (GitHub still computing); --rebase-on-any-base-change reports
//                                   every new base commit the head lacks, as "behind" unless conflicting.
//                                   One report per base commit.
// exit 0  {"event":"merged"|"closed",...}
// exit 3  {"event":"timeout"}       --max-wait passed (or --once found nothing); run it again
// exit 2  {"event":"error",...}     setup failed, or GitHub kept failing
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { fetchBaseStatus, fetchPr, itemKey, pendingItems, repoNwo, resolvePrNumber } from './pr-lib.mjs'

export const EXIT = { done: 0, error: 2, timeout: 3, comments: 10, base: 11 }
const MIN_INTERVAL = 20
const MAX_BACKOFF = 300
const MAX_FAILURES = 10

export function parseArgs(argv) {
  const opts = { interval: 60, sinceNow: false, once: false, rebaseOnAnyBaseChange: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const value = () => {
      const v = argv[++i]
      if (v === undefined) throw new Error(`${arg} needs a value`)
      return v
    }
    if (arg === '--pr') opts.pr = value()
    else if (arg === '--interval') opts.interval = Math.max(MIN_INTERVAL, Number(value()) || 60)
    else if (arg === '--state') opts.state = value()
    else if (arg === '--max-wait') opts.maxWait = Number(value())
    else if (arg === '--since-now') opts.sinceNow = true
    else if (arg === '--once') opts.once = true
    else if (arg === '--rebase-on-any-base-change') opts.rebaseOnAnyBaseChange = true
    else throw new Error(`unknown option ${arg}`)
  }
  return opts
}

export function defaultStatePath(nwo, number, env = process.env) {
  const dir = env.VIBEFLOW_SCRATCH_DIR || os.tmpdir()
  return path.join(dir, `pr-watch-${nwo.replace('/', '-')}-${number}.json`)
}

export function readState(file) {
  try {
    const state = JSON.parse(fs.readFileSync(file, 'utf8'))
    return { seen: Array.isArray(state.seen) ? state.seen : [], baseOid: state.baseOid ?? null }
  } catch {
    return null
  }
}

export function writeState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(state)}\n`)
  fs.renameSync(tmp, file)
}

/**
 * Why the base branch needs the agent now: 'conflict' when GitHub reports the
 * PR cannot merge, 'behind' when branch protection requires catching up, null
 * otherwise. Both require the head to actually lack base commits, since
 * GitHub's status lags a push. UNKNOWN (still computing) is not an answer, so
 * it waits for the next poll. With rebaseOnAnyBaseChange every lacked base
 * commit counts.
 */
export function baseReason(pr, base, opts = {}) {
  if (!base || !(base.behindBy > 0)) return null
  if (pr.mergeable === 'CONFLICTING') return 'conflict'
  if (pr.mergeStateStatus === 'BEHIND' || opts.rebaseOnAnyBaseChange) return 'behind'
  return null
}

/**
 * What one poll means, given what was already reported. A finished PR wins,
 * then comments (answering them before a rebase keeps their line anchors
 * meaningful), then a base the PR must act on (see baseReason). A base already
 * reported at this commit is not reported again, so a rebase the agent could
 * not finish does not wake it in a loop.
 */
export function decide(pr, base, state, opts = {}) {
  if (pr.merged) return { event: { event: 'merged', pr: pr.number }, state }
  if (pr.state === 'CLOSED') return { event: { event: 'closed', pr: pr.number }, state }

  const seen = new Set(state.seen)
  const fresh = pendingItems(pr).filter((item) => !seen.has(itemKey(item)))
  if (fresh.length) {
    const keys = fresh.map(itemKey)
    return {
      event: { event: 'comments', pr: pr.number, count: fresh.length, items: keys },
      state: { ...state, seen: [...state.seen, ...keys] },
    }
  }
  const reason = baseReason(pr, base, opts)
  if (reason && base.oid !== state.baseOid) {
    return {
      event: { event: 'base', reason, pr: pr.number, base: pr.baseRefName, sha: base.oid, behindBy: base.behindBy },
      state: { ...state, baseOid: base.oid },
    }
  }
  return { event: null, state }
}

/** Mark everything already there as reported, for --since-now. */
export function baseline(pr, base, opts = {}) {
  return { seen: pendingItems(pr).map(itemKey), baseOid: baseReason(pr, base, opts) ? base.oid : null }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export async function watch(opts, deps = {}) {
  const env = deps.env ?? process.env
  const fetch = deps.fetch ?? ((nwo, n) => {
    const pr = fetchPr(nwo, n)
    // A finished PR's head branch is often deleted already, which the comparison cannot name.
    return { pr, base: pr.state === 'OPEN' ? fetchBaseStatus(nwo, pr) : null }
  })
  const wait = deps.sleep ?? sleep
  const now = deps.now ?? (() => Date.now())

  let nwo
  let number
  try {
    nwo = deps.nwo ?? repoNwo()
    number = deps.number ?? resolvePrNumber(opts.pr)
  } catch (err) {
    return { code: EXIT.error, event: { event: 'error', message: errorText(err) } }
  }
  const file = opts.state ?? defaultStatePath(nwo, number, env)
  let state = readState(file)
  const started = now()
  let failures = 0
  let first = true

  for (;;) {
    let polled
    try {
      polled = fetch(nwo, number)
      failures = 0
    } catch (err) {
      // A first poll that fails is a setup problem (no PR, gh signed out), not a blip.
      if (first || ++failures >= MAX_FAILURES) {
        return { code: EXIT.error, event: { event: 'error', pr: number, message: errorText(err) } }
      }
    }
    if (polled) {
      if (!state) {
        state = opts.sinceNow ? baseline(polled.pr, polled.base, opts) : { seen: [], baseOid: null }
        writeState(file, state)
      }
      const result = decide(polled.pr, polled.base, state, opts)
      if (result.event) {
        writeState(file, result.state)
        return { code: EXIT[result.event.event] ?? EXIT.done, event: result.event }
      }
    }
    first = false
    if (opts.once || (opts.maxWait && now() - started >= opts.maxWait * 1000)) {
      return { code: EXIT.timeout, event: { event: 'timeout', pr: number } }
    }
    const backoff = failures ? Math.min(MAX_BACKOFF, opts.interval * 2 ** failures) : opts.interval
    await wait(backoff * 1000)
  }
}

function errorText(err) {
  return String(err?.stderr || err?.message || err).trim().split('\n').slice(-3).join(' ')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let opts
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.log(JSON.stringify({ event: 'error', message: errorText(err) }))
    process.exit(EXIT.error)
  }
  const { code, event } = await watch(opts)
  console.log(JSON.stringify(event))
  process.exit(code)
}
