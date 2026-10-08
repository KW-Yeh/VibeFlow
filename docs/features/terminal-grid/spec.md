# Terminal grid

The top view switch includes a **終端機** page for multiple independent shells. Its terminals appear in a responsive grid and remain running while the user visits the board or work items.

- The user chooses a recent project or any existing folder before opening a terminal. The shell starts in that directory.
- Every board card, in every column, has an action that opens an extra terminal in the card's **project directory**, then switches to the terminal page. It does not provision or enter the card's worktree.
- Each pane shows its directory, an editable title initially set to the folder name, and a close button. Closing ends its session and removes the pane.
- The grid and titles live only for the current browser session. They do not change the task store or the card's own terminal tabs.
