# Workspace layout: one toolbar and a foldable inspector

A running card's workspace (below the board) gives the terminal as much room as
possible without dropping anything it offered before. Design canvas:
https://claude.ai/artifact/FVSPn6zzMr2BhonUg6hPEx (options A and B).

- **One toolbar.** An In Progress card has no title header: its title is the
  workspace tab above. The terminal's header becomes the only toolbar: branch,
  base branch, a copy-worktree-path button, the todo progress chip, then 退回
  Backlog, 啟動 Agent, 完成 and delete. The terminal sits flush in its pane, with
  no card frame or padding.
- **Inspector rail.** The 任務 / 決策 / Artifacts / Git diff views are switched
  from a 44px icon rail on the right edge, with the same counts as badges.
- **Docked or folded.** Docked (the default) shows the selected view beside the
  terminal, resizable as before. Folded, the terminal takes the full width and
  a rail icon opens the view as a drawer over the terminal, below the toolbar.
  The drawer closes from its own button, its rail icon, Esc while focus is
  inside it, or a click in the terminal. Clicking the shown view's icon while
  docked folds the inspector.
- The docked/folded choice is shared by every card and survives a reload
  (`localStorage` key `vibeflow:workspace-inspector`; no key = docked, so
  existing users see no change until they fold it).
- Below 1024px wide the inspector is always folded: a docked one would leave
  the terminal too narrow to read.
- Backlog and Done cards are unchanged: they have no terminal, so they keep the
  title header and the inline tab switcher.
