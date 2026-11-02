# Task form layout (create + edit)

## Problem

The create form lived in the workspace pane (where a card's terminal shows) as
a two-column grid: title on top, project and git settings on the left,
description, effort and Auto Mode on the right, and the agent and model hidden
under a collapsed "Advanced" section at the bottom. The reading order zig-zagged,
effort sat away from the model it depends on, and a four-bullet explanation of
what happens at launch took half the left column. The edit dialog used yet
another field order. Both often have only about half the screen height.

## Decision

Create and edit share one layout (design option B, canvas
"VibeFlow 卡片表單版面提案"):

- **Left: content.** Title (large, borderless), description filling the rest of
  the height, attachments (create only) at the bottom. Files can be dropped
  anywhere on this column.
- **Right: property sidebar**, two groups of compact rows:
  - **位置**: project, base branch, branch, 隸屬於 (only when the board has a
    master card). A one-line note says the branch and worktree are created at
    launch; the details are behind a disclosure. A master card shows its work
    directory here instead.
  - **執行**: Agent, Model, 推理強度 (a select of the levels the model accepts),
    Auto Mode.
  - Cancel and the primary button sit at the bottom of the sidebar.
- **540px tall is the baseline.** Everything fits at that height; extra height
  only grows the description. Below `md` width the sidebar stacks under the
  content and the dialog scrolls.
- **Create opens as a popup dialog** from the side menu's「新增任務」. The
  workspace pane with no card selected shows an empty state with a button that
  opens the same dialog. The dialog closes when the card is created and stays
  open with the error otherwise.
- **Role**: the create header has a「一般任務 / Master」switch (was
  「Slave / Master」). Edit shows the role as a read-only badge — core cannot
  change a card's role.

## Non-goals

- No change to core, the handler table or the stored task shape.
- Changing a card's role while editing.
