# AGENTS.md — VibeFlow

Project-specific playbook. Extends the global autonomous workflow with this repo's
stack, commands, conventions, and Definition of Done.

VibeFlow is a local-first, intent-driven **kanban** for coding agents: it pairs the
Claude Code / Codex CLI with **Git worktree** isolation so each card runs in its own
branch + worktree, with a live terminal. One UI-free core (`packages/core`) serves
two frontends: the local **Web UI** (`vibeflow`, distributed via npm) and the
**TUI** (`vibeflow tui`). The former Electron desktop app has been removed; core
still reads its data directory and store file, so existing boards carry over. The board can host **multiple projects at once** —
the project folder is chosen **per task** at creation time (there is no global
"current project").

---

## Tech stack

- **Core**: `packages/core` — plain Node, runs from source with `--experimental-strip-types`
- **Host**: `vibeflow` CLI (`packages/cli`: instance lock + HTTP/WebSocket server via `ws`)
- **TUI**: Ink 7 (`packages/tui`), no JSX — `React.createElement`
- **Sessions**: tmux (`tmux -L vibeflow`, sessions outlive core) or `node-pty` (Windows / no tmux)
- **Renderer**: Next.js 16 (Pages Router) + React 19 + TypeScript, static export (`output: 'export'`)
- **Styling**: Tailwind CSS v4 + shadcn/ui foundation (`cn`, `Button`, design tokens, `components.json`)
- **Kanban DnD**: `@hello-pangea/dnd`
- **Terminal**: `@xterm/xterm` + `@xterm/addon-fit` (renderer) ↔ WebSocket ↔ core (`node-pty`, native)
- **Persistence**: core's own `JsonStore` (`packages/core/src/json-store.ts`) — same `vibeflow-state.json` the former Electron app's electron-store wrote
- **Diff viewer**: `react-diff-viewer-continued`
- **Diagrams**: `mermaid` — lazy-loaded, `mermaid` markdown fences only
- **Icons**: `lucide-react`
- **Package manager**: npm

---

## Commands

| Task | Command | Notes |
|---|---|---|
| Web UI from source | `npm start` | Builds `app/` once if missing, then runs the `vibeflow` CLI from source (`npm start -- tui`, `npm start -- --profile dev --no-open`). |
| Any CLI command | `npm run vibeflow -- <command>` | `status`, `stop`, `shutdown`, `open <path>`, `doctor`, `tui`, `task …` — see `vibeflow --help` |
| Build Web UI | `npm run build:web` | Static export of the renderer into `app/` (what `vibeflow` serves). `-- --webpack` on restricted runners. |
| Build npm package | `npm run build:npm` | esbuild bundle of core+cli+tui + the Web UI into `dist-npm/`; then `npm pack ./dist-npm`. Never `npm publish` locally — CI publishes with provenance. |
| E2E | `npm run test:e2e` | Playwright (playwright-core, the installed Edge/Chrome) drives the Web UI against a real host with a fake agent. Needs `npm run build:web` first. |
| Doctor | `npm run doctor` | Environment checks; `-- --skip agents` where no agent CLI is installed |
| Create task via CLI | `npm run vibeflow -- task create --project <path> --title <text> --prompt <text> --profile dev` | Creates a board card plus git branch/worktree; use `--profile dev` for the dev store and omit it for the default store. `--help` lists every option |
| Typecheck (core) | `npx tsc --noEmit -p tsconfig.json` | Checks `packages/*/src/**/*.ts` |
| Typecheck (renderer) | `npx tsc --noEmit -p renderer/tsconfig.json` | Delete stale `renderer/.next` first if you see duplicate-type errors |
| Tests | `npm test` | `scripts/run-tests.mjs`: `node --test` over `test/**/*.test.mjs` with TS type-stripping (set through NODE_OPTIONS so Windows cmd works too), so tests import `packages/*/src/*.ts` directly. Headless — no browser, no host. |
| One test file | `node scripts/run-tests.mjs ./test/git.test.mjs` | Same harness, single file — use while iterating |
| Renderer build only | `cd renderer && NODE_ENV=production npx next build` | Same output as `npm run build:web` (`../app`). Uses the default Turbopack compiler for local development. |
| Renderer build only (restricted runner) | `npm run build:renderer:webpack` | Same renderer build but forces `next build --webpack`; use this in Codex sandbox, Docker, or CI when Turbopack IPC / port binding is blocked. |

