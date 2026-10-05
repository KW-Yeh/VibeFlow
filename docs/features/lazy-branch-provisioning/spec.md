# Spec — 延遲建立分支（開始執行時才佈建）

## 問題

建卡時立刻 `fetch origin <base>` → `worktree add -b <branch> origin/<base>` → `push -u origin`。
卡片在 Backlog 擺越久，分支起點就越舊；開始執行時 agent 面對的是過時的 base。
另外 Backlog 裡的卡片已經在 origin 留下分支，即使最後不做也一樣。

## 決策

1. **建卡不碰 git 的寫入面**：不建本地分支、不建 worktree、不 push。
   仍然做「讀」的檢查（路徑存在、是 git repo、分支名合法且本地未佔用），讓錯誤早點出現。
2. **分支名稱在建卡時決定並存在卡片上**（沒填就照舊用 `generateBranchName` 產生）。
   卡片一建立就看得到分支名。
3. **佈建點 = 開始執行**：卡片第一次啟動 agent（移入 In Progress 自動啟動，Web UI 與 TUI 皆同）時，
   core 在 `pty:start` 解析 cwd 之前佈建：fetch base → 建分支 + worktree（起點是**當下的** `origin/<base>`）→ push。
   佈建失敗：卡片退回 Backlog、清掉 `launchedAt`，原因存在卡片的 `launchError`（Backlog 卡片與詳情顯示，下次成功開始或編輯時清除）。
   佈建期間終端機顯示等待說明（從哪個 base 建哪條分支、會 push、需要幾秒），TUI 在狀態列顯示同樣訊息。
4. **只有 Backlog 卡片可編輯**，且 Backlog 的編輯包含分支名、專案資料夾、基準分支。
   In Progress 與 Done 卡片在 Web UI / TUI 完全唯讀；core 的 `vibeflow:updateTask` 也拒絕。
   CLI `task update`（給 agent 用）不受影響，仍可改標題 / 描述 / 欄位。
5. **已有 worktree 的 Backlog 卡片**（升級前建的、或從執行中退回的）：
   編輯分支 / 專案 / 基準時，worktree 沒有變更就移除 worktree 與本地分支、回到未佈建狀態；
   有變更就拒絕（沿用現行規則）。已推到 origin 的遠端分支不刪。只改文字欄位則不動 worktree。
6. **附件**在未佈建時寫到 `<workstation>/<project>/.attachments/<taskId>/`，描述中的絕對路徑從此固定，
   佈建時不搬、不改寫。刪卡時一併清除。
7. **CLI `task create --status in_progress|done`** 仍在建立時佈建（該欄位不會自動啟動，
   不佈建會留下一張無法執行的卡）。`backlog`（預設）走延遲佈建。

## 非目標

- 開始執行時對**已佈建**卡片做 rebase / 同步 base（另一個議題）。
- 刪除 origin 上的遠端分支。

## 相容性

不需要資料遷移：「未佈建」= 卡片沒有 `worktreePath`。舊卡全都有 worktree，行為不變。
新增選填欄位 `branchExplicit`（使用者是否親自指定分支名，決定佈建時撞名要失敗還是自動加後綴）與 `launchError`。
