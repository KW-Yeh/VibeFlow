# Playbook: bug fix

Prove the bug exists and find its root cause before fixing it. A fix without a reproduction is not a fix.

## Steps

1. Read the requirement source (the bug report, issue and its comments) and write down reproduction steps, actual behaviour, expected behaviour and environment.
2. Reproduce: write a failing test, or follow the steps in the browser or on the command line and keep the output or a screenshot. If it does not reproduce, stop and report what you tried and what information is missing — do not fix by guessing.
3. Find the root cause. With two or more candidate causes, run the cheapest experiment that tells them apart first, not the one easiest to test. The root cause must point at a concrete `file:line` and trigger condition.
4. Write spec.md: the behaviour table reads "actual → expected", and the first acceptance criterion is the reproduction from step 2 passing. Once confirmed, write plan.md: the code investigation holds the root cause and its evidence; approach and trade-offs explain why the fix sits at this layer rather than blocking the symptom where it shows.
5. Commit the failing test (or reproduction script) first. Its check: it fails because of the bug, with a message that matches the actual behaviour from step 1. Then write the smallest fix that makes it pass. Never change the test's expectation to fit the code.
6. Search for other triggers of the same root cause (other callers of the same function, copy-pasted code) and fix them too, or record them in the plan as follow-ups.
7. Run the project's checks and the reproduction from step 2; record the results in plan.md's implementation-and-verification log. For UI, confirm on the real page with `visual-parity`.
8. Follow the wrap-up in SKILL.md. The PR type is `fix`; its Root Cause section comes from step 3.

## Don't

- Swallow the error with try/catch or add a null check that hides the symptom without explaining why the value is null.
- Change code before the bug is reproduced.
