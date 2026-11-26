# Prep: refactor

At night work-mode's refactor playbook must keep external behaviour unchanged. That needs tests
that would catch a change.

## Checklist

- [ ] The behaviour that must stay the same, named (modules, routes, outputs).
- [ ] Existing tests cover it: find them and run them now (pass / fail). Where they do not, split
      off a test-only card first (see add-tests.md) and order the refactor after it with `--after`.
- [ ] The target shape decided: what moves where, naming, what is deleted.
- [ ] Mechanical moves and behaviour changes are not mixed; a behaviour change is its own card.

## Not dispatchable when

- Nothing guards the behaviour and no test card can come first.
- The target design is still being argued.

## Required on the sheet

驗收條件 includes "existing tests pass unchanged" and names the test command.
