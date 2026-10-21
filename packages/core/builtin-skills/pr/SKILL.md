---
name: pr
description: Create or update a GitHub draft pull request for the current branch with gh — conventional-commit title, What / Why / How body in English, written only from this branch's diff. Use when the user says "open a PR", "create PR", "建立 PR", "開 PR", or "/pr #123" to update an existing one.
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

**Title:** conventional commit — `<type>(<scope>): <summary>`, under 72 characters.
`type` is one of `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `build`, `ci`, `chore`.
Add `scope` only when one area clearly owns the change.

**Body:**

```markdown
## What
<one or two sentences: what changes for a user or a caller>

## Why
<the problem or goal; link the issue if there is one>

## How
- <the key decisions, not a file-by-file list>

## Testing
- <what was run or checked, and the result>
```

Issue link: if the argument or the branch name carries an issue reference (`#123`, `ABC-123`),
put it in **Why** (`Closes #123` for a GitHub issue in this repo).

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

Write the body to a unique temp file in the scratch location above, then:

```bash
gh pr create --draft --base <base> --title "<title>" --body-file <file>
gh pr edit <n> --title "<title>" --body-file <file>
```

Report the PR URL and the title to the user.
