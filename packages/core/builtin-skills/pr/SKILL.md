---
name: pr
description: Create or update a GitHub draft pull request for the current branch with gh — conventional-commit title and an English body picked by PR type (feat / fix / refactor / perf / deps / tooling) that covers goal, current state, main obstacle and merge risk, written only from this branch's diff and backed by evidence that was actually run. Use when the user says "open a PR", "create PR", "建立 PR", "開 PR", or "/pr #123" to update an existing one.
---

# Pull request

Talk to the user in their language. Write the PR title and body in English.

## 1. Mode

- Argument is a number or `#number` → **update** that PR (`gh pr edit`).
- Anything else (an issue reference, or nothing) → **create** a new draft PR.

## 2. Check the branch

Run and read:

```bash
git branch --show-current
git status --short
gh repo view --json defaultBranchRef -q .defaultBranchRef.name
```

- On the default branch → stop and tell the user to create a feature branch first.
- Uncommitted changes → tell the user and ask whether to commit them first; do not commit on your own.
- Update mode: `gh pr view <n> --json headRefName,baseRefName` — if `headRefName` is not the current
  branch, stop and tell the user; never rewrite another branch's PR with this diff.
- Base: in update mode the PR's `baseRefName`; otherwise the default branch.
- Push what the PR is about to describe:
  - No upstream yet (`git rev-parse --abbrev-ref @{upstream}` fails) → `git push -u origin HEAD`.
  - Upstream exists but lacks commits (`git rev-list --count @{upstream}..HEAD` is above 0) → `git push`.

## 3. Read the change

```bash
git fetch origin <base>
git log --oneline origin/<base>..HEAD
git diff --stat origin/<base>...HEAD
git diff origin/<base>...HEAD
```

Describe **only** this diff — nothing the base branch already had. If the diff is too large to read
whole, use `--stat` to pick the files that matter and read those.

## 4. Write it

**Title:** conventional commit — `<type>(<scope>): <summary>`, 70 characters at most.
`type` is one of `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `build`, `ci`, `chore`, picked by
what the diff does (a bug fix is always `fix`), not by the issue tracker's own type name.
Add `scope` only when one area clearly owns the change. Imperative, lower-case start, no trailing
period, no quotes — put identifiers in backticks.

**Body:** a one-minute briefing for a reviewer who already has the diff — about 40 lines, no
trial-and-error log, no file-by-file list, no big tables.

### 4a. Slots

Every body covers four things, always in this order; the headings change with the PR type:

| Slot | Answers | Heading |
|---|---|---|
| ① Goal | What becomes true once this merges? | `## Summary` |
| ② Current state | What was the state, symptom or number before? | by type, see 4b |
| ③ Main obstacle | What made this not simple, and how was it crossed? | by type, see 4b |
| ①' Goal check | What proves ① happened? What was not checked? | `## Evidence` |
| ④ Constraints | What must not break, who is affected, can it be undone, what is left out? | `## Merge Danger` |

- `Evidence` must map back to the goals in `Summary`.
- ② / ③ headings may be dropped only when `Summary` already covers them (for `tooling`).
- Any other section with nothing to say is left out entirely — no empty shells, no "None".
- Diagrams (Mermaid) go under ③ as `### <name>`; without a ③ section, as `## <name>` before `Evidence`.

### 4b. Template by type

Pick by the title's `type` and the shape of the diff. A PR mixing several kinds uses the riskiest
template (`fix` > `feat` > `perf` > `refactor` > `deps` > `tooling`) — and suggest splitting it in your
report to the user, not in the body.

| Template | When | ② | ③ |
|---|---|---|---|
| `feat` | `feat` | `## Context`: what is missing, why now | `## Approach`: key design decisions; "why not X" only where a reviewer will surely ask |
| `fix` | `fix` | `## Root Cause` (also carries ③, see 4e) | `## Solution` (see 4e) + `## Changes`: implementation bullets for the reviewer |
| `refactor` | `refactor` | `## Before`: where the structure hurts, with numbers if possible | `## Approach`: the hard part and the move order; suggest reading by commit |
| `perf` | `perf` | `## Baseline`: numbers before and how they were measured | `## Bottleneck`: where the time or resource went (profile evidence), what was done |
| `deps` | `chore` / `build` / `ci` touching dependencies, lock files, build or CI config | `## Context`: why now (CVE, EOL, needed feature) | `## Breaking Changes`: changelog items that affect this repo; else "checked X→Y changelog, nothing affects this repo" |
| `tooling` | `docs` / `test` / `chore` with **no** runtime code | in `Summary` | in `Summary`: bullets of non-obvious decisions and why |

`Summary` focus: `feat` — what a user or the system can do now; `fix` — what users saw in which
situation and what they see now; `refactor` — the structural goal, and say outright that external
behaviour is unchanged; `perf` — target metric and value; `deps` — what moves from which version to
which and why; `tooling` — one sentence, then the decision bullets.

### 4c. `## Evidence`

```markdown
## Evidence
- **Before:** <state before, tied to the Summary goal>
  **After:** <state after; nest bullets for several>
- **Verified by:** `<command or app path actually run>` → <result>
- **Verified at:** `<git rev-parse --short HEAD when it was run>`
- **Not verified:** <what was not checked, and why>
```

- Only what was actually run counts: a command, a test, a reproduction in the app. "The diff should
  do it" is not evidence. Never invent a command or a result.