There is **no linter configured** (no ESLint/Biome/Prettier). Do not invent one unless
asked. "Lint" in the global playbook maps to **typecheck** here.

There **is** a test runner: `npm test` drives Node's built-in `node --test` (no
Jest/Vitest). Run it for any change under `packages/core/` — that is where the existing
coverage lives. See "Runtime verification" below for what belongs in a test versus what
has to be checked in the live app.

### CLI task creation

Create a VibeFlow task without opening the UI:

```sh
npm run vibeflow -- task create \
  --project /path/to/project \
  --title "Fix login bug" \
  --prompt "Investigate and fix the login failure" \
  --status backlog \
  --effort high \
  --attach ./screenshot.png \
  --profile dev
```

- Required flags: `--project`, `--title`, and `--prompt`.
- `--status` accepts `backlog`, `in_progress`, or `done`; it defaults to `backlog`.
  A card written straight into `in_progress` does **not** auto-launch — that only
  happens when a card is moved in the app — so leave CLI-created cards in backlog
  unless you intend to start them from the UI.
- Every other creation option the new-task dialog offers has a flag:
  `--base-branch`, `--branch`, `--mode existing|new` (`new` runs `git init` first),
  `--agent` / `--model`, `--effort low|medium|high|xhigh`, and
  `--attach <path>` (repeat per file; the CLI reads the bytes and infers the mime).
- `--branch` is the branch the task runs on. Left out, the name is derived from
  the card (`branch-name.ts`) and quietly de-duplicated; given explicitly, it is
  created verbatim or the call fails (`INVALID_BRANCH_NAME`,
  `BRANCH_ALREADY_EXISTS` for a local collision, `WORKTREE_DIR_EXISTS`). A name
  that already exists **on origin only** is not an error: the branch is fetched
  and checked out so the card continues that work instead of starting a new
  branch off the base. Same field, same rules, in the new-task dialog.
- `--effort` defaults to `medium`, matching the UI. The default lives in
  `packages/core/src/agents.ts` (`DEFAULT_TASK_EFFORT`) and is applied in
  `createTaskFromInput`, so both entry points produce identical cards.
- Unknown flags are rejected, so a typo fails loudly instead of being ignored.
- `--profile dev` writes to `<appData>/vibeflow (development)/vibeflow-state.json`,
  which is what `npm start -- --profile dev` uses. Omitting `--profile` writes to the
  default store at `<appData>/vibeflow/vibeflow-state.json`. `<appData>` (the same
  directories the former Electron app used) is:
  `~/Library/Application Support` on macOS, `%APPDATA%` on Windows,
  `$XDG_CONFIG_HOME` (or `~/.config`) on Linux.
- `--store-path <dir>` can override the store directory explicitly.
- The command provisions the same git isolation as the UI: it creates a task card,
  branch, and worktree under the target project's `.vibeflow/` directory.
- Verify a CLI-created task with `git worktree list --porcelain` and, when needed, by
  reading the selected store JSON.

### CLI task update

Rewrite an existing card's text or move it between columns:

```sh
npm run vibeflow -- task update \
  --task abc12345 \
  --title "[索引] Fix login bug" \
  --prompt "本卡已拆成 3 張子卡" \
  --status backlog \
  --profile dev
```

- `--task` is required, plus at least one of `--title` / `--prompt` / `--status`.
- `--prompt` with an empty string clears the description; omitting it leaves the
  description untouched. A blank `--title` is ignored rather than blanking the card.
- Only text and column are editable. Branch, worktree and project path are
  provisioned on disk, so `updateTaskFromInput` refuses to touch them — a card must
  not be able to claim a different worktree without re-provisioning.
- `--status` moves the card to the head of the target column. It does **not**
  launch anything: auto-launch only fires when a card is moved in the app.
- A running app picks the change up on its own — `main.ts` watches the store file's
  directory and pushes fresh state to the renderer.

### Launch environment

Every launch exports the running card's identity into its shell, so an agent can
put more cards on the board it is itself running on (see `boardEnvPrefix` in
`packages/core/src/launch.ts` and `packages/core/src/board-cli.ts`):

