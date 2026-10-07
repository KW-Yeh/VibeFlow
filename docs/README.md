# VibeFlow docs

Everything about VibeFlow that is not code lives here. The repo root keeps
only the entry points: [README.md](../README.md) for users and
[AGENTS.md](../AGENTS.md) for anyone changing the code (architecture, commands,
conventions, Definition of Done). Where a document here disagrees with the code
or with `AGENTS.md`, the code and `AGENTS.md` are right.

## Reference

| Document | What it is |
|---|---|
| [DESIGN.md](DESIGN.md) | Design-system reference (colors, type, radius, components). `renderer/styles/globals.css` derives its tokens from it; `test/ui-consistency.test.mjs` enforces the radius ladder. |

## Plans (decision records)

Plans and specs written before `features/` existed. Each was implemented, and
each keeps the reasoning behind its choices. Several describe the Electron app
that has since been removed — the status note at the top of each file says what
changed and where the code lives now.

| Document | Feature | Status |
|---|---|---|
| [CORE_SPLIT_PLAN.md](plans/CORE_SPLIT_PLAN.md) | Split the logic into `packages/core`; Web UI + TUI replace Electron | Done — Electron removed 2026-10-01 |
| [AGENT_MODELS_PLAN.md](plans/AGENT_MODELS_PLAN.md) | Model lists from the agent CLIs instead of provider API keys | Done |
| [LIBRARY_PLAN.md](plans/LIBRARY_PLAN.md) | VibeFlow's own skill / prompt / script library, delivered to both agents | Done (Phase 4 not marked in the plan) |
| [MARKDOWN_RENDERING_PLAN.md](plans/MARKDOWN_RENDERING_PLAN.md) | One GFM pipeline for every Markdown surface | Done; the plan-HTML path it covers was removed later |
| [TERMINAL_TABS_PLAN.md](plans/TERMINAL_TABS_PLAN.md) | VSCode-style terminal tabs | Done |
| [REMOTE_SPEC.md](plans/REMOTE_SPEC.md) | Phone remote control over PeerJS | Host side done (in the Web UI); the phone web app is not in this repo |

## Features

One directory per feature, each with a `spec.md` (what and why) and a
`plan.md` (how, and how it was verified).

| Feature | Summary |
|---|---|
| [organize-files](features/organize-files/spec.md) | Move the root-level docs into `docs/` and add this index |
| [builtin-skills](features/builtin-skills/spec.md) | Ship built-in skills (visual-parity, generic pr) in every user's Library |
| [spec-tab](features/spec-tab/spec.md) | The 決策 tab shows the branch's `spec.md` instead of a separate decision record |
| [lazy-branch-provisioning](features/lazy-branch-provisioning/spec.md) | Create the branch/worktree when a card starts, not when it is created; only backlog cards are editable |
| [task-progress](features/task-progress/spec.md) | Derive each card's progress (todo list) and token usage from the agent's own JSONL transcript instead of model-written progress files; hook-driven stage notifications with toggles |
| [github-issues-prs](features/github-issues-prs/spec.md) | Replace the sidebar task tree with an Issues & PRs view (GitHub via `gh`), convert an Issue/PR into a Backlog card, and show each card's linked Issue/PR |
| [agent-model-catalog](features/agent-model-catalog/spec.md) | Claude Code and Codex model lists from the signed-in local CLIs (`claude` stream-json `initialize`, `codex app-server` `model/list`; no API key, no prompt), and the effort slider follows each model's supported levels (adds `max` / `ultra`); falls back to the builtin lists |

## Adding a document

- New feature work → `features/<slug>/spec.md` + `plan.md`.
- Add a row to this index in the same change.
- Docs that sit next to code stay there: `packages/core/IPC_API_MAP.md` and
  `test/README.md`.
