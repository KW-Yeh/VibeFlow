---
name: work-mode
description: Task triage entry point — restate the task in your own words, decide which kind it is (new feature, bug fix, refactor, investigation, an existing PR), then follow that kind's playbook as a task list, calling other skills where it says so. Every task that changes code goes through a spec.md and plan.md first. Use when the user says "/work-mode", "use work mode", "用 work mode 處理", when a VibeFlow card hands over a task, or for any non-trivial development task given without a process. Not for plain questions, typos or one-line edits.
---

# Work mode

One entry point; the process depends on the kind of task. This file only triages and holds the
shared rules; each kind's steps live in `playbooks/` next to this file.

Talk to the user in their language.

## 1. Restate

Say in your own words what problem is being solved, what success looks like, and where the scope
ends. Read the requirement source first (issue, ticket, PR link, design) and restate after; if you
cannot read it, name the gap instead of guessing its content.

In documents and PRs, cite the real source (the issue or ticket, or the user's own description) —
never "the VibeFlow card".

## 2. Classify

Pick one playbook. Judge by what the first step has to be, not by the words in the task title.

| Kind | Signals | Playbook |
|---|---|---|
| Bug fix | A gap between current and expected behaviour; a bug report, error report, crash, "broken", "doesn't work" | [bug-fix.md](playbooks/bug-fix.md) |
| Feature / behaviour change | Add or change behaviour users can see, where the current behaviour is not wrong | [feature.md](playbooks/feature.md) |
| Refactor | Restructure, move files, extract components, modernise — **external behaviour must not change** | [refactor.md](playbooks/refactor.md) |
| Dependency change | Upgrade, add or remove packages | Settle the packages and lock file first (ask before changing the lock file); an upgrade with no behaviour change follows refactor, one whose breaking changes change behaviour follows feature |
| Investigation | Only an answer is wanted — "why", "how does it work", "is it", "how big is the impact" — no change asked for | [investigation.md](playbooks/investigation.md) |
| Existing PR | The user's own PR is open (check with `gh pr view --json author`): review comments, failing CI, base conflicts, watch until merge | [babysit-pr.md](playbooks/babysit-pr.md) |
| Review someone else's PR | A PR the user did not write, to review | No playbook: review it directly (or with a code-review skill if one is available) |

Rules:

- A task that plainly holds two things ("fix X and tidy Y", "find the cause, fix it if you can")
  is done in order, each through its own playbook.
- One thing that looks like two kinds → take the kind whose first step is more cautious:
  investigation > bug fix > refactor > feature. "Something looks off here" starts as an
  investigation and switches to bug-fix once the bug is confirmed.
- "Fix the bug and rewrite it nicely" is two things: the fix first, the refactor as its own task or
  as a separate stage of the plan.
- Ask the user only when two readings lead to different results and a wrong guess is hard to undo.
  Otherwise pick, and right after the restatement say in one sentence which playbook and why.

## 3. Task list

Open the chosen playbook and copy every item of its **Steps** into the task list (whatever task or
plan tool the environment provides), then start the first one. From there:

- Exactly one item in progress at a time.
- Finishing an item: pass that step's check → mark it done → commit if files changed → start the
  next. Do not batch the updates or the commits at the end. Using this skill authorises those commits
  on the task's feature branch only — no remote operations beyond push. On a shared branch such as
  `main`, create a feature branch first.
- spec.md / plan.md are committed only once confirmed; documents still waiting stay uncommitted.
- A step whose check failed is not done.
- New steps you discover go into the task list, not only into prose.
- If the classification turns out wrong (the investigation found a bug), say why in one sentence,
  switch playbooks, and replace the remaining items with the new playbook's.

## Shared rules

### Spec and plan

Playbooks that change the repo (feature, bug-fix, refactor, babysit-pr) create or update a
`spec.md` and a `plan.md`. Each playbook says what this kind of task must put in them.

- Where they go: follow the target project's convention (its CLAUDE.md / AGENTS.md, or an existing
  `docs/features/<slug>/`-style folder). If a spec/plan skill is available (for example
  `feature-spec-plan`), use it and its templates. Otherwise create `docs/features/<slug>/` with
  - `spec.md`: problem and goal, scope (in / out), a **behaviour** table (situation → expected
    behaviour), acceptance criteria as a checklist, constraints and open questions, a confirmation log.
  - `plan.md`: investigation of the existing code (with `file:line`), approach and trade-offs,
    implementation stages in order, risks and dependencies, an implementation-and-verification log.
- New task: a new folder with a new spec.md and plan.md. Continuing the same feature or PR: reuse
  the existing documents and update them only where the latest facts disagree.
- Confirmation: present the spec and wait for the user's confirmation before the plan, and the plan
  before implementing. If the user said beforehand that low-complexity tasks need no confirmation,
  a task that is single-file, changes no API or data shape and can be undone in one line may go
  straight on after the spec is shown; write "skipped confirmation per the user's prior permission"
  in the confirmation log.
- Investigation changes nothing and writes no documents; once its answer calls for a change,
  switch to the matching playbook and start the documents there.

### Verification

Take the check commands from the target project's CLAUDE.md / AGENTS.md and `package.json` (or its
equivalent), never from another project. A check you did not run is not verified — list it as such.

### Wrap-up (every playbook that opens a PR)

1. Get an independent review before the PR: if a pre-PR review skill is available (for example
   `pre-pr-review`), loop with it until reviewer and author agree it is ready. Otherwise have a
   fresh subagent review the diff against the spec, fix what is right, and say what you rejected and why.
2. Open a draft PR with the `pr` skill. If an acceptance video exists, add a PR comment with the
   uploaded video as proof of completion; if you cannot upload, ask the user to and create the comment first.
3. Watch the PR and its base branch until it is merged or closed: call the `pr_watch_start` tool when
   the session has it; otherwise use the `pr-watch` skill. With neither, tell the user the PR cannot be
   watched automatically and stop at this step.
4. When woken while watching, follow [babysit-pr.md](playbooks/babysit-pr.md).

### Evidence

Screenshots, reports and videos go where the environment says: inside VibeFlow, under
`VIBEFLOW_ARTIFACTS_DIR` (temporary files under `VIBEFLOW_SCRATCH_DIR`); never commit them.
For UI checks use the `visual-parity` skill.

### Reporting

Before ending any turn: which steps are done, which checks ran (exact commands), what is not
verified, and who the next move is waiting on.