| Variable | Value |
|---|---|
| `VIBEFLOW_TASK_ID` | the card's id — what `task update --task` takes |
| `VIBEFLOW_PROJECT_PATH` | the card's project — what `task create --project` takes |
| `VIBEFLOW_BRANCH` / `VIBEFLOW_BASE_BRANCH` | the card's branch and its base |
| `VIBEFLOW_STORE_DIR` | store dir of the **running** app — pass it as `--store-path` instead of guessing `--profile` |
| `VIBEFLOW_CLI` / `VIBEFLOW_CLI_LOADER` | From source: `scripts/vibeflow.mjs` and the loader it needs (a `file://` URL — `node --import` rejects a bare Windows `C:/…` path). From the npm build: the bundled `dist/vibeflow.mjs`, with **no** loader. |
| `VIBEFLOW_AUTO_MODE` | `1` / `0` |

`VIBEFLOW_CLI` being absent is the signal that the board is read-only for the agent;
anything that writes cards must degrade instead of emitting a command that cannot run.
Call the CLI by absolute path — the agent's cwd is its worktree, not this repo:

```sh
if [ -n "$VIBEFLOW_CLI_LOADER" ]; then
  node --experimental-strip-types --import "$VIBEFLOW_CLI_LOADER" "$VIBEFLOW_CLI" task create ...
else
  node "$VIBEFLOW_CLI" task create ...
fi
```

---

## Project structure

```
packages/                  npm workspaces (see packages/core/IPC_API_MAP.md)
├── core/src/              ALL business logic; no electron / react / next (test/core-boundary)
│   ├── service.ts         createCore(): THE handler table (channel → fn) every transport exposes;
│   │                      validates input, takes task ids only, builds agent commands itself
│   ├── client.ts          createBridge(transport): the frontend API (window.vibeflow) — types-only imports
│   ├── ws-transport.ts    BridgeTransport over the WebSocket protocol (browser + TUI) — types-only
│   ├── local-transport.ts BridgeTransport calling the handler table in-process (TUI as host)
│   ├── web-server.ts      HTTP static + WebSocket; loopback, token→cookie, Origin/Host checks
│   ├── lock.ts            <userData>/core.lock (pid, port, token; 0600): one host per machine
│   ├── launch.ts          agent launch-command assembly (was renderer/lib/claude.ts) — types-only
│   ├── session-backend.ts SessionBackend interface; sessions.ts picks tmux or pty
│   ├── pty.ts / tmux-backend.ts  PtyBackend (node-pty, dies with core) / TmuxBackend (-L vibeflow, outlives it)
│   ├── events.ts          EventSink + EventBus (every event fans out to every frontend)
│   ├── platform.ts        PlatformServices: userData dir, source root, CLI entry, open
│   ├── json-store.ts      JsonStore: electron-store-compatible JSON file, atomic writes
│   ├── store.ts           VibeFlowState, Task, board mutators (LAZY init)
│   ├── tasks.ts           create / update a card (UI and CLI share it)
│   ├── git.ts             git via child_process: info / worktree / diff / commit+push
│   └── artifacts.ts, decisions.ts, recent-projects.ts, library.ts, subagents.ts, …
├── cli/src/               `vibeflow` command: main.ts (dispatch), host.ts (lock+core+server),
│                          remote.ts (client of a running host), doctor.ts, task-command.ts
├── tui/src/index.ts       Ink board; Enter = tmux attach, or pty passthrough (Ctrl+] back)
└── web/                   placeholder — the Web UI is still /renderer

renderer/                  Next.js app (Pages Router)
├── pages/
│   ├── _app.tsx           imports xterm CSS + globals.css; installs the WebSocket bridge
│   └── home.tsx           container: loads state, owns dialogs, wires the board
├── components/
│   ├── kanban-board.tsx   board + cards (drag handle scoped to header)
│   ├── task-terminal.tsx  xterm terminal (dynamic import, client-only)
│   ├── new-task-dialog.tsx per-task project picker + git detect + create
│   ├── project-folder-picker.tsx recent-projects select + typed path; flags lost paths
│   ├── task-workspace-panel.tsx  selected task workspace: terminal + task/決策/artifacts/diff
│   └── ui/button.tsx      shadcn button
├── lib/
│   ├── types.ts           re-exports domain types FROM core (single source of truth)
│   ├── api.ts             bridge-safe wrappers over window.vibeflow
│   ├── web-bridge.ts      window.vibeflow over a WebSocket to the core that served the page
│   ├── claude.ts          re-export of core's launch.ts (pure display helpers)
│   └── utils.ts           cn()
├── styles/globals.css     Tailwind v4 + shadcn design tokens (dark theme)
└── preload.d.ts           declares window.vibeflow (core's VibeFlowApi)

e2e/web.e2e.mjs            Playwright: the Web UI's main flow against a real host
```

