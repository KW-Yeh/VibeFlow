# Terminal grid implementation

1. Add `terminal:start` to core. A card id resolves to its `projectPath`; a manually selected path must be an existing absolute directory. Standalone session keys are distinct from task keys and are registered for the existing input, resize, and kill channels.
2. Add a top-level terminal view, folder picker, and responsive grid. Mount xterm panes once and keep them mounted across view switches; unmount on close sends `pty:kill`.
3. Add the card action to every board column and route it to the same grid.

## Verification

- Core and renderer typechecks: passed.
- `test/service.test.mjs`: 38 passed, including project-root resolution, path validation, and session teardown.
- `npm run build:web`: passed.
- `npm run test:e2e`: 3 passed. The real PTY test wrote a file into the project root from a Backlog card's extra terminal. The grid test covered all three card columns, manual folder selection, rename, view switching, and close.
- Full `npm test` has five unrelated Windows environment failures: three CLI process tests cannot execute a Node path under `C:\Program Files`, and two symlink tests receive `EPERM`.
