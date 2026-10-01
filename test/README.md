# Tests

Headless tests for `packages/core` and the CLI — no browser, no test
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
| `branch-name.test.mjs` | `packages/core/src/branch-name.ts` | pure unit — slug/ticket derivation, edge & malformed input |
| `env.test.mjs` | `packages/core/src/env.ts` | pure unit — PATH augmentation + memoisation |
| `git.test.mjs` | `packages/core/src/git.ts` | integration against throwaway repos (+ a bare remote) |
| `json-store.test.mjs` | `packages/core/src/json-store.ts`, `chat-store.ts` | reads electron-store-era files, atomic writes, corrupt-file refusal |
| `platform.test.mjs` | `packages/core/src/platform.ts` | per-OS userData resolution, Node platform defaults |
| `core-boundary.test.mjs` | `packages/core/src/**` | static guard — no electron / react / next imports, no relative imports outside core |

`test/support/` holds the harness: the resolve hook, its registrar, and
`repo.mjs` (creates isolated throwaway git repos with deterministic identity so
tests never touch the user's git config or network).

## Known gaps (not covered here)

- The renderer components — need a DOM runtime; out of scope for the headless
  suite. `e2e/web.e2e.mjs` (`npm run test:e2e`) drives the Web UI end to end.
