---
name: pr-watch
description: Watch a GitHub pull request until it is merged or closed, waking only when it needs work — new review comments are handled with address-review, a base branch that moved ahead is rebased onto. Use when the user asks to watch, monitor, follow or babysit a PR, or says "監聽 PR", "盯著 PR", "看著這個 PR", "PR 有 comment 就處理", "watch the PR", "keep an eye on the PR".
---

# Watch a PR

Talk to the user in their language.

The waiting is done by a script, not by you: it polls GitHub quietly and exits with one
JSON line only when there is something to do. Never poll GitHub yourself in a loop, and
never read the script's output while it runs — wait for it to exit.

`<skill>` below is this skill's directory (the folder holding this file).

## 1. Start

Find the PR: the number the user gave, else the current branch's (`gh pr view --json number -q .number`).
No PR → tell the user and stop.

Launch the watcher:

```bash
node "<skill>/scripts/pr-watch.mjs" --pr <n>
```

- **Claude Code**: run it with `run_in_background: true`. You are woken when it exits; it
  costs nothing while it waits. Tell the user in one line that the PR is being watched.
- **Codex** (no background notification): run it in the foreground with
  `--max-wait 1500` and a command timeout above that; on `timeout`, run it again.

Options: `--interval <sec>` (default 60, min 20); `--since-now` to skip items that are
already there when watching starts (by default they are reported on the first poll, so a
backlog gets handled first); `--state <file>` (default: under `$VIBEFLOW_SCRATCH_DIR`, or
the system temp dir).

## 2. On exit

| Exit | Event | Do |
| --- | --- | --- |
| 10 | `comments` | Run the **address-review** skill for this PR. |
| 11 | `base` | Rebase (step 3). |
| 0 | `merged` / `closed` | Report and stop. Do not restart. |
| 3 | `timeout` | Restart the watcher as it was. |
| 2 | `error` | Report the message and stop. |

After handling `comments` or `base`, restart the watcher with the same options unless
the handling stopped (see below). The watcher remembers what it already reported, so a
restart never re-reports the same comments or the same base commit.

Whether to stop for the user follows `VIBEFLOW_AUTO_MODE`:

- `1` → handle the event end to end (address-review applies and replies on its own; the
  rebase is pushed), then restart.
- anything else → address-review shows its plan and waits; for a rebase, show what will be
  rebased and wait. Watching is paused meanwhile; restart it once the user's answer is
  carried out. Say so when you pause.

## 3. Rebase

```bash
git status --porcelain            # must be empty; otherwise stop and tell the user
git fetch origin <base>
git rebase origin/<base>
```

- Conflict → `git rebase --abort`, report the conflicting files, and **stop watching**,
  whatever the auto mode. Never resolve conflicts unattended.
- Clean → run the project's affected checks (typecheck, tests). A failure stops watching
  and is reported; nothing is pushed.
- Passed → `git push --force-with-lease`, then restart the watcher.

## 4. Report

After every event: one or two lines on what happened (comments answered, rebased onto
which commit, or why watching stopped). Inside a VibeFlow card with `VIBEFLOW_MASTER_ID`
set, send the same lines to the master with `task send`.
