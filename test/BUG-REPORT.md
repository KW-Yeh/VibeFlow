# QA Bug Report — core helpers test pass

Found while building the headless test suite for `main/helpers/*`. These are
**source defects** — per the QA boundary they are reported here, not patched.

---

## BUG #1 — `commitAndPush` throws on every real finalize (HIGH)

**Where:** `main/helpers/git.ts` → `commitAndPush()`

```ts
await git(worktreePath, ['add', '-A', '--', '.', `:(exclude)${PROGRESS_FILE}`])
```

**Symptom:** the `git add` exits with code 1 (so `git()` rejects and the whole
function throws **before** the commit) whenever the agent progress file
`.vibeflow-progress.json` exists in the worktree.

**Why it always happens in production:**
1. `provisionWorktree()` calls `ensureLocalExclude()`, which adds
   `.vibeflow-progress.json` to `.git/info/exclude` for every task worktree.
2. The agent maintains `.vibeflow-progress.json` in the worktree during the run.
3. At finalize, `git add -A -- . :(exclude).vibeflow-progress.json` is run. On
   modern git, naming an ignored path via a `:(exclude)` pathspec trips the
   "paths are ignored by .gitignore … use -f" guard and git exits 1.

**Reproduction (git 2.51.0, deterministic):**
```bash
git init -b main proj && cd proj
git config user.email t@t.co; git config user.name T
printf '# hi\n' > README.md && git add -A && git commit -m init
printf '.vibeflow-progress.json\n' >> .git/info/exclude   # ensureLocalExclude
printf '{}' > .vibeflow-progress.json                     # agent progress file
printf 'real\n' > tracked.txt
git add -A -- . ':(exclude).vibeflow-progress.json'; echo "exit=$?"   # -> exit=1
```
Remove the progress file and the same command exits 0 — confirming the trigger.

**Impact:** the "Approve & Push" finalize flow rejects for any task that ran the
agent (i.e. all of them). `tracked.txt` does get staged before git errors, but
the function never reaches `commit`, so nothing is committed or pushed.

**Captured by:** `git.test.mjs` →
`commitAndPush — never commits the agent progress file` (marked `todo`; it
asserts the correct behavior and will start passing once fixed).

**Suggested fix direction (for Developer):** since `.vibeflow-progress.json` is
already excluded via `.git/info/exclude`, the `:(exclude)` pathspec is
redundant and is what trips the guard — `git add -A` alone already skips it.
Alternatively pass `--ignore-errors` / drop the explicit exclude pathspec.

---

## OBSERVATION #2 — diff old/new newline asymmetry (LOW)

**Where:** `main/helpers/git.ts` → `getWorktreeDiff()`

`oldValue` is read via `git show <ref>:<path>` through the shared `git()`
helper, which **trims** stdout — dropping a trailing newline. `newValue` is read
via raw `fs.readFile`, which keeps it. For a file whose only "change" is a
trailing newline (or for any file with a trailing newline on the base side), the
side-by-side diff viewer can therefore show a spurious final-line difference.

**Impact:** cosmetic only — affects how the diff renders, not correctness of the
commit. Documented in `git.test.mjs` (the README.md modified-file assertion).
