# Tests

Headless tests for the Electron main-process helpers — no Electron, no test
framework, no extra dependencies. They run on Node's built-in test runner
(`node:test`) with native TypeScript type-stripping, matching the
"runtime verification" approach documented in the repo `CLAUDE.md`.

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
  process each test file runs in.

## What is covered

| Suite | Target | Style |
|---|---|---|
| `branch-name.test.mjs` | `main/helpers/branch-name.ts` | pure unit — slug/ticket derivation, edge & malformed input |
| `env.test.mjs` | `main/helpers/env.ts` | pure unit — PATH augmentation + memoisation |
| `progress.test.mjs` | `main/helpers/progress.ts` | unit against temp files — parse/validate + watcher emit/dedupe |
| `git.test.mjs` | `main/helpers/git.ts` | integration against throwaway repos (+ a bare remote) |

`test/support/` holds the harness: the resolve hook, its registrar, and
`repo.mjs` (creates isolated throwaway git repos with deterministic identity so
tests never touch the user's git config or network).

## Known gaps (not covered here)

- `main/helpers/store.ts` — board/role mutators are inseparable from
  `electron-store`, which requires an Electron `app` runtime. Best verified via
  the CDP-driven live-app path in `CLAUDE.md`.
- `main/main.ts` IPC handlers, `pty.ts`, and the renderer components — need an
  Electron/DOM runtime; out of scope for the headless suite.
