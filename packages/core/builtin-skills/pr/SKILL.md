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

## 5. Create or update

Write the body to a temp file, then:

```bash
gh pr create --draft --base <base> --title "<title>" --body-file <file>
gh pr edit <n> --title "<title>" --body-file <file>
```

Report the PR URL and the title to the user.
