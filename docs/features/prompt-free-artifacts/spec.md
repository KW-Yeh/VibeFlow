# Prompt-free task artifacts

## Goal

A task launch sends exactly the user's custom system prompt and the card's title and description. Artifact directory setup and file delivery belong to VibeFlow's runtime instead of an always-on instruction block, and the Library is storage only.

## Behavior

- A launch never appends Library prompt bodies, Library script listings, or Artifact instructions to the agent's prompt.
- A launch loads no Library skill either: Claude gets no `--plugin-dir` / Library `--add-dir`, Codex gets no VibeFlow-assembled `CODEX_HOME`. Skills each CLI discovers on its own (user and project skill directories) are the user's setup and stay as they are.
- Library skills, prompt snippets and scripts remain editable in Settings → Library; the per-entry enable toggle is gone because nothing consumes it.
- Before an agent starts, core creates its Artifacts root and `scratch/` directory. The task shell exposes them as `VIBEFLOW_ARTIFACTS_DIR` and `VIBEFLOW_SCRATCH_DIR`.
- `vibeflow task artifact add --file <path>` copies a chosen file into that task's Artifacts root. In a task shell, the card ID and store directory come from `VIBEFLOW_TASK_ID` and `VIBEFLOW_STORE_DIR`. The command preserves an existing file by choosing a numbered name.

## Boundary

VibeFlow cannot infer which arbitrary file an agent intended to show the user. Delivering a file from outside the Artifacts root remains an explicit action.
