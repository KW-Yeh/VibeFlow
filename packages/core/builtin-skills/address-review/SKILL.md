---
name: address-review
description: Read the unanswered review comments on the current branch's GitHub PR, sort them into a change plan, apply the changes, commit and push, and reply to every comment handled (the commit for a fix, the reason for a no-change). Use when the user says "address review", "handle the review comments", "look at the PR review", "review comments", "看 review", "整理 review", "處理 review comment", or when pr-watch reports new comments.
---

# Address PR review

Talk to the user in their language. Write PR replies in the language the reviewer used,
keeping code, identifiers, paths and SHAs verbatim.

Every GitHub call goes through the bundled script; do not call `gh` for these steps yourself.
`<skill>` below is this skill's directory (the folder holding this file):

```bash
node "<skill>/scripts/review.mjs" fetch  [PR]    # unanswered items only
node "<skill>/scripts/review.mjs" commit [PR]    # bullets on stdin → commit + push, prints short SHA
node "<skill>/scripts/review.mjs" reply  [PR]    # JSON array on stdin → replies
```

`PR` is `36` or `#36`; omit it for the current branch's PR. A non-zero exit from `fetch`
(no PR, `gh` not signed in) is blocking: tell the user and stop.

## When to stop for the user

Exactly one possible stop, step 4. Whether it happens:

| Situation | Step 4 |
| --- | --- |
| `VIBEFLOW_AUTO_MODE` is `1` | No stop. Apply the plan; items needing discussion are left unanswered and listed in the report. |
| Anything else (`0`, unset, invoked by hand) | Show the plan and wait for a yes. |

Everything else (fetch, reading code, commit, push, replies) runs without asking.

## 1. Fetch

Run `fetch`. It lists only what nobody has answered: review summaries, inline comments
in unresolved threads with no marked reply after them, and conversation comments
(PR-level, including reports bots and CI workflows post). Resolved threads and this
skill's own earlier replies are already filtered out.

If it prints `NOTHING PENDING`, say so and stop.

Note each item's id: `id=` (inline), `issue-id=` (conversation), `review-id=` (summary).

## 2. Read the code

The diff hunk under each inline comment is usually enough. Read the file around the line
only when it is not.

## 3. Classify

| Class | Meaning | Action |
| --- | --- | --- |
| Must fix | real bug, security, logic or performance problem | change it, reply with the commit |
| Adopt | sound improvement (readability, naming, structure) | change it, reply with the commit |
| No change | misreads the intent, does not apply here, or a style preference against the project's conventions | reply with the reason |
| Discuss | architecture or trade-off nobody here can decide alone | leave unanswered, report to the user |

Judge each comment by its content, never by who wrote it: a bot's report is reviewed like
a person's. Check the project's own instructions (`AGENTS.md`, `CLAUDE.md`) for conventions.

## 4. Plan

```
## PR #<n> review — <total> items: <fix> fix, <adopt> adopt, <no-change> no change, <discuss> discuss

### Fix / adopt
1. <path:line> — <summary> (@<reviewer>, id=<id>)
   Change: <what will change>
   Reply: <reply text>

### No change
1. <path:line> — <summary> (@<reviewer>, id=<id>)
   Reply: <reason>

### Discuss
1. <path:line> — <summary> (@<reviewer>) — <the open question>
```

If step 4 stops (see the table), ask whether to go ahead; the user may exclude items by
number. Adjust only what they named, then carry on without asking again.

## 5. Apply, commit, push

1. Edit the files for every fix/adopt item, then `git diff` to check it matches the plan.
2. Run the project's affected checks (typecheck, tests) before committing. A failure you
   cannot fix is reported, not committed around.
3. Commit and push in one call:

   ```bash
   printf -- '- <change 1>\n- <change 2>\n' | node "<skill>/scripts/review.mjs" commit <PR>
   ```

   It prints the short SHA, or `NO CHANGES` when every item was no-change.

## 6. Reply

One call, every reply at once:

```bash
cat <<'JSON' | node "<skill>/scripts/review.mjs" reply <PR>
[
  {"id": 123, "body": "Fixed in abc1234: <what changed>."},
  {"id": 124, "body": "<why no change>"},
  {"body": "<one answer to the conversation comments / review summaries>"}
]
JSON
```

- `{"id": …}` replies in an inline thread. Items without `id` become one PR-level comment;
  merge all conversation and summary answers into it.
- The script appends a hidden marker to every reply. That marker is how the next `fetch`
  (and pr-watch) knows these items are answered, so always reply through the script, and
  post one PR-level reply whenever a round handled any review summary or conversation comment.
- No thank-you preamble when answering a bot.

## 7. Report

Commit SHA and PR link; the items fixed, the items answered with no change, the items left
for discussion, and anything that failed. Inside a VibeFlow card with `VIBEFLOW_MASTER_ID`
set, the same report goes to the master with `task send`.
