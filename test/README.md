# Tests

Headless tests for `packages/core`, the CLI, the TUI and the renderer's pure
helpers — no browser, no test framework, no extra dependencies. They run on
Node's built-in test runner (`node:test`) with native TypeScript type-stripping,
matching the "Runtime verification" section of the repo [AGENTS.md](../AGENTS.md).

## Run

```bash
npm test
```

Which expands to:

```bash
NODE_OPTIONS="--experimental-strip-types --import ./test/support/register.mjs" \
  node --test "./test/**/*.test.mjs"
```

- `--experimental-strip-types` lets Node import the `.ts` source files directly.
- `--import ./test/support/register.mjs` installs a resolve hook
  (`ts-resolver.mjs`) that fixes the extensionless relative imports the source
  files use (e.g. `from './env'` → `./env.ts`). It only kicks in when default
  resolution fails, so builtins and `node_modules` are untouched.
- Passing the flags via `NODE_OPTIONS` is required so they also reach the child
  process each test file runs in. Setting them from a script rather than an
  inline `NODE_OPTIONS=… node` prefix is what makes this work in Windows' cmd.

## What is covered

| Suite | Target | What it checks |
|---|---|---|
| `terminal-files.test.mjs` | core `terminal-files.ts`, renderer `terminal-file-links.ts` | terminal path candidates, safe local resolution, bounded previews and error handling |
| `agent-models.test.mjs` | `packages/core/src/agent-models.ts`, `claude-models.ts`, `codex-models.ts`, `json-lines-process.ts` | model catalog: Claude `initialize` and codex app-server handshakes against `fixtures/agent-models/`, account fields dropped, fallbacks, child-process timeout/exit, in-memory cache |
| `jev-router.test.mjs` | `packages/core/src/jev-router.ts` | current-model effort selection, supported-level validation, credential and model-default fallback |
| `jev-credentials.test.mjs` | `packages/core/src/jev-credentials.ts` | host-only key file under a macOS-style data path, environment fallback, permissions and validation |
| `agent-print.test.mjs` | `packages/core/src/agent-print.ts` | one-shot agent CLI runs: stdin prompt, exit codes, missing CLI |
| `commit-message.test.mjs` | `packages/core/src/git.ts` (`generateCommitMessage`) | per-CLI headless argv (Claude `haiku`, Codex `exec` on a low-cost model) with fake `claude` / `codex` on PATH |
| `agents.test.mjs` | `packages/core/src/agents.ts` | agent registry, default model, default task effort |
| `effort.test.mjs` | `packages/core/src/effort.ts` | effort levels, per-model allowed levels, lowering an unsupported effort |
| `artifacts.test.mjs` | `packages/core/src/artifacts.ts` | artifact dir path, listing and file classification |
| `attachments.test.mjs` | `packages/core/src/attachments.ts` | writing task attachments safely; CLI `--attach` mime inference |
| `branch-name.test.mjs` | `packages/core/src/branch-name.ts` | slug/ticket derivation, edge & malformed input, the injected title translator (only non-ASCII titles reach it; failures fall back) |
| `claude.test.mjs` | `packages/core/src/launch.ts` | launch prompt assembly: custom system prompt, artifact environment paths, the `--settings` hooks |
| `claude-chrome.test.mjs` | `packages/core/src/launch.ts` | the Chrome flag on Claude launches only |
| `core-boundary.test.mjs` | `packages/core/src/**` | static guard — no electron / react / next imports, no reaching outside core, types-only renderer imports, erasable TypeScript only |
| `decisions.test.mjs` | `packages/core/src/decisions.ts` | legacy decision record cleanup: key before and after worktree cleanup |
| `diff-state.test.mjs` | `renderer/lib/diff-state.ts` | diff polling keeps references and bodies stable |
| `env.test.mjs` | `packages/core/src/env.ts` | PATH augmentation + memoisation |
| `folder-dialog.test.mjs` | `packages/core/src/folder-dialog.ts` | per-OS folder-dialog commands (user text never in a script), cancel detection, output parsing |
| `github-filter.test.mjs` | `renderer/lib/github-filter.ts` | Issues & PRs filters: OR within a filter, AND across, unassigned, options (ticked values kept), project-then-number order, one column per repo |
| `github.test.mjs` | `packages/core/src/github.ts` | remote → `owner/repo`, `gh` issue/PR listing and merging (fake runner, no network), `issueType` fallback, per-repo cache and errors, card ↔ Issue/PR link resolution |
| `jira.test.mjs`, `jira-adf.test.mjs`, `jira-columns.test.mjs` | Jira core and renderer helpers | acli JQL/JSON conversion, attachment metadata, ADF Markdown, auth status, cache, status columns and due-date sorting |
| `git.test.mjs` | `packages/core/src/git.ts` | integration against throwaway repos (+ a bare remote): info, worktrees, sync |
| `pr-status.test.mjs` | `packages/core/src/git.ts` (`getPrStatus`) | a PR lookup that runs out of time is killed instead of left running with the worktree as its cwd (a fake `gh` on PATH; skipped on Windows) |
| `commit-diff.test.mjs` | `packages/core/src/commit-diff.ts` | a branch's commits and per-commit files; done-card reads from a merged base, a squash (gh fallback with a fake runner), and the no-PR reason |
| `git-bash.test.mjs` | `packages/core/src/git-bash.ts` | locating Git Bash on Windows |
| `json-store.test.mjs` | `packages/core/src/json-store.ts`, `chat-store.ts` | reads electron-store-era files, atomic writes, corrupt-file refusal |
| `library.test.mjs` | `packages/core/src/library.ts` | library entries: naming, frontmatter, per-kind storage; delivery (plugin dir, CODEX_HOME, prompt text) |
| `builtin-pr-skills.test.mjs` | `builtin-skills/pr-watch/scripts/*.mjs`, `builtin-skills/address-review/scripts/*.mjs` | unanswered-item detection via the reply marker, watcher event priority/backoff/state, both scripts run against a fake `gh` |
| `lock.test.mjs` | `packages/core/src/lock.ts` | one host per machine: takeover of dead locks, port, file mode |
| `mailbox.test.mjs` | `packages/core/src/mailbox.ts` | typing for someone else: bracketed paste + Enter, no typing into a permission dialog, waits for a person to stop typing, never splits a delivery, sender tag |
| `notifier.test.mjs` | `packages/core/src/notifier.ts` | what a master's card cannot say itself (permission dialog, launch failure, session end, unreported turn) reaches its master once, waits while it cannot take it, dropped once it is done |
| `continuation.test.mjs` | `packages/core/src/continuation.ts`, `progress.ts` | the brief a card's new session starts from: parts and their order, omission of what could not be read, size caps, the master variant, and the transcript's last reply (`fixtures/progress/claude-last-reply.jsonl`) |
| `progress.test.mjs` | `packages/core/src/progress.ts` | transcript reducers against recorded fixtures (`fixtures/progress/`): todo lists, usage de-duplication, activity, hook events, notification diffs |
| `progress-tracker.test.mjs` | `packages/core/src/progress-tracker.ts` | finding a card's transcripts under a temp home: incremental reads, run filtering, Codex cwd matching, hook event files, no back-filled notifications |
| `platform.test.mjs` | `packages/core/src/platform.ts` | per-OS userData resolution, Node platform defaults |
| `pty-helper.test.mjs` | `packages/core/src/pty-helper.ts` | node-pty `spawn-helper` executable bit and its fix command |
| `recent-projects.test.mjs` | `packages/core/src/recent-projects.ts` | recent-project ordering, replacement and lost-folder flags |
| `service.test.mjs` | `packages/core/src/service.ts` | the handler table with a fake session backend: launches, resume, refusals, progress events and usage folded into the card, `continueTask` (usage folded once, brief as the first message, busy / duplicate / failed-start handling) |
| `subagents.test.mjs` | `packages/core/src/subagents.ts` | resetting sub-agent hook events |
| `task-order.test.mjs` | `renderer/lib/task-order.ts` | newest-first card ordering |
| `board-moves.test.mjs` | `renderer/lib/board-moves.ts` | which column drops are allowed and what each means |
| `tasks-create.test.mjs` | `packages/core/src/tasks.ts` | card creation defaults (Auto Mode) |
| `master-cards.test.mjs` | `packages/core/src/tasks.ts`, `service.ts`, `launch.ts` | master cards: no project or git, own folder, master links, `startTask`, summaries, delete/reset safety, master prompt, `continueTask` on a master and on a master's card, master ↔ card messages, VibeFlow's notes to a master |
| `tasks-update.test.mjs` | `packages/core/src/tasks.ts` | card updates: text patching, provisioned fields kept |
| `task-cli.test.mjs` | `packages/cli/src/task-command.ts` | the `vibeflow task` CLI as an agent shell runs it: a master's new cards default to it, `task send` errors, `task start --new-session` flag checks |
| `pty-backend.test.mjs` | `packages/core/src/pty.ts` | real node-pty sessions: re-attach to a running one; fresh, new command or new folder replaces it; a replacement keeps the old size unless it brings its own |
| `terminal-fit.test.mjs` | `renderer/lib/terminal-fit.ts` | terminal column fitting against scrollbar rounding |
| `tmux-backend.test.mjs` | `packages/core/src/tmux-backend.ts` | tmux sessions: start, re-attach, a replacement keeping the old client's size, exit status, kill vs. detach |
| `tui.test.mjs` | `packages/tui/src/index.ts` | TUI board moves and selection |
| `tui-task-form.test.mjs` | `packages/tui/src/task-form.ts` | TUI new/edit task form defaults and validation |
| `update-command.test.mjs` | `packages/cli/src/update-command.ts`, `main.ts` | global npm update command, source/local/npx/link refusal, npm failure and CLI dispatch |
| `update-check.test.mjs` | `packages/cli/src/update-check.ts` | npm latest comparison, release status, the two-hour interval, and the installed-but-not-restarted notice |
| `self-update.test.mjs` | `packages/cli/src/self-update.ts` | detecting a finished npm install, the replacement host's arguments, and the handed-over token |
| `update-terminal.test.mjs` | `packages/cli/src/update-terminal.ts` | OS terminal command and privilege level, launch errors |
| `ui-consistency.test.mjs` | `renderer/**` (source grep) | design-system rules: radius ladder, focus rings, `DialogShell` headers, terminal inset, inert mermaid |
| `web-server.test.mjs` | `packages/core/src/web-server.ts`, `ws-transport.ts` | loopback only, token → cookie, Host / Origin checks |

`test/support/` holds the harness: the resolve hook, its registrar, and
`repo.mjs` (creates isolated throwaway git repos with deterministic identity so
tests never touch the user's git config or network).

## Known gaps (not covered here)

- The renderer components — need a DOM runtime; out of scope for the headless
  suite. `e2e/web.e2e.mjs` (`npm run test:e2e`) drives the Web UI end to end.
