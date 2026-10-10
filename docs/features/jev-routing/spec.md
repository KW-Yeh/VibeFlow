# Jev routing

## Intent

When a card selects only Claude Code or Codex, VibeFlow asks TypeSafe Jev whether the task is complex or unclear enough to warrant a planning pass. If so, the strongest available model in that agent's catalog creates a read-only plan. Jev then selects an execution model from the same agent's available low, middle, and high cost tiers. A card with an explicit model id runs that exact model without Jev or the planning pass.

## Behavior

- The host reads a Jev API key saved through Settings, falling back to `TYPESAFE_API_KEY` in its environment, and sends the card title and description to TypeSafe's `/v1/systemone` endpoint. If planning is selected, the planner CLI also reads the task worktree. The browser never receives the saved key after submission.
- Settings saves the key in a separate host-only `jev-api-key` file under the selected store directory, mode 0600 on POSIX, rather than in `vibeflow-state.json`. It exposes only configured/source status. Saving or removing the key takes effect without restarting the host.
- The first Jev request judges complexity and whether planning helps. The second sees the plan, if any, and picks an exact id from the signed-in CLI's model catalog.
- Only model ids present in the catalog and safe to pass to the CLI can be selected. Catalog order is used to pick the first model in each relative cost tier. These tiers are approximate, not provider prices.
- The chosen model and optional plan are recorded on the card. The plan is added to the first execution prompt as guidance, not as a replacement for the user's request. A resume reuses the model without making another Jev call.
- If the key is absent or a Jev/planning call fails, the card shows the reason and starts with the CLI's own default model. An explicit model bypasses the fallback mechanism too.

## Limits

Routing happens when the card starts, not on every message in an existing agent session. Provider model names and relative costs can change; the catalog is authoritative for availability, while tier detection is a heuristic. The planner receives at most 12,000 characters of card text and its output is capped at 8,000 characters.
