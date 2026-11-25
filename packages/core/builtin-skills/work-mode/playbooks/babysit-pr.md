# Playbook: existing PR

The PR is open; push it to mergeable — review comments, CI, base-branch conflicts.

## Steps

1. Confirm the PR belongs to the current branch and its author is the user (`gh pr view --json author,headRefName`); if not, review it instead of taking it over. Find this feature's existing spec.md and plan.md.
2. Make sure it is being watched: if not yet, call the `pr_watch_start` tool (without it, use the `pr-watch` skill).
3. Handle what woke you:
   - New review comments: sort and handle them with `address-review`. If a change alters confirmed behaviour or the agreed approach, mark spec.md / plan.md "awaiting re-confirmation" and update them; a detail fix only adds an entry to plan.md's implementation-and-verification log.
   - Failing CI: follow the `pr-watch` skill's "Failed checks" — read the full log, find the root cause, reproduce locally, then fix. Call something flaky only with evidence from reruns, never by default.
   - The base moved on or conflicts: follow the `pr-watch` skill's "Merge the base" — merge `origin/<base>` (never rebase and force-push), resolve conflicts unattended only when the repo's `.claude/pr.config.json` sets `verify_command` and an independent subagent agrees with the merge, then push normally. If a conflict involves a behaviour trade-off, stop and ask the user.
4. After each round, run the project's checks, commit, push and reply to the comments handled.
5. Wait for the next wake-up until the PR is merged or closed, then report its final state.

## Don't

- Skip tests, loosen lint rules or change test expectations to turn CI green.
- Merge the PR without the user's consent.
