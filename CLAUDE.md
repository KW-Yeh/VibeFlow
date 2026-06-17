# CLAUDE.md — VibeFlow

Project-specific playbook. Extends the global autonomous workflow with this repo's
stack, commands, conventions, and Definition of Done.

VibeFlow is a local-first, intent-driven **kanban** desktop app: it pairs the Claude
Code CLI with **Git worktree** isolation so each card runs in its own branch +
worktree, with a live terminal. The board can host **multiple projects at once** —
the project folder is chosen **per task** at creation time (there is no global
"current project").

---

## Tech stack

- **Shell**: Electron 41 (ESM main process, `type: module`)
- **Renderer**: Next.js 16 (Pages Router) + React 19 + TypeScript, static export (`output: 'export'`)
- **Scaffold/build tool**: Nextron 10 (wires Electron + Next.js)
- **Styling**: Tailwind CSS v4 + shadcn/ui foundation (`cn`, `Button`, design tokens, `components.json`)
- **Kanban DnD**: `@hello-pangea/dnd`
- **Terminal**: `@xterm/xterm` + `@xterm/addon-fit` (renderer) ↔ `node-pty` (main, native)
- **Persistence**: `electron-store`
- **Diff viewer**: `react-diff-viewer-continued`
- **Icons**: `lucide-react`
- **Package manager**: npm

---

## Commands

| Task | Command | Notes |
|---|---|---|
| Dev (hot reload) | `npm run dev` | Launches Next dev (port 8888) + Electron with `--remote-debugging-port=5858` |
| Rebuild (fast, default) | `./rebuild.sh` | Builds **only** `dist/mac-arm64/VibeFlow.app` — no dmg/zip, no compression, keeps `renderer/.next` for incremental Next builds (~10s). Use for all local iteration. |
| Build installers (slow) | `./rebuild.sh --release` | Full clean + `nextron build` → `.app` **+ `.dmg` + `.zip`** with max compression (what CI publishes). Only when you actually need the installers. |
| Package app (raw) | `npm run build` | `nextron build` → `dist/` (`.app`, `.dmg`, `.zip`, macOS arm64). Same as `--release` without the clean; prefer `./rebuild.sh`. |
| Rebuild + hot update | `./rebuild.sh --install` | Fast build, then swap the new `.app` over the running/installed copy — the live app shows a「立即重啟」banner (see `main/helpers/update.ts`) |
| Rebuild + auto relaunch | `./rebuild.sh --relaunch` | `--install`, then quit + reopen VibeFlow automatically |
| Typecheck (main) | `npx tsc --noEmit -p tsconfig.json` | Checks `main/**/*.ts` only |
| Typecheck (renderer) | `npx tsc --noEmit -p renderer/tsconfig.json` | Delete stale `renderer/.next` first if you see duplicate-type errors |
| Renderer build only | `cd renderer && NODE_ENV=production npx next build` | Faster than full package; outputs to `../app` |

There is **no lint or test runner configured** (no ESLint/Jest/Vitest). Do not invent
one unless asked. "Lint" in the global playbook maps to **typecheck** here.

---

## Project structure

```
main/                      Electron main process (ESM, bundled by nextron/webpack)
├── main.ts                App bootstrap + ALL ipcMain handlers (registerIpcHandlers)
├── preload.ts             contextBridge: window.ipc + window.vibeflow (typed API)
└── helpers/
    ├── store.ts           electron-store: VibeFlowState, Task, board mutators (LAZY init)
    ├── git.ts             git via child_process: info / worktree / diff / commit+push
    ├── progress.ts        task-progress types + .vibeflow-progress.json reader/watcher
    ├── pty.ts             node-pty session manager (per-task, PATH-injected login shell)
    └── create-window.ts   window-state persistence (scaffold)

renderer/                  Next.js app (Pages Router)
├── pages/
│   ├── _app.tsx           imports xterm CSS + globals.css
│   └── home.tsx           container: loads state, owns dialogs, wires the board
├── components/
│   ├── kanban-board.tsx   board + cards (drag handle scoped to header)
│   ├── task-terminal.tsx  xterm terminal (dynamic import, client-only)
│   ├── new-task-dialog.tsx per-task folder picker + git detect + create
│   ├── review-dialog.tsx  diff viewer + Approve & Push
│   └── ui/button.tsx      shadcn button
├── lib/
│   ├── types.ts           re-exports domain types FROM main (single source of truth)
│   ├── api.ts             bridge-safe wrappers over window.vibeflow
│   └── utils.ts           cn()
├── styles/globals.css     Tailwind v4 + shadcn design tokens (dark theme)
└── preload.d.ts           declares window.ipc / window.vibeflow types
```

