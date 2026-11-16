# Plan：不建分支的卡片，與工作頁卡片顯示專案名稱

- 狀態：已確認（2026-11-16 使用者：「照 plan 實作」）
- 對應 Spec：[spec.md](./spec.md)
- 更新日期：2026-11-16

## 資料形狀

`Task` 新增兩個可選欄位（舊資料沒有 = 舊行為，不需 migration）：

- `noBranch?: true` — 建卡時關掉「建立分支」。`branch` 為 `''`。
- `inPlace?: true` — `noBranch` 且專案不是 git repo：`worktreePath` 就是 `projectPath`，git 一律不碰。

## 步驟

1. **core `tasks.ts`**：`CreateTaskInput.createBranch?: boolean`（預設 true）。關閉時跳過分支名生成與檢查；非 git repo 不再拋 `PROJECT_NOT_GIT_REPO`，改記 `inPlace`。`provisionTaskWorktree`：`inPlace` → `worktreePath = projectPath`；`noBranch` → 新的 `provisionDetachedWorktree`。
2. **core `git.ts`**：`provisionDetachedWorktree(projectPath, workspacePath, taskId, base)`：與 `provisionWorktree` 相同的 fetch／start point 規則，`git worktree add --detach`，不 push；目錄名用 `vf-<id>`。
3. **core `service.ts`**：`gitWorktree()` 對 `inPlace` 回 undefined；`removeTaskWorktree` 對 `inPlace` 什麼都不做、對 `noBranch` 不刪分支；`cleanupTask` 對 `inPlace` 不做 `syncBaseBranch`；`createTask` 傳遞 `createBranch`；`updateTask` 改專案時，`noBranch` 卡允許非 git 並重算 `inPlace`、忽略分支名。
4. **CLI**：`task create --no-branch`。
5. **renderer**：新增對話框加「建立分支」開關（關閉時隱藏分支欄位、非 git 也可建立）；`home.tsx` 傳遞；工作頁清單三行版面；其他顯示 `task.branch` 的地方空字串時顯示「無分支」。
6. **測試**：`test/tasks*.test.mjs` 或新增 `test/no-branch.test.mjs`：detached worktree、非 git 卡 in-place、刪除不動資料夾、`gitWorktree` 為空時 diff 回空陣列。
7. **文件**：AGENTS.md（CLI flag、Provisioning 段落）、`docs/README.md`、`IPC_API_MAP.md`（payload 新欄位）。
8. **驗證**：tsc ×2、`npm test`、`npm run build:web`、`npm run test:e2e`、在 Web UI 實際跑一次（throwaway store）。
