# Motion animations implementation

Renderer-only. No core, handler-table or store change; no new dependency.
Numbers refer to the table in [spec.md](spec.md). Each phase is one commit and is
independently shippable.

## Phase 0 — shared primitives (`renderer/lib/motion.ts`, `renderer/components/ui/`)

1. Add a `MOTION_SPRING` token (one spring for layout travel, one snappier for
   indicators) next to `MOTION_DURATION`; every phase below takes its numbers from
   here.
2. `ui/animated-number.tsx`: `useSpring` + `useTransform` writing into a
   `motion.span`, formatted by a passed `format` (`formatTokens`,
   `toLocaleString`). Renders the final value immediately under reduced motion and
   on first mount (no count-up from 0 on page load). Keeps `tabular-nums`.
3. `ui/copy-button.tsx`: wraps `IconButton`; `Copy` ↔ `Check` through
   `AnimatePresence mode="wait"`, resets after 1.5 s, announces 「已複製」 via
   `aria-live`. Takes the text (or an async getter) and an `aria-label`.
4. Migrate `notification-toaster.tsx`'s inline `duration: 0.15` to the tokens.

## Phase 1 — tabs and status (#1, #6) — low risk, highest frequency

- `ViewTabs`, inbox tabs, task workspace tabs: render the active indicator as a
  `motion.span layoutId="<group>-indicator"` inside the active button, each group in
  its own `LayoutGroup id` so two tab bars never share an indicator.
  The border/background classes move from the button to the indicator.
- `StatusMark`: key the dot/spinner by state inside `AnimatePresence mode="popLayout"`
  so state changes cross-fade (micro timing); add a one-shot scale pulse when the
  state becomes 等待權限.

## Phase 2 — numbers and progress (#4, #5)

- Replace the token `<span>` in `TaskProgressBadge` and the values in `UsageTable`
  with `AnimatedNumber`; column counts in `board-columns.tsx` too.
- `ProgressBar`: inner bar becomes a `motion.span` animating `scaleX` (origin left)
  with the indicator spring, replacing `transition-[width]`.
- Check: a board with several running cards updates tokens every transcript tick —
  confirm in the React profiler that `AnimatedNumber` does not re-render its parent
  per frame (motion value writes only).

## Phase 3 — copy feedback and loading crossfade (#7, #8)

- Swap the four clipboard call sites to `CopyButton`.
- Wrap loading ↔ content in `github-view`, `jira-panel`, `library-panel`,
  `terminal-file-preview` with `AnimatePresence mode="popLayout" initial={false}`.
  Background refreshes that keep the old list visible must **not** cross-fade
  (only the empty → first-load transition does), or every 5-minute poll flashes.

## Phase 4 — board cards (#2, #3) — highest risk

- Each card's outer element becomes `motion.div layout layoutId={task.id}`; columns
  share one `LayoutGroup`; scrolling column containers get `layoutScroll`.
- New cards: `initial` = hidden enter variant, but only for ids that were not in the
  previous state snapshot (no animation on page load or view switch).
  Deleted cards: `AnimatePresence` exit with height collapse.
- `task-progress.tsx` todo list: `AnimatePresence initial={false}` on items, icon
  cross-fade on status change.
- Bail-out rule from the spec: if travel stutters when the target column is
  scrolled or the board re-renders mid-flight, drop `layoutId` and keep only #3.

## Phase 5 — toasts (#9)

- Stacked mode when more than two toasts are open: older ones offset and scaled
  behind the newest; hover/focus on the stack expands it (`layout`) and pauses every
  item's dismiss timer; leaving resumes them with the remaining time.

## Verification (each phase)

- `npx tsc --noEmit -p renderer/tsconfig.json`
- `npm test` — `ui-consistency` guards hand-written button focus rings and the radius
  ladder; new `ui/` components must pass it. Add a `ui-consistency` rule that fails on
  numeric `duration:` literals inside `renderer/components/` so phase 0's token rule is
  enforced, not remembered.
- `npm run build:web`, then `npm run test:e2e` (phases 1, 3, 4 touch the main flow).
- Runtime: `npm start -- --store-path <tmp> --no-open --port 47831`, drive with the
  `visual-parity` skill at 1440 and 768: switch tabs, start/finish a card, create a
  card from the CLI while the board is open, copy the artifacts path, fire >2 toasts.
  Repeat once with reduced motion emulated — every change must be instant.
