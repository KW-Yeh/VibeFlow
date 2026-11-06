# Plan: task sheet + inbox create sheet

1. Core: `createMasterTask` keeps `github` / `jira` like an ordinary card
   (`packages/core/src/tasks.ts`); test in `test/master-cards.test.mjs`.
2. `EditTaskDialog` → task sheet: takes the card's column; non-Backlog is
   read-only with 前往工作區; every column gets hold-to-delete.
3. Board: `BoardColumns` card / slave clicks call `onOpenTaskSheet`
   (home.tsx) instead of `openTask`; the sheet closes when its card disappears.
4. `NewTaskDialog` takes `initial` (title, description, project, branches,
   github / jira ref) and passes the ref through the draft.
5. Inbox: `draftFromItem` / `draftFromTicket` build a reference description;
   GitHub detail and Jira detail「建立卡片」/「再建一張」open the sheet.
6. e2e (`e2e/web.e2e.mjs`) follows the new flows; docs/README.md lists this.
7. Backlog sheet: 取消 → 開始 (`onStart`, saves pending edits first).
8. Board: grip on each card, `cardMove` rules, column drop targets, confirm
   dialog for backward drags; e2e drags every allowed move and the refused one.
