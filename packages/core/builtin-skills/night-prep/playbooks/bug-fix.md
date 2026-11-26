# Prep: bug fix

At night work-mode's bug-fix playbook will reproduce the bug first and stop if it cannot. Make
sure it can, from the sheet alone.

## Checklist

- [ ] Reproduction steps someone else can follow: where (URL, screen, command), with what data
      or account, in which environment.
- [ ] Actual behaviour and expected behaviour, with numbers or screenshots when the report has them.
- [ ] The environment the night can reach reproduces it: check that the page, service or test
      data is reachable from this machine, and that any test account works (pass / fail only).
- [ ] Several reports of the same component go on one card when they likely share a cause; keep
      them apart when they touch unrelated code.
- [ ] What counts as fixed: the reproduction passes, plus any measurement to repeat after the fix.
- [ ] Areas not to touch while fixing (shared components, public APIs), written under 已定案的決定.

## Not dispatchable when

- It cannot be reproduced today, or only on a device or account the night cannot reach. Make it
  an investigation card instead, or leave it for the day.
- Expected behaviour is disputed: settle it with the person first.

## Required on the sheet

驗收條件 starts with "the reproduction from the report passes" and lists the before / after
evidence to attach to the PR (screenshots go to `$VIBEFLOW_ARTIFACTS_DIR`).
