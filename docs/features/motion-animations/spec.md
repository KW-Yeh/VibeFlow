# Motion animations

Apply the motion.dev React patterns that help a person **follow state changes** on
the board — a card moving, a tab switching, a number climbing, something being
copied — and leave out the ones that only decorate. VibeFlow is a work tool that
spends most of its time showing terminals; motion here has to be short, quiet, and
off under `prefers-reduced-motion`.

Source catalogue: <https://motion.dev/examples?platform=react> (≈240 React examples,
reviewed 2026-11-04).

## Ground rules (already in place, must stay true)

- `motion@12` is already a dependency; **no new package**. Everything below uses
  core `motion/react` APIs only (`motion.*`, `AnimatePresence`, `layout` /
  `layoutId`, `LayoutGroup`, `useSpring`, `animate`).
- Timings and easings come from `renderer/lib/motion.ts` (`MOTION_DURATION`
  micro 120ms / standard 160ms / spatial 180ms, `MOTION_EASING`). New patterns
  add a token there instead of inline numbers. `notification-toaster.tsx` still
  has inline `duration: 0.15` — migrate it while touching that file.
- `_app.tsx` wraps the app in `<MotionConfig reducedMotion="user">`; every new
  animation must also degrade to an instant change when reduced motion is on.
- Nothing animates the **width or height of a box that contains an xterm**:
  `addon-fit` refits on every resize frame and the shell reflows. Rails and
  inspectors keep snapping open.
- Animations never delay a state change: the data is updated immediately, the
  motion only explains it.

## Chosen (mapped to VibeFlow UI)

| # | motion.dev example | Where in VibeFlow | What the user sees |
|---|---|---|---|
| 1 | **Smooth Tabs / Tab select** (shared `layoutId` indicator) | `ui/view-tabs.tsx` (看板／工作區／工作項目／終端機), `inbox-view.tsx` tabs, task workspace tab bar (`task-workspace-panel.tsx` ~L1771, ~L1895) | The underline / pill glides to the newly selected tab instead of jumping |
| 2 | **Shared layout animation** (card moves between lists) | `board-columns.tsx` cards across Backlog → In Progress → Done | A started or finished card visibly travels to its new column instead of vanishing from one and appearing in another |
| 3 | **Enter / Exit animation + To-do list** (`AnimatePresence` list) | Board cards created by CLI / master / Jira / GitHub conversion; todo list in `task-progress.tsx` | New cards fade-slide in; a deleted card collapses out; todos that change status cross-fade their icon |
| 4 | **Number counter / Number trend** (built on `useSpring`, not Motion+ `AnimateNumber`) | Token count in `TaskProgressBadge`, column counts in `board-columns.tsx` (~L648), `UsageTable` | Live token totals roll up instead of flickering every transcript tick |
| 5 | **Progress bar** (spring `scaleX`) | `ProgressBar` in `task-progress.tsx` | Todo progress fills with a spring; replaces the `transition-[width]` layout-triggering width animation |
| 6 | **Multi state badge** | `StatusMark` / `activityMark` (執行中 → 等待權限 → 等待輸入) | The status dot / spinner cross-fades between states, so a card that just hit a permission prompt is noticed |
| 7 | **Copy Button** (icon morph to ✓) | The four `navigator.clipboard` call sites: `remote-share-dialog.tsx`, `task-workspace-panel.tsx` (artifacts dir, ~L1927), `settings-dialog.tsx` (GitHub code) | Copy icon morphs into a check for ~1.5 s, confirming the copy without a toast |
| 8 | **Skeleton crossfade** (`AnimatePresence mode="popLayout"`) | Loading states in `github-view.tsx`, `jira-panel.tsx`, `library-panel.tsx`, `terminal-file-preview.tsx` | Content cross-fades in over the loading state instead of popping |
| 9 | **Toast: Stacked notifications** | `notification-toaster.tsx` | Toasts already enter/exit; add a stacked (collapsed) look when >2 are open and expand on hover; pause the auto-dismiss timer while hovered |

## Considered, not chosen

| Example family | Why not |
|---|---|
| Gallery, Carousel, Curtains, Three.js / WebGPU, Spinning cube, Particle orb | Showcase/marketing surfaces; VibeFlow has no media to browse |
| Scroll-linked (parallax, word reveal, hide header, zoom hero, Lenis) | No long-form scroll pages; boards and terminals scroll for content, not story |
| Cursor (follow, magnetic, trail), Tilt card, Bobble hover | Distracts in a tool used for hours; fights the terminal's own cursor |
| Ticker, Typewriter, Scramble / split / wavy text | Text the user must read should not move; agents already "type" in the terminal |
| `AnimateNumber`, `Ticker`, `Carousel`, `Cursor`, Gallery, Curtains, `AnimateView` / `AnimateSuspense` | **Motion+** (paid `motion-plus` package) — would be a new dependency |
| Radix / Base UI / Clerk examples | Those libraries are not used here; the patterns they show (dialog, toast, tabs) are covered by #1, #9 and the existing `DialogShell` |
| Reorder animation / Multidimensional reorder | Terminal tabs already reorder by grip (`3dc7676`); board order is not user-sortable |
| Drag / Swipe actions | Cards move by buttons today; making them draggable is a feature decision, not an animation |
| Hold to confirm | Would change how delete / return-to-backlog are confirmed — a UX decision, not polish. Listed as an open question |
| Layout animation of the workspace rail / inspector fold | Contains xterm — see ground rules |
| Command palette, Mega menu, Radial menu | New features, not animations of existing UI |

## Open questions

- **Hold to confirm** for 刪除卡片 / 退回 Backlog — replace the current confirm, or skip?
- **#2 cross-column travel**: columns are separate scroll containers; if `layoutScroll`
  cannot keep the travel smooth when the target column is scrolled, fall back to #3
  (exit here, enter there) for that card.

Implementation order and verification: [plan.md](plan.md).
