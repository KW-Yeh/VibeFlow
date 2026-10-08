# IPC channel → `VibeFlowApi` map

Phase 0 inventory for the core split (see the migration plan,
[docs/plans/CORE_SPLIT_PLAN.md](../../docs/plans/CORE_SPLIT_PLAN.md)): every channel
the Electron main process handled, and every event it pushed.

**Status (Phase 2 done):** the channel names are kept as the wire protocol.
The table now lives in `createCore()` (`service.ts`), and every transport
exposes exactly that table: `web-server.ts` serves it over the WebSocket, and
`local-transport.ts` calls it in-process for the TUI. `client.ts` builds the typed
`VibeFlowApi` (`window.vibeflow`) over any transport. Every **Path in** row
below has been reshaped: those handlers take the task id and resolve paths
and commands inside core. The only exceptions are project picking and library
import, where no task exists yet. The two **drop** rows are gone.

**Status (Electron removed):** the desktop shell is gone, and so are the
**electron** rows (`app:relaunch`, `remote-update:*`, `update:available`) and
both `dialog:*` channels: the Web UI asks for a typed path instead of a native
picker.

Channels added since the inventory:

| Channel | Purpose |
|---|---|
| `sessions:list` | Session backend (`pty` / `tmux`) and the running session keys |
| `pty:peek` | Join a running session without restarting it (TUI terminal view) |
| `pty:scrolled` / `pty:scroll-bottom` | Whether a session's own history view (tmux copy-mode) is off the live output, and return it there |
| `projects:record` | `vibeflow open <path>` while a host runs, since only the host writes the store |
| `jira:authStatus` / `jira:inbox` | Atlassian CLI login state and assigned Jira tickets; inbox supports `{ force }` |
| `settings:startJiraAuthLogin` / `settings:inputJiraAuthLogin` / `settings:cancelJiraAuthLogin` / `settings:logoutJiraAuth` | Interactive browser authentication through acli; `jira-auth:event` broadcasts PTY output and progress |
| `host:info` / `host:shutdown` | `vibeflow` host only (`packages/cli/src/host.ts`) |
| `host:updateStatus` / event `update:available` | Host's latest npm release check, broadcast when a newer version appears or clears |
| `progress:get` | A running card's progress (todos, token usage, activity) read from its agent transcript; `null` until there is one (`progress-tracker.ts`) |
| event `progress:update` | `{ taskId, progress }` on every change to a tracked card's progress |
| event `progress:notify` | `{ taskId, title, notifications }` stage notifications, already filtered by `settings.notifications` |

List the current table with:

```sh
grep -oE "^    '[a-z-]+:[A-Za-z]+'" packages/core/src/service.ts
```

63 handlers, 10 pushed events. **Where** says which side of the boundary
the channel lands on:

- **core**: becomes a `VibeFlowApi` method, the same for every frontend.
- **platform**: goes through `PlatformServices` (`packages/core/src/platform.ts`).
  Each host implements it in its own way.
- **electron**: meaningful only in the former desktop shell. Removed with it.
- **drop**: no caller in the renderer.

**Path in** marks a handler that takes a filesystem path or a command from the
renderer. The plan requires the API to take task ids, not paths. These are the
channels Phase 2 has to reshape. The web transport cannot expose them as they
are.

## Board and tasks