---

## Architecture & conventions

- **IPC is the only main↔renderer channel.** Add a feature in this order:
  1. Logic in `main/helpers/*.ts`.
  2. `ipcMain.handle('ns:action', ...)` inside `registerIpcHandlers` in `main.ts`.
  3. Method on the `vibeflow` object in `preload.ts` (typed).
  4. Wrapper in `renderer/lib/api.ts` (must no-op / return null when the bridge is absent — static export & plain-browser safety).
  5. Use it from a component via `lib/api`.
- **Single source of truth for types**: domain types live in `main/helpers/*.ts`;
  `renderer/lib/types.ts` re-exports them with `export type` (erased at build — no
  runtime import of main code into the renderer). Don't duplicate type definitions.
- **`electron-store` must be constructed lazily** (`getStore()` in `store.ts`), never
  at import time — the store binds to `userData`, which `main.ts` redirects in dev
  (`… (development)`). Eager construction binds the wrong path. (This was a real bug.)
- **Each Task carries its own `projectPath`/`projectName`.** Anything touching a
  worktree (cleanup, delete, diff, terminal cwd) resolves it from the task, not a global.
- **Terminal**: `task-terminal.tsx` dynamically imports xterm inside `useEffect`
  (xterm touches the DOM; never import at module top). PTY lifecycle is tied to mount —
  collapsing a card kills its session.
- **Branch/worktree naming**: branch `vf-<id>`, worktree `<project>/.vibeflow/vf-<id>`,
  where `<id>` is the first 8 chars of a UUID. `ensureGitignore` adds `.vibeflow/` to
  the target project's `.gitignore`.
- **Dark theme**: the app wraps content in `<div className="dark">`; style with the
  shadcn token classes (`bg-background`, `text-muted-foreground`, etc.), not raw colors.

---

## Definition of Done

A change is done only when, on the affected scope:

1. `npx tsc --noEmit -p tsconfig.json` — clean (if `main/` touched).
2. `npx tsc --noEmit -p renderer/tsconfig.json` — clean (if `renderer/` touched).
3. `cd renderer && NODE_ENV=production npx next build` — succeeds (renderer changes).
4. For behavioral changes, a **runtime check** in the live app (see below).

If you packaged (`npm run build`), confirm the `.app` boots without a crash loop.

---

## Runtime verification (how this repo is tested)

There is no unit test harness, so verify behavior directly:

- **Git helpers** can be tested headless against a throwaway repo with Node's
  type-stripping — no Electron needed:
  `node --experimental-strip-types <test>.mts` importing from `main/helpers/git.ts`.
  Set up a temp repo (and a bare remote for push paths) and assert on results.
- **IPC / app behavior**: run `npm run dev`, then drive the renderer over the Chrome
  DevTools Protocol on `ws://localhost:5858` (the `/home` page target). Note the CDP
  `Runtime.evaluate` response is nested: `msg.result.result.value`. Use
  `awaitPromise: true, returnByValue: true` and call `window.vibeflow.*` directly.
- After dev runs, kill strays: `pkill -f "electron \."; pkill -f nextron; pkill -f "next dev -p 8888"`.
- Clean build artifacts before committing: `rm -rf app renderer/.next` (both gitignored).

---

## Gotchas

- **node-pty is native.** After bumping Electron, native modules must be rebuilt
  (`postinstall` runs `electron-builder install-app-deps`; or `npx electron-rebuild -f -w node-pty`).
  electron-builder unpacks the `.node` binary to `app.asar.unpacked` automatically.
- **Stale `renderer/.next` types** can cause phantom "Duplicate identifier" tsc errors —
  `rm -rf renderer/.next` and re-run.
- **Packaging is ad-hoc signed, not notarized** (no Apple Developer cert) — fine for
  local/personal use; will trip Gatekeeper if distributed.
- `dist/`, `app/`, `.next/`, `node_modules/` are gitignored — never commit build output.

---

## Git / PR

- Commit messages in English; conventional-commit prefixes (`feat:`, `fix:`, `chore:`,
  `docs:`, `build:`). End the body with the `Co-Authored-By` trailer.
- Push only when asked. Do not `npm install` new deps without flagging it.
