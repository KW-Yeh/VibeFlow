# Plan: workspace layout

1. `task-terminal.tsx`: optional `toolbarStart` / `toolbarEnd` slots. Given
   either, the header turns into the 40px toolbar and the frame is dropped;
   without them (no other caller today) it renders as before.
2. `task-progress.tsx`: `TaskProgressChip`, the todo bar and waiting state sized
   for the toolbar.
3. `task-workspace-panel.tsx`: In Progress cards render without the header,
   pass the card's actions into the terminal toolbar, and render the rail plus
   either the docked aside (with the existing width splitter) or the drawer.
   The docked/folded mode is a module-level store read through
   `useSyncExternalStore`, so all mounted panels follow one choice.
4. `e2e/web.e2e.mjs`: fold the inspector, open Git diff from the rail as a
   drawer, pin it back.

No store or core change. The new `localStorage` key needs no migration: its
absence means the previous (docked) layout.
