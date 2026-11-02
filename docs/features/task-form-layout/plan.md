# Plan — task form layout

1. `renderer/components/task-form-layout.tsx`: the shared pieces — the dialog
   frame (content column + property sidebar), `PropertyGroup`, `PropertyRow`,
   and `RunSettingsGroup` (agent, model, effort, Auto Mode).
2. `new-task-dialog.tsx`: `NewTaskDialog` renders the new layout; the inline
   and two-step modes go away.
3. `edit-task-dialog.tsx`: same layout; role shown as a badge; the worktree
   warning sits under the location rows.
4. `home.tsx` owns `newTaskOpen`; the side menu and the empty workspace pane open
   it; a successful create closes it. `kanban-board.tsx` drops the inline form
   and its props.
5. `e2e/web.e2e.mjs`: open the dialog before creating; the model picker is no
   longer behind "Advanced"; effort is a select.

## Verification

- `npx tsc --noEmit -p renderer/tsconfig.json`
- `npm test`
- `npm run build:web`
- `npm run test:e2e`
- In the live Web UI: create and edit at 1440×800 and at a 540px-tall viewport,
  master role, a non-git folder, and a phone-width viewport.

Verified 2026-11-02: both typechecks clean, `npm test` 480/480, `npm run
build:web`, `npm run test:e2e` 3/3. Live Web UI (throwaway store): create at
1440×800 and 960×540 (sidebar rows scroll, actions stay put), edit + save at
960×540, Master role, 375px width with no horizontal overflow, no console
errors.
