# Prep: feature / behaviour change

At night work-mode writes a spec and treats its confirmation as given. Every open question that
would change the approach must have an answer today.

## Checklist

- [ ] Scope as in / out, small enough for one night and one morning's review; split by
      user-visible slice, not by layer, when it is larger.
- [ ] Behaviour for each situation a user can see: normal, error, empty, loading, permissions,
      narrow screens — the ones that apply.
- [ ] Design decided: a link to the design or a written description of the UI and copy. Visual
      choices left open are not dispatchable.
- [ ] Contracts it touches (API fields, shared component props, stored data) named, with the
      decision on compatibility or migration.
- [ ] Acceptance criteria that can be checked without the person: tests, commands, pages to load.

## Not dispatchable when

- The design or a product decision is still open.
- It needs a data or API change another team owns and has not agreed to.

## Required on the sheet

已定案的決定 holds every answer given today; 驗收條件 says how the morning reviewer will check it.
