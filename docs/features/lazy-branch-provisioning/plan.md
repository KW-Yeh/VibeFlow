# Plan — 延遲建立分支

分級：Large（改 Task 資料語意、handler table 行為、三個前端）。在 feature branch 實作。

**狀態：已實作**（`feat/lazy-branch-provisioning`）。與原計畫的差異：佈建失敗的原因存在卡片的
`launchError`（卡片退回 Backlog 後沒有終端可以顯示錯誤）；`provisionTaskWorktree` 放在 `tasks.ts`，
建卡（非 backlog）與 `ensureProvisioned` 共用。

## 階段 1 — core：建卡不佈建

- `tasks.ts` `createTaskFromInput`：status 為 `backlog` 時跳過 `provisionWorktree`，
  存 `branch`（明確或產生的名稱）、`branchExplicit`、`baseBranch`（使用者選的；沒選就存 `getGitInfo` 的預設 base，供 UI 顯示）、
  `workspacePath`；不寫 `worktreePath` / `pushed`。非 backlog 照舊立即佈建。
- 附件改寫到 `<workspacePath>/.attachments/<taskId>/`（`attachments.ts` 加一個目的地參數；exclude 步驟對非 git 目錄跳過）。
- `store.ts`：`Task` 加 `branchExplicit?: boolean`；修正 `pushed` / `worktreePath` 註解語意。
- 測試：`test/tasks-create.test.mjs` 新增「backlog 建卡不產生分支/worktree/遠端分支」、「in_progress 建卡仍佈建」、「明確分支名撞名在建卡時就報錯」。

## 階段 2 — core：開始執行時佈建

- 新增 `ensureProvisioned(taskId)`（service.ts 內）：已有 worktree 直接回傳；否則呼叫 `provisionWorktree`
  （`explicitBranch` 來自 `branchExplicit`），寫回 `branch/worktreePath/baseBranch/pushed`，`bus.emit` 新 state。
  同一張卡同時兩次呼叫共用同一個 in-flight promise。
- `pty:start`：帶 `launch` 意圖時先 `ensureProvisioned`；失敗 → 卡片移回 backlog、清 `launchedAt`、emit state、拋出錯誤。
  不帶 launch（純 shell）且未佈建 → 拒絕，不再回退到主 repo 當 cwd。
- 防呆：`resetTaskRun`、`specs`、`attachments:write`、`chat:send` 對未佈建卡片回空值或明確錯誤，不 fallback 到主 repo。
- 測試：`test/service.test.mjs` 用 fake SessionBackend + `makeRepo()`：launch 後才出現分支與遠端分支、cwd 是 worktree、
  佈建失敗卡片退回 backlog、併發 launch 只佈建一次。

## 階段 3 — core：只允許編輯 Backlog，含分支

- `vibeflow:updateTask`：卡片不在 backlog → 拒絕。新增 `branch` 欄位。
  分支 / 專案 / 基準有變：已佈建則檢查 diff（有變更拒絕）→ teardown + `removeTaskWorktree` → 清掉佈建欄位；
  然後驗證新分支名（`check-ref-format` + 本地未佔用），存新值，**不**重新佈建。
- `client.ts` / `UpdateTaskPayload` 加 `branch`；更新 `IPC_API_MAP.md`。
- 測試：`test/tasks-update.test.mjs` / `service.test.mjs`：in_progress 卡被拒、未佈建卡改分支只改 store、
  已佈建且乾淨的卡改分支後回到未佈建、有 diff 的拒絕。

## 階段 4 — 前端

- Web UI `edit-task-dialog.tsx`：加分支欄位（沿用 new-task-dialog 的輸入與驗證樣式）；
  `canEditProject` 改為「column === backlog」。卡片選單與 workspace panel 的編輯入口只在 backlog 顯示。
- 卡片 / panel 對未佈建卡片的分支顯示一個「尚未建立」標記（文案待實作時對照 DESIGN.md）。
- `startTask`（kanban-board.tsx）：launch 失敗時顯示錯誤（卡片會被 core 退回 backlog）。
- TUI `task-form.ts`：edit 模式加分支欄位；非 backlog 卡片不開編輯表單（提示唯讀）。
  `test/tui-task-form.test.mjs` 補案例。
- CLI `task-command.ts`：JSON 輸出對未佈建卡片印 `worktreePath: null`；AGENTS.md 的 CLI 段落更新。

## 階段 5 — 驗收（DoD）

`npx tsc --noEmit -p tsconfig.json`、`npx tsc --noEmit -p renderer/tsconfig.json`、`npm test`、
`npm run build:web`、`npm run test:e2e`（e2e 若假設建卡即有 worktree 需調整），
以及用拋棄式 `--store-path` 起 host 手動走：建卡 → `git branch -a` 無新分支 → 編輯分支名 → 拖入 In Progress →
分支從當下 origin/base 建立並 push → In Progress 卡片無編輯入口。

## 風險

- 開始執行多了 fetch + push 的延遲（數秒），terminal 需顯示「建立 worktree 中」。
- `.attachments/` 位於 worktree 外：agent 用絕對路徑讀，沙盒權限若限制在 worktree 內會讀不到（Claude Code 預設可讀）。
