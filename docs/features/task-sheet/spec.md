# Task sheet (board click) and inbox create sheet

## Problem

- Clicking a card on the board jumped to the workspace page. Most of the time
  the user only wanted to read the card, and leaving the board lost their place.
  The workspace's rail also lists a Backlog card under the running cards, which
  reads as if it had already started.
- Creating a card from the inbox (Jira / Issues / PRs) was one click that copied
  the whole ticket or PR body into the card. It could not make a master card,
  and a PR card is usually a review, so the copied body was the wrong prompt.

## Decision

- **Board click opens the card's sheet** — the same slide-in frame as the
  create dialog (`TaskFormDialog`). The board stays where it was.
  - **Backlog**: editable (title, description, project, branches, master, run
    settings), with 儲存變更 and a hold-to-delete button.
  - **In Progress / Done**: read-only (core only edits Backlog cards), with
    「前往工作區」 and hold-to-delete. The header names the column.
  - The card menu's「編輯任務」opens the same sheet. The workspace rail and
    notifications still open the workspace page.
- **Inbox「建立卡片」opens the create sheet, prefilled**:
  - Title: the PR / Issue title, or `<KEY> <summary>` for Jira.
  - Description: a reference only — `參考 GitHub PR owner/repo#12：<url>`,
    `參考 Jira KEY：<url>` — never the body. The agent reads the source itself.
  - Project: the matched local project for a GitHub item; chosen in the sheet
    otherwise. The inbox detail no longer has its own project picker.
  - A PR still prefills its head branch and base branch; both are editable.
  - The role switch is there, so a master card can be made from an item.
  - The card keeps its `github` / `jira` link — masters too — so the item shows
    「已在看板」. Creating from the inbox stays on the inbox.

## Non-goals

- Editing an In Progress / Done card (core refuses it by design).
- Changing what the workspace page shows for a Backlog card.