| Channel | Where | `VibeFlowApi` | Path in | Notes |
|---|---|---|---|---|
| `vibeflow:getState` | core | `getState()` | | Board + settings in one read; the plan's `listTasks()` + `getSettings()` |
| `vibeflow:setBoard` | core | `setBoard(board)` | | The renderer replaces the whole board to reorder and move. `moveTask(id, to)` alone cannot express a position in the column. Keep it or add `moveTask(id, to, index)` |
| `vibeflow:createTask` | core | `createTask(input)` | projectPath | The user picks the project path. Valid input, but validate it with a schema |
| `vibeflow:updateTask` | core | `updateTask(id, patch)` | | Backlog cards only. `projectPath` / `baseBranch` / `branch` are stored, not provisioned; a clean worktree is given up |
| `vibeflow:removeTask` | core | `removeTask(id)` | | |
| `vibeflow:resetTaskRun` | core | `resetTaskRun(id)` | | "Return to Backlog" wipes the run |
| `vibeflow:cleanupTask` | core | `cleanup(id)` | | Moved to Done: worktree, branch and artifacts removed |
| `vibeflow:deleteTask` | core | `deleteTask(id)` | | Also deletes a legacy decision record |
| `vibeflow:setSettings` | core | `updateSettings(patch)` | | |
| `projects:listRecent` | core | `listRecentProjects()` | | |
| `board:getCliLaunchInfo` | core | `getCliLaunchInfo()` | | Now reads `PlatformServices.sourceRoot()` |
| `attachments:write` | core | `writeAttachments(id, files)` | | Into the worktree, or the staging dir while the card has none |

## Sessions (PTY)

| Channel | Where | `VibeFlowApi` | Path in | Notes |
|---|---|---|---|---|
| `pty:start` | core | `term.start({ taskId, launch })` | ~~cwd, command~~ | **Done.** The renderer sends a launch intent (`{ resume, includeTaskPrompt }`, or none for a shell). Core resolves the cwd and builds the command (`launch.ts`, formerly `renderer/lib/claude.ts`). A launch on a card with no worktree provisions it first (`ensureProvisioned`); a shell on one is refused |
| `pty:input` | core | `writeInput(id, data)` | | Keyed by `sessionKey`, not task id (a task has several terminal tabs) |
| `pty:resize` | core | `resize(id, cols, rows)` | | Same `sessionKey` note |
| `pty:kill` | core | `stopSession(id)` | | |
| `claude:sessionExists` | core | `term.sessionExists(taskId)` | ~~cwd~~ | **Done.** Takes the task id |

## Git and review

| Channel | Where | `VibeFlowApi` | Path in | Notes |
|---|---|---|---|---|
| `git:getInfo` | core | `inspectProject(path)` | projectPath | Runs before a task exists, so a path is the only possible input |
| `git:initRepository` | core | `initRepository(path)` | projectPath | Same |
| `git:getDiff` | core | `getDiff(id)` | | |
| `git:getDiffEntries` | core | `getDiffEntries(id, opts)` | | |
| `git:getDiffFile` | core | `getDiffFile(id, file)` | | `file` is relative to the worktree. Keep the containment check |
| `git:approve` | core | `approve(id, message)` | | |
| `git:generateCommitMessage` | core | `generateCommitMessage(id)` | | |
| `git:getPrStatus` | core | `getPrStatus(id)` | | |
| `git:getGithubCompareUrl` | core | `getCompareUrl(id)` | | |
| `git:refreshBase` | drop | | | Handler with no preload or renderer caller |

## Artifacts, specs, sub-agents

| Channel | Where | `VibeFlowApi` | Path in | Notes |
|---|---|---|---|---|
| `task:listArtifacts` | core | `listArtifacts(id)` | | |
| `task:readArtifact` | core | `readArtifact(id, name)` | | |
| `task:openArtifactsDir` | platform | `openArtifactsDir(id)` → `openPath` | | Core resolves the directory, and the host opens it. That works for the Web UI too, because core runs on the user's machine |
| `task:getSpecs` | core | `getSpecs(id)` | | `spec.md` files the branch added or changed; read from the branch once the worktree is gone |
| event `subagents:update` | core | `on('subagents:changed')` | | |

## Chat

| Channel | Where | `VibeFlowApi` | Path in | Notes |
|---|---|---|---|---|
| `chat:load` | core | `chat.load(id)` | | |
| `chat:send` | core | `chat.send(id, text, …)` | ~~worktreePath~~ | **Done.** Worktree, workspace and agent come from the task |
| `chat:cancel` | core | `chat.cancel(id)` | | |
| `chat:compact` | core | `chat.compact(id)` | | |
| event `chat:chunk` / `chat:phase` | core | `on('chat:chunk')` / `on('chat:phase')` | | Pushed through `EventSink` |

