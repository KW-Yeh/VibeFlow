# Jev effort routing

## Intent

Each card chooses its agent and optional model independently of Jev. A card without a model id uses the agent CLI's own default. New cards default to effort `auto`; at launch Jev selects a reasoning effort suitable for the task and the model currently selected for that card. Manual effort choices bypass Jev.

## Behavior

- The host reads a Jev API key saved through Settings, falling back to `TYPESAFE_API_KEY`. It sends the card prompt, agent, current model, and that model's supported effort levels to TypeSafe's `/v1/systemone` endpoint. The browser never receives the saved key after submission.
- Settings saves the key in a separate host-only `jev-api-key` file under the selected store directory, mode 0600 on POSIX, rather than in `vibeflow-state.json`.
- When the model catalog names the current or default model, Jev may choose only levels that model declares. When the catalog lacks effort data, the conservative `low` through `xhigh` levels are offered. Models that declare no effort support skip the request.
- The chosen effort is recorded on the card as `jevRoute.effort`; `Task.effort` remains `auto`. A resume reuses the decision. A new run asks again.
- While the request runs, the card shows `jevRoute.status: 'routing'` and starts the agent after the decision settles. A transient routing record left by a host crash is ignored.
- A missing key, failed request, or unsupported answer records a fallback reason and launches without an effort flag, letting the model use its own default.
- Explicit effort choices retain the existing per-model clamping behavior and do not call Jev.

## Limits

Jev runs when a task begins, not on every message in an existing agent session. It sees at most 12,000 characters of card prompt. A CLI default model may differ from a cached catalog entry if the user's CLI configuration changes; in that case the CLI remains authoritative and may reject an incompatible effort.
