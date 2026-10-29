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
| [terminal-file-preview](features/terminal-file-preview/spec.md) ([plan](features/terminal-file-preview/plan.md)) | Click local file paths in task and independent terminals to preview images and text |
| [workspace-layout](features/workspace-layout/spec.md) ([plan](features/workspace-layout/plan.md)) | A running card's workspace: one toolbar shared with the terminal, and an inspector that docks or folds into an icon rail |
| [cli-update](features/cli-update/spec.md) | Add `vibeflow update` to install the latest npm release from the CLI |
| [npm-update-notice](features/npm-update-notice/spec.md) | Check npm every two hours, show a newer-version notice, and display the running version in Settings |
| [view-persistence](features/view-persistence/spec.md) | A reload keeps the current view, open card and tabs, work-item filters, and the 終端機 page's running shells |
| [organize-files](features/organize-files/spec.md) | Move the root-level docs into `docs/` and add this index |
| [builtin-skills](features/builtin-skills/spec.md) ([plan](features/builtin-skills/plan.md)) | Ship built-in skills (visual-parity, generic pr) in every user's Library; default evidence outputs to task Artifacts and temporary files to scratch |
| [spec-tab](features/spec-tab/spec.md) | The 決策 tab shows the branch's `spec.md` instead of a separate decision record |
| [lazy-branch-provisioning](features/lazy-branch-provisioning/spec.md) | Create the branch/worktree when a card starts, not when it is created; only backlog cards are editable |
| [task-progress](features/task-progress/spec.md) | Derive each card's progress (todo list) and token usage from the agent's own JSONL transcript instead of model-written progress files; hook-driven stage notifications with toggles |
| [github-issues-prs](features/github-issues-prs/spec.md) | Replace the sidebar task tree with an Issues & PRs view (GitHub via `gh`), convert an Issue/PR into a Backlog card, and show each card's linked Issue/PR |
| [github-filters](features/github-filters/spec.md) | Project / assignee / author multi-select filters and project-then-number ordering in the Issues & PRs view; PRs I have reviewed stay listed |
| [agent-model-catalog](features/agent-model-catalog/spec.md) | Claude Code and Codex model lists from the signed-in local CLIs (`claude` stream-json `initialize`, `codex app-server` `model/list`; no API key, no prompt), and the effort slider follows each model's supported levels (adds `max` / `ultra`); falls back to the builtin lists |
| [jev-routing](features/jev-routing/spec.md) ([plan](features/jev-routing/plan.md)) | Use Jev to select effort for `auto` cards under the current model |

| [jira-inbox](features/jira-inbox/spec.md) | Atlassian sign-in via `acli jira auth login --web` and a Jira tab of tickets assigned to me; Issues & PRs split into Jira / Issues / PRs tabs with their own filters; the terminal pane is hidden outside the board; item details in a modal; one-click card creation |
| [work-order-page](features/work-order-page/spec.md) ([plan](features/work-order-page/plan.md)) | Refine the shared work-item view, Jira ticket layout, project selection, links, and attachment access |
| [jira-board-scope](features/jira-board-scope/spec.md) ([plan](features/jira-board-scope/plan.md)) | Show Jira work items in four full-width columns and filter the Jira fetch scope |
| [terminal-grid](features/terminal-grid/spec.md) ([plan](features/terminal-grid/plan.md)) | Independent project-folder terminals in a top-level grid, with one-click card actions |
| [prompt-free-artifacts](features/prompt-free-artifacts/spec.md) ([plan](features/prompt-free-artifacts/plan.md)) | A launch sends only the custom system prompt and the card: no Library skills, prompt snippets or Artifact text; Artifact directories are created in core and files delivered explicitly through the task CLI |

## Adding a document

- New feature work → `features/<slug>/spec.md` + `plan.md`.
- Add a row to this index in the same change.
- Docs that sit next to code stay there: `packages/core/IPC_API_MAP.md` and
  `test/README.md`.
