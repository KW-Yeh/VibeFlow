---
name: night-prep
description: Prepare tonight's VibeFlow night shift during the day, while the person is still around — restate what is to be done, classify each item the way work-mode will at night, gather what that kind of task needs before it can run unattended, split it into cards, check the resources the cards will use, report and wait for confirmation, then create the cards marked 準備開工 (`task create --ready`). Use when the user says "今晚派工", "下班派工", "準備派工", "排進今晚", "prepare tonight's dispatch", "night prep", or asks a master card to plan work for the night shift. Not for doing the work itself (that is work-mode, at night) and not for a single quick question.
---

# Night prep

The night shift runs each card with work-mode while nobody is around: it may not stop to ask,
and a spec/plan confirmation counts as already given. That is only honest if the questions
work-mode would ask were answered during the day. This skill is where they get answered. It
changes no code: what it produces is task sheets, checked resources, and cards on the board.

Talk to the user in their language.

## Steps

Put these steps in the task list and do them in order.

1. **Restate.** In your own words: what is to be done tonight, what success looks like in the
   morning, where the scope ends. Read every requirement source first (tickets, issues, design
   links, the repos named); if one cannot be read, say which and what is missing.
2. **Classify each item** with work-mode's table (bug fix, feature / behaviour change, refactor,
   dependency change, investigation, existing PR) — read work-mode's SKILL.md for it rather than
   inventing new kinds, so the playbook work-mode picks at night matches what was prepared now.
   Test-only work (adding tests, no production code) uses [playbooks/add-tests.md](playbooks/add-tests.md).
3. **Prepare per kind.** Open the matching playbook and collect everything on its checklist.
   An item whose checklist cannot be completed today is **not dispatchable**: say why, and either
   leave it out or split off a daytime card that unblocks it.

   | Kind | Playbook | Night shift? |
   |---|---|---|
   | Bug fix | [playbooks/bug-fix.md](playbooks/bug-fix.md) | Yes, once it can be reproduced from the sheet alone |
   | Feature / behaviour change | [playbooks/feature.md](playbooks/feature.md) | Yes, once behaviour and design are decided |
   | Refactor | [playbooks/refactor.md](playbooks/refactor.md) | Yes, once tests guard the behaviour |
   | Test-only | [playbooks/add-tests.md](playbooks/add-tests.md) | Yes |
   | Dependency change | [playbooks/dependency.md](playbooks/dependency.md) | Only with the lock-file change approved today |
   | Investigation | [playbooks/investigation.md](playbooks/investigation.md) | Yes; it ends in a report, not a PR |
   | Existing PR | — | No: watching a PR and answering reviewers needs the person; leave it for the day |

4. **Split into cards.** Each card is one night's work that one person can review in the
   morning, in one repo. Two cards must not edit the same files (shared mocks, fixtures and test
   utilities included): give the shared piece its own card and order the others after it with
   `--after`. Work that depends on another card's code also waits with `--after`.
5. **Check resources.** For every repo involved, take the commands from its AGENTS.md / CLAUDE.md
   and package manifest (install, typecheck, test, build) and the access the night needs (the
   package registry, `gh auth status` for the Draft PR, test accounts, services the tests call),
   and run them. Record only pass or fail with the command — see "Secrets" below. Report what is
   missing; once the person has fixed it, run the failed checks again.
6. **Report and wait.** Write `plan.md` (in `$VIBEFLOW_ARTIFACTS_DIR` when it is set, else in the
   working folder): the restatement, each item's kind and why, items left out and why, the cards
   with their full task sheets and order, and the check results. Summarise it and **stop until the
   person confirms or changes it**. Do not create a card before that.
7. **Create the cards** once confirmed — see "Creating the cards". Then end the turn with each
   card written as `<id>「<title>」`, its order, and a reminder that 下班派工 sends them out.

## The task sheet

The card's description is everything the night run will know: it cannot see this conversation.
Write each sheet with these sections, in the card's language:

```markdown
## 背景
Why this work exists; requirement sources as links or numbers to read.

## 範圍
In: … / Out: …

## 驗收條件
- [ ] Concrete, checkable outcomes (the kind's playbook says which ones are required).

## 已定案的決定
Answers given today to the questions work-mode would otherwise ask: chosen approach,
behaviour in edge cases, naming, what not to touch. These are what the night may treat as
confirmed.

## 資源檢查
Commands to run before starting, each with what passing looks like, e.g.
- `npm ci` succeeds
- `npm test -- <path>` runs (failures in the code under work are expected)
- `gh auth status` is logged in

## 不在授權內
Pushing to a shared branch, force-push, reading or printing secrets, lock-file changes
(unless approved above), anything else the person ruled out today.
```

## Creating the cards

Card commands need the board CLI. Define this once and pass the store explicitly:

```sh
VF() { if [ -n "$VIBEFLOW_CLI_LOADER" ]; then node --experimental-strip-types --import "$VIBEFLOW_CLI_LOADER" "$VIBEFLOW_CLI" "$@"; else node "$VIBEFLOW_CLI" "$@"; fi; }
VF task create --store-path "$VIBEFLOW_STORE_DIR" --project <repo absolute path> --title <short title> --prompt <task sheet> --ready [--after <card id>]
```

- From a master card's shell the card joins that master on its own; add `--master <id>` otherwise
  only when the person asks for one.
- `--ready` puts the card on tonight's list (準備開工). Never run `task start`: 下班派工 sends cards out.
- Titles start with the part the card owns, so cards are told apart at a glance.
- Leave `--model` / `--effort` out unless the work clearly needs one.
- No `VIBEFLOW_CLI` in the environment means the board is read-only here: hand the person the
  sheets, titles and order to create by hand instead.

## Secrets

Never read, print, log or write a secret's value — not into plan.md, a card, or the terminal.
Check access with commands that use the credential without showing it (`npm whoami`,
`gh auth status`, a registry ping, a test request) and record pass or fail. Do not open `.env*`,
`.npmrc` or credential files to "check" them. If a check needs a secret the person has not set,
tell them which variable or login is missing and let them set it in their own shell.

## Don't

- Change code, commit or push: this is preparation only.
- Create cards before the person confirms the report.
- Put an item on tonight's list whose checklist is incomplete because "the night can figure it
  out" — at night nobody can answer.
- Repeat work-mode's playbook steps in the task sheet; the sheet says what and why, work-mode
  says how.