## Library

| Channel | Where | `VibeFlowApi` | Path in | Notes |
|---|---|---|---|---|
| `library:list` | core | `library.list()` | | |
| `library:import` | core | `library.import(kind, source)` | sourcePath | The user picked it. Web UI needs a path input or an upload |
| `library:create` / `read` / `update` / `setDescription` / `setEnabled` / `delete` | core | `library.*` | | |
| `library:restoreBuiltin` | core | `library.restoreBuiltin(name)` | | Name only; must be a skill this install ships |
| `library:removedBuiltins` | core | `library.removedBuiltins()` | | Shipped skills the user deleted |
| `library:getLaunchInfo` | — | — | ~~worktreePath~~ | **Removed.** Only launch assembly needed it, and that runs in core now |

## Agents and accounts

| Channel | Where | `VibeFlowApi` | Path in | Notes |
|---|---|---|---|---|
| `env:detectAgents` | core | `detectAgents()` | | |
| `agents:listModels` | core | `listAgentModels(agent, refresh?)` | | From the agent CLI's own catalog (no API key), cached in host memory since host start; never starts a CLI unless `refresh` (Claude `initialize` handshake / `codex app-server` `model/list`). Each model carries its effort levels; `pending` / `loginRequired` flag a fallback list |
| `settings:connectAgent` / `settings:refreshAgentModels` | — | — | | **Removed.** Model lists no longer need a provider API key |
| `settings:githubAuthStatus` | core | `github.status()` | | |
| `settings:startGithubAuthLogin` | core | `github.startLogin()` | | Streams `github-auth:event` to the requesting frontend |
| `settings:cancelGithubAuthLogin` | core | `github.cancelLogin()` | | |
| `settings:logoutGithubAuth` | core | `github.logout()` | | |
| event `github-auth:event` | core | `on('github:auth')` | | |
| `github:inbox` | core | `getGithubInbox({ force? })` | | Account-wide search discovers GitHub repos with open Issues/PRs involving the `gh` user, even without board cards; results cached 5 min, with board `origin`s used only to map a local project path |
| `github:taskLinks` | core | `getGithubTaskLinks({ force? })` | | Task id → linked Issue/PR (card's `github` source, PR by branch, `outcome.pr`, closing issues) |

## Host-specific

| Channel | Where | Replacement | Notes |
|---|---|---|---|
| `dialog:pickFolder` | removed | | The Web UI uses the path input plus the recent-projects list |
| `dialog:pickLibrarySource` | removed | | The Web UI asks for a typed path |
| `dialog:pickFolder` | platform | `PlatformServices.pickFolder` (`folder-dialog.ts`) | Native folder dialog on the host (osascript / PowerShell / zenity, kdialog). Returns `{ path }`, `{ canceled }` or `{ unsupported }`; the renderer falls back to a typed path on unsupported or error |
| `shell:openExternal` | platform | `PlatformServices.openExternal` | The browser frontend can simply `window.open` |
| `app:getVersion` | core | `getVersion()` | Read from `package.json` instead of `app.getVersion()` |
| `app:relaunch` | electron (removed) | | Hot update of the `.app` |
| `remote-update:getState` / `check` / `download` / `install` | electron (removed) | | electron-updater. npm installs update through npm |
| event `remote-update:state` / `update:available` | electron (removed) | | |
| event `state:changed` | core | `on('task:changed')` … | Today this pushes the full state after a CLI write. Also emit it after every core mutation, so a second frontend stays in sync |
| `message` | drop | | nextron scaffold echo |

## Pushed events via `EventSink`

`pty.ts` and `chat-session.ts` now take an `EventSink`
(`packages/core/src/events.ts`) instead of Electron's `WebContents`; the
WebSocket connections behind `EventBus` implement it.