---

## Architecture & conventions

- **Frontends reach core only through the handler table.** Add a feature in this order:
  1. Logic in `packages/core/src/*.ts` (anything host-specific goes through `PlatformServices`).
  2. A `'ns:action'` entry in the handler table in `service.ts`. Validate every
     argument (`requireTask`, `str`, `obj`, …) — the same table is reachable over
     the WebSocket. Take task ids, never paths or commands; a path is acceptable
     only where no task exists yet (project picking).
  3. Method on the object in `client.ts` (typed). The browser and the TUI both
     get it from there.
  4. Wrapper in `renderer/lib/api.ts` (must no-op / return null when the bridge is absent).
  5. Use it from a component via `lib/api`.
  Host-only channels (`host:shutdown`, `host:info`) live in
  `packages/cli/src/host.ts`. Update `packages/core/IPC_API_MAP.md` when the table changes.
- **Events go on the bus.** Emit with `bus.emit(channel, payload)` (or `bus.sink()`
  for helpers written against a single `EventSink`); every connected frontend gets it.
- **Core never builds a UI concept or reads one**: no selected tab, no expanded card.
  The frontend sends intents (`pty:start` with `launch: { resume, includeTaskPrompt }`),
  and core resolves cwd and command from the task.
- **Single source of truth for types**: domain types live in `packages/core/src/*.ts`;
  `renderer/lib/types.ts` re-exports them with `export type` (erased at build).
  The renderer imports core at runtime only from the types-only modules
  (`launch.ts`, `client.ts`, `ws-transport.ts`); `test/core-boundary` enforces it.
  Don't duplicate type definitions.
- **Erasable TypeScript only in `packages/`**: Node runs it with
  `--experimental-strip-types`, so no enums, namespaces or constructor parameter
  properties (`test/core-boundary` enforces it).
- **The store must be constructed lazily** (`getStore()` in `store.ts`), never
  at import time — it binds to `PlatformServices.userDataDir()`, which the host
  registers at startup from `--profile` / `--store-path`. Eager construction binds
  the wrong path. (This was a real bug.)
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
- **A task's decision record is the one account that outlives it.** The agent is
  told at launch (`buildDecisionPrompt` in `packages/core/src/launch.ts`) to keep
  `<workspacePath>/<worktree-dir>.DECISIONS.md` up to date as it makes decisions.
  It sits in the workspace folder, not the worktree or the artifacts dir, so
  completing the task does not delete it — only deleting the card does. It
  records *decisions and their reasons*, never what changed: that is captured
  from git into `TaskOutcome` and shown on the task view. Reading it after
  completion means resolving the path from `task.branch` rather than
  `worktreePath`, which cleanup clears — see `decisionsKey`.
- **Markdown renders in the renderer** through
  `components/markdown-content.tsx` → `markdown-body.tsx`. Raw HTML is disabled.
  Verbatim text (sub-agent prompts, logs, non-`.md` artifacts) stays in a `<pre>`.
  The single exception is a `mermaid` fence, which `markdown-body` hands to
  `mermaid-diagram.tsx` and which reaches the DOM as markup; `securityLevel: 'strict'`
  plus root-level `htmlLabels: false` are what keep that output inert, and
  `ui-consistency` fails if either is relaxed. mermaid is imported dynamically, never
  at module scope — it is the heaviest chunk in the renderer and has no place in the
  initial bundle. An idle callback in `pages/_app.tsx` warms it once — chunk **and** a
  throwaway render, since mermaid's first render costs more than its import. Left cold,
  the first diagram of a session lands ~350ms after the text around it and grows its
  panel a second time, which reads as a scrollbar flicker.

---

## Definition of Done

A change is done only when, on the affected scope:

