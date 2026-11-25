# Playbook: refactor

External behaviour must not change at all. Turn "unchanged" into checks that run before changing the structure.

## Steps

1. Write down what this improves (duplication, coupling, readability, an upgrade) and how you will tell it improved. If you cannot name a concrete benefit, stop and ask instead of doing it.
2. Write spec.md: the behaviour table says "all existing behaviour unchanged" and lists the affected usage situations; acceptance criteria include "all existing tests pass" and the characterisation tests from step 3 passing.
3. Inventory test coverage of the affected area. For behaviour without tests, add characterisation tests first (record today's output without judging it), run them before the change, and commit them.
4. Write plan.md: list every caller and export, and split the work into small steps that each pass the tests on their own.
5. Change one step at a time, run the tests after each, commit when they pass. An existing bug found on the way is not fixed in passing: record it under the plan's risks and dependencies, report it, and handle it later as a bug fix.
6. Run all the project's checks; for UI components, compare before and after with `visual-parity` and confirm there is no difference. Record the results in plan.md.
7. Follow the wrap-up in SKILL.md. The PR type is `refactor`.

## Don't

- Change behaviour in the same PR.
- Change test expectations to make the tests pass.
