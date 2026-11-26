# Prep: test-only work

Adding tests without changing production code. Cheap to review and a good night task, as long
as the night knows the project's test conventions and the boundary.

## Checklist

- [ ] What to cover: files or modules, and the situations per module (normal, error, empty,
      permissions, boundary values).
- [ ] The project's test conventions: framework, where tests live, naming, how mocks and fixtures
      are made, the command to run one file and the whole suite. Read an existing test as the model.
- [ ] The test command runs today on this machine (pass / fail; failing tests in the area are fine,
      a broken toolchain is not).
- [ ] Shared test utilities or fixtures the cards would all need: one card creates them, the others
      come `--after` it. No two cards edit the same test file, mock or fixture.
- [ ] Coverage tooling, if the project has it, and today's number for the area.

## Not dispatchable when

- The code cannot be tested without changing it (hidden dependencies, no seams) and the person has
  not agreed to a production change. List those spots instead.

## Required on the sheet

驗收條件: new tests pass, existing tests still pass, **no production code changed**, the coverage
number before and after when available. 已定案的決定 says that code which cannot be tested without
a production change is listed in the PR, not changed. The sheet states plainly that this is a
test-only change.
