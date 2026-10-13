# View persistence

Reloading the Web UI returns the user to where they were, instead of the board
with an empty terminal page.

## What survives a reload

| State | Where | Scope |
|---|---|---|
| Current view (看板／工作項目／終端機) | URL `?view=github` / `?view=terminals` (board = no param) | That address |
| Selected card | URL `&task=<id>` (opens its tab if the bar lacks it) | That address |
| 終端機 page panes: key, title, project, card | core store `VibeFlowState.terminals` | Every frontend, across host restarts |
| Open card tabs, Issues/PRs/Jira tab, GitHub filters | `localStorage` | That browser |

- The view and card update the URL with `history.replaceState`: switching views is
  not navigation, so the back button does not step through it.
- UI state (tabs, selection, filters) stays out of core, per AGENTS.md ("core never
  builds a UI concept"). Terminal panes go to core because they are core's sessions:
  only core can re-attach them, and every frontend must agree on which exist.
- A reload re-attaches each pane to its running shell. tmux redraws on attach; a pty
  that is still running is joined with its buffered output, never restarted.
- Closing a pane ends its shell and drops its entry; deleting a card does the same for
  the panes opened for it. A pane whose shell has died (e.g. the pty backend after a
  host restart) opens a new shell in the same directory.
- Unreadable stored values fall back to the defaults.

Implementation and verification: [plan.md](plan.md).