- Nothing was run → drop `Verified by` and write "not verified by running anything" under `Not verified`.
- Committed again after verifying → rerun on the last commit, or say under `Not verified` that the
  evidence is from `<sha>` with N later commits unverified. visual-parity reports carry this `commit`.
- `Not verified` says "None" only when everything really was checked.
- `refactor` proves behaviour is unchanged (same tests pass before and after); `perf` gives one main
  number as `before → after` with units; `deps` gives install, build and test results.

### 4d. `## Merge Danger`

```markdown
## Merge Danger

**Door:** two-way | one-way — <for one-way: why, and the rollback or compatibility plan>

**Blast Radius:** <who or what this touches, and why it is safe or risky>

**Invariants:** <what must keep holding>          ← optional; required for refactor

**Out of Scope:** <deliberately not done, known gaps, follow-up PRs>   ← optional
```

- **one-way** when it changes persisted data shape (DB schema, localStorage, cookies, URL query,
  config or cache formats) — give the migration — or a contract (exported types, shared component
  props, API response fields, analytics event names, CSS classes selected from outside) — list every
  consumer under Blast Radius. Otherwise, if a revert fully undoes it, **two-way**. When the diff touches
  one of those but you still judge two-way, write `two-way — <why a revert restores everything>`.
- Blast Radius lists affected page routes when the change maps to them; "None (<why>)" when nothing is.

### 4e. `## Root Cause` / `## Solution` (fix only)

Written for someone who has never seen this code — PM, QA, another team. Keep both high-level and
about behaviour: **no** component, function, file, variable or state names, no backticked identifiers,
no line numbers. Generic words (cache, token, session, validation, modal, route) are fine.

- Read the bug report first (the linked issue and its comments) — the diff says how it was fixed, the
  report says what users ran into. Without one, infer from the diff and branch and say so in both sections.
- `## Root Cause`: from what the user saw, which path through the product was not handled — a
  situation, not a missing line of code.
- `## Solution`: what the product does now, as the user observes it.
- Check: could QA understand both sections without opening an IDE? If not, rewrite.

### 4f. Writing

- Things to flag for a reviewer go into ③ or `Merge Danger`, not a new section.
- No "This PR…" openers, no padding; one fact per bullet. Identifiers stay verbatim in backticks
  everywhere except `Root Cause` / `Solution`.
- Issue link: if the argument or the branch name carries an issue reference (`#123`, `ABC-123`),
  put it after `Merge Danger` (`Closes #123` for a GitHub issue in this repo).

### 4g. Rerun the evidence independently

The session that wrote the code does not get to decide it is ready. Before step 6, when an Agent or
subagent tool is available: start one with **only** the repo path and the commands under
`Verified by` (not your reasoning), ask it to rerun each at the current HEAD and report exit codes,
output tails and any result that differs from the body. Where it differs, the rerun wins — fix
`Verified by` or move the item to `Not verified`. When all agree, add
`- **Re-run:** an independent agent reran N commands with the same results`. A command that needs
interaction, accounts or outside services goes under `Not verified` as "not rerun independently: <why>".
No subagent tool → skip this step and say so under `Not verified`.

## 5. Screenshots and acceptance videos

- When `VIBEFLOW_ARTIFACTS_DIR` is set and nonempty, look there first for this change's screenshots
  and acceptance videos, including subdirectories such as `visual-parity/run-*`. Select files that
  actually show this branch's behavior; do not attach unrelated or stale evidence.
- Save new screenshots in a new subdirectory of `VIBEFLOW_ARTIFACTS_DIR` (for example
  `pr/<unique-run>/`). Create it first, quote paths containing spaces, and preserve earlier evidence.
  Keep final acceptance videos there too; recordings from visual-parity may remain in its run directory.
- Put temporary browser scripts, extra logs, PR body files and recording intermediates in
  `VIBEFLOW_SCRATCH_DIR`. If it is unset or empty but the Artifact root exists, use its `scratch/`
  subdirectory. If neither is available, use the agent's scratchpad or the system temp directory.
- When the Artifact variable is unset or empty (outside VibeFlow), use an existing evidence location
  or the agent's scratchpad for new captures. Missing variables must not block the PR workflow;
  an explicit user-specified path takes priority.
- **Upload screenshots and videos through the GitHub web UI only. Never commit them to the repo.**
  Create or update the PR with `gh` as below, then use GitHub's attachment control in its description
  or a comment. For an acceptance video, add a separate comment and upload the actual video there.
  Wait for the upload to finish and confirm the resulting GitHub attachment link before submitting.
  A local filesystem path is not an uploaded attachment. If no acceptance video exists, skip the
  video comment. If the browser cannot upload or is not signed in, report that limitation and keep
  the file in Artifacts; do not substitute a repository commit or claim the upload succeeded.

## 6. Create or update

Write the body to a unique temp file in the scratch location above. Before sending, check: title format and length, no quotes in the title, `Summary` / `Evidence` / `Merge Danger` present, `Not verified` and `Verified at` present, every `Verified by` names a backticked command, no backticked identifiers in `Root Cause` / `Solution`, and Door matches the one-way rules in 4d. Then:

```bash
gh pr create --draft --base <base> --title "<title>" --body-file <file>
gh pr edit <n> --title "<title>" --body-file <file>
```

Report the PR URL and the title to the user.
