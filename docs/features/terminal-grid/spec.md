# Terminal grid

The top view switch includes a **終端機** page for multiple independent shells. Its terminals appear in a responsive grid and remain running while the user visits the board or work items.

- The user chooses a recent project or any existing folder before opening a terminal. The shell starts in that directory.
- A running card's action opens an extra terminal in its **branch worktree** and switches to the terminal page. A Backlog card opens it in the original project directory without provisioning. A completed card uses its worktree if present, otherwise the original project directory.
- A card lists the titles of its open extra terminals. Selecting a title switches to and focuses that terminal. The board header omits the overall task and project counts.
- Each pane shows its directory, an editable title initially set to the folder name, and a close button. Closing ends its session and removes the pane.
- The grid and titles live only for the current browser session. Opening an extra terminal for an unprovisioned In Progress card creates its worktree; the grid itself does not change the card's own terminal tabs.
