# Implementation and verification

1. Remove Artifact and Library text from `buildAgentCommand`, while keeping custom system prompt and card text.
2. Prepare the Artifacts directories in core at task launch, export their paths into the task shell, and add a core copy operation exposed through `vibeflow task artifact add`.
3. Update Library and Settings copy to describe the new behavior.
4. Stop delivering Library skills at launch: drop `--plugin-dir` / Library `--add-dir` and the Library `CODEX_HOME`, delete `buildPluginDir` / `buildCodexHome` / `libraryLaunchInfo`, and remove the Library enable toggle. Keep reading the old Library `codex-home/sessions` so earlier Codex runs still report progress.
5. Verify prompt assembly, directory creation, file copy and collision handling with Node tests; run both TypeScript checks, the full Node suite, the Web UI build and E2E flow.

## Verification

- Core and renderer TypeScript checks: passed.
- `npm test`: 445/445 passed (the removed Library delivery tests account for the drop). The service launch test also checks directory creation and exported paths; `claude.test.mjs` pins that neither CLI gets `--plugin-dir` or `CODEX_HOME`.
- `npm run build:web`: passed.
- `npm run test:e2e`: 3/3 passed against a real host with a fake agent.
- Direct CLI check with a temporary store and task: `task artifact add --file` copied the file to the expected Artifacts root.
