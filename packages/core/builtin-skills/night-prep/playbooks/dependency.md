# Prep: dependency change

Adding, upgrading or removing packages changes the lock file, which needs the person's approval —
it cannot be granted to the night by default.

## Checklist

- [ ] Which packages, from which version to which, and why.
- [ ] The person approved the lock-file change today; write that approval under 已定案的決定.
      Without it the item is not dispatchable.
- [ ] The registry the packages come from is reachable and logged in (pass / fail).
- [ ] Breaking changes from the release notes, and whether the upgrade is behaviour-neutral
      (work-mode treats it as a refactor) or changes behaviour (treated as a feature — then the
      feature checklist applies too).

## Not dispatchable when

- No approval for the lock-file change.
- The registry or its credentials do not work from this machine.

## Required on the sheet

不在授權內 no longer lists the lock file, and 已定案的決定 records who approved which change.
