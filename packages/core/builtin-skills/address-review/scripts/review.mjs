#!/usr/bin/env node
// address-review's only interface to GitHub. Three subcommands:
//   fetch  [PR]   compact list of the review items nobody has answered yet
//   commit [PR]   stage everything, commit with the bullets on stdin, push; prints the short SHA
//   reply  [PR]   post the replies in the JSON array on stdin, each marked as handled
// PR is `36`, `#36`, or omitted for the current branch's PR.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import {
  HANDLED_MARKER,
  fetchPr,
  gh,
  pendingItems,
  repoNwo,
  resolvePrNumber,
} from './pr-lib.mjs'

const SUMMARY_LIMIT = 400

function oneLine(text, limit) {
  const flat = text.replace(/\s*\n\s*/g, '  ').trim()
  return flat.length > limit ? `${flat.slice(0, limit)} …(truncated)` : flat
}

export function formatPending(pr, items) {
  const out = [`## PR #${pr.number} — ${pr.title}  [${pr.state}  ${pr.headRefName} → ${pr.baseRefName}]`, '']
  const reviews = items.filter((i) => i.kind === 'review')
  const inline = items.filter((i) => i.kind === 'inline')
  const conversation = items.filter((i) => i.kind === 'conversation')

  if (reviews.length) {
    out.push('### Review summaries')
    for (const r of reviews) out.push(`[review-id=${r.id}] @${r.author} (${r.state}): ${oneLine(r.body, SUMMARY_LIMIT)}`)
    out.push('')
  }
  out.push(`### Unanswered inline comments (${inline.length})`, '')
  if (!inline.length) out.push('_(none)_', '')
  for (const c of inline) {
    out.push(`[id=${c.id}] ${c.path}:${c.line ?? '?'}  @${c.author}`, '```diff', c.diffHunk ?? '', '```', c.body, '')
  }
  out.push(`### Unanswered conversation comments (${conversation.length})`, '')
  if (!conversation.length) out.push('_(none)_', '')
  for (const c of conversation) out.push(`[issue-id=${c.id}] @${c.author}`, c.body, '')
  if (!items.length) out.push('NOTHING PENDING')
  return out.join('\n')
}

function readStdin() {
  return fs.readFileSync(0, 'utf8')
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
}

function commit(number, bullets) {
  if (!bullets.trim()) throw new Error('commit needs the summary bullets on stdin')
  git(['add', '-A'])
  try {
    execFileSync('git', ['diff', '--cached', '--quiet'], { stdio: 'ignore' })
    return 'NO CHANGES'
  } catch {
    // staged changes present
  }
  git(['commit', '-q', '-m', `Address PR #${number} review comments\n\n${bullets.trim()}\n`])
  execFileSync('git', ['push', '--quiet'], { stdio: ['ignore', 'inherit', 'inherit'] })
  return git(['rev-parse', '--short=7', 'HEAD']).trim()
}

function reply(nwo, number, json) {
  let rows
  try {
    rows = JSON.parse(json)
  } catch {
    throw new Error('reply needs a JSON array on stdin')
  }
  if (!Array.isArray(rows)) throw new Error('reply needs a JSON array on stdin')
  let failed = 0
  for (const row of rows) {
    const body = `${String(row.body ?? '').trim()}\n\n${HANDLED_MARKER}`
    const inline = row.id !== undefined && row.id !== null
    const args = inline
      ? ['api', `repos/${nwo}/pulls/${number}/comments`, '--method', 'POST', '-f', `body=${body}`, '-F', `in_reply_to=${row.id}`]
      : ['api', `repos/${nwo}/issues/${number}/comments`, '--method', 'POST', '-f', `body=${body}`]
    try {
      gh([...args, '--jq', '.id'])
      console.log(inline ? `ok  replied to review comment ${row.id}` : 'ok  posted PR conversation comment')
    } catch (err) {
      failed += 1
      console.error(inline ? `FAILED reply to review comment ${row.id}` : 'FAILED to post PR conversation comment')
      console.error(String(err.stderr || err.message).trim())
    }
  }
  return failed
}

function main(argv) {
  const [command, prArg] = argv
  if (!['fetch', 'commit', 'reply'].includes(command)) {
    console.error('usage: review.mjs fetch|commit|reply [PR]')
    return 2
  }
  const number = resolvePrNumber(prArg)
  if (command === 'commit') {
    console.log(commit(number, readStdin()))
    return 0
  }
  const nwo = repoNwo()
  if (command === 'reply') return reply(nwo, number, readStdin()) ? 1 : 0
  const pr = fetchPr(nwo, number)
  console.log(formatPending(pr, pendingItems(pr)))
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (err) {
    console.error(`ERROR: ${String(err.stderr || err.message).trim()}`)
    process.exitCode = 2
  }
}