1. `npx tsc --noEmit -p tsconfig.json` — clean (if `packages/` touched).
2. `npx tsc --noEmit -p renderer/tsconfig.json` — clean (if `renderer/` touched).
3. `npm test` — green. Add cases for new `packages/core/` behaviour; the `ui-consistency`
   suite also guards renderer class conventions, so renderer changes can trip it.
4. `npm run build:web` — succeeds for local renderer changes (`npm run build:web -- --webpack` in Docker, sandbox, or CI-like restricted runners).
5. `npm run test:e2e` — green for changes to the Web UI flow, the transport or the handler table.
6. For behavioral changes, a **runtime check** in the live Web UI (see below).

If you staged the npm package (`npm run build:npm`), install the `npm pack` tarball into a temp prefix and run `vibeflow doctor`.

---

## Runtime verification (how this repo is tested)

Two layers: `npm test` covers core, the CLI and the WebSocket server headlessly;
the Web UI is driven in a browser against a real host.

- **`packages/core/src/*` logic** belongs in `test/<helper>.test.mjs` (`node:test` +
  `node:assert/strict`). The harness strips types, so tests import the `.ts` helper
  directly. `test/support/repo.mjs` provides `makeRepo()` for a throwaway repo with an
  optional bare remote, plus `git()` / `writeFile()` / `exists()` — use it instead of
  hand-rolling git fixtures. `test/ui-consistency.test.mjs` is the odd one out: it greps
  renderer sources for design-system violations (radius ladder, `focus-visible:ring-[3px]`
  on hand-written buttons, `DialogShell` headers) rather than executing anything.
- **Handler behaviour** is unit-testable with `createCore` and a fake `SessionBackend`
  (`test/service.test.mjs`); the WebSocket guards with `startWebServer`
  (`test/web-server.test.mjs`). Call `core.shutdown()` in `t.after` — `pty:start`
  starts a file watcher that otherwise keeps the test process alive.
- **Web UI behaviour**: `npm run test:e2e`, or by hand: `npm start -- --store-path <tmp dir> --no-open --port 47831`
  and open the printed URL. Use a throwaway `--store-path`, never your real store.
  Renderer changes need `npm run build:web` before the host serves them — there is
  no hot-reload dev server.
- Stop a `vibeflow` host with `vibeflow shutdown` (same `--store-path` / `--profile`).
- Clean build artifacts before committing: `rm -rf app renderer/.next` (both gitignored).

---

## Gotchas

- **node-pty is native, but do not force a source rebuild by default.**
  `node-pty@1.1.0` ships prebuilt binaries for Windows/macOS, and Windows source
  rebuilds fail in bundled winpty/MSVC. `postinstall` only runs
  `npm run check:node-pty` to verify the installed binary can load (and marks the
  macOS/Linux `spawn-helper` executable). If node-pty is bumped, confirm prebuild
  support first.
- **Stale `renderer/.next` types** can cause phantom "Duplicate identifier" tsc errors —
  `rm -rf renderer/.next` and re-run.
- `dist/`, `dist-npm/`, `app/`, `.next/`, `node_modules/` are gitignored — never commit build output.

---

## Worktree session rules

Each VibeFlow task runs Claude inside a **git worktree** at
`.vibeflow/<branch>/` under the target project. When the session's
`primary working directory` is a worktree path, these rules are **mandatory**:

- **All file reads and writes must use paths inside the worktree.**
  The worktree is a full, independent copy of the repo — edit files relative
  to the session cwd, never via the parent repo's absolute path.

  ```
  ✅  renderer/components/foo.tsx          (relative to session cwd)
  ✅  /Users/.../VibeFlow/.vibeflow/vf-abc123/renderer/components/foo.tsx
  ❌  /Users/.../VibeFlow/renderer/components/foo.tsx  (parent repo — wrong)
  ```

- **All `git` commands must run inside the worktree directory**, not the
  parent repo. Running `git` in the parent repo operates on `main`, not the
  feature branch.

- At session start, confirm the cwd is the worktree before any file op:
  `pwd` should end with `.vibeflow/<branch>`.

Violating these rules causes commits to land on `main` instead of the
feature branch — exactly the failure mode this rule is designed to prevent.

---

## Git / PR

- Commit messages in English; conventional-commit prefixes (`feat:`, `fix:`, `chore:`,
  `docs:`, `build:`). End the body with the `Co-Authored-By` trailer.
- Push only when asked. Do not `npm install` new deps without flagging it.
