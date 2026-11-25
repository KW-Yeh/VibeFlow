# Playbook: feature / behaviour change

Pin down the observable behaviour and the data shapes before writing code.

## Steps

1. Read the requirement source (issue, ticket, design, PR discussion) and list the open questions whose answers would change the approach.
2. Write spec.md: scope as "in / out"; every situation a user can see goes into the behaviour table, including errors, empty data, loading, permissions and responsive layouts. Get confirmation per the shared rules.
3. Write plan.md: first look for components and patterns in the project to reuse. When the change touches shared component props, exported types, API fields, store shape or event names, the plan lists every consumer and how each is checked. When it touches persisted data (localStorage, cookies, URL query, a database), the plan includes a migration step. When the direction is unclear or costly, compare the options from first principles before choosing.
4. Implement stage by stage in the plan's order; commit each stage once its checks pass.
5. Run the project's checks. Accept UI changes on the real page with `visual-parity` (against the design when there is one, and at 375 / 768 / 1440 widths); record a video as proof of completion when it helps. Record the results in plan.md.
6. Follow the wrap-up in SKILL.md. The PR type is `feat`.

## Don't

- Add settings, abstraction layers or "might need it later" parameters nobody asked for.
- Skip the spec and start from the plan.
