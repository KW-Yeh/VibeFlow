# Spec：決策 tab 改顯示 spec.md

- 狀態：已實作
- Ticket：尚無
- 需求來源：使用者要求「把 feature-spec-plan 產生的 spec.md 直接替換進目前的『決策』tab 顯示，沒有 spec.md 就不要顯示該 tab」
- 更新日期：2026-10-05
- 確認紀錄：2026-10-05 對話中確認——DECISIONS.md 機制整套移除；只認 branch 上有異動的 spec.md；
  多份全部依序列出；完成的卡從 branch 讀已 commit 的內容。

## 問題與目標

決策 tab 原本顯示 agent 依啟動 prompt 寫在 workspace 資料夾的 `<worktree-dir>.DECISIONS.md`。
feature-spec-plan skill 已經把高層架構決策寫進 `docs/features/<slug>/spec.md`，兩份內容重疊，
DECISIONS.md 還要多花一段 system prompt 與 agent 的 token。

目標：決策 tab 直接顯示這張卡的 spec.md；沒有就不出現這個 tab。

## 行為

- 「這張卡的 spec」= 檔名為 `spec.md`、且在這張卡的 branch 上相對 base 有新增或修改的檔案（含未 commit、untracked）。
  base 上原本就有、這張卡沒碰的 spec 不算；這張卡刪掉的也不算。
- 進行中的卡：從 worktree 讀，每次輪詢更新（agent 寫到一半也看得到）。
- 已完成的卡：worktree 已清除，從保留的 branch 用 `git show` 讀已 commit 的版本；
  檔案清單優先用完成時擷取的 `outcome.files`，因為 branch 被 merge 回 base 後 merge-base diff 會是空的。
  沒 commit 的 spec 在完成後就讀不到，tab 也就不出現。
- 多份 spec 依路徑排序全部列出，每份上方標路徑。
- Backlog 的卡沒有決策 tab（與原本相同）。
- tab 標籤維持「決策」。

## 範圍

### 本次包含

- 新 handler `task:getSpecs`（取代 `task:getDecisions`），`client.ts` / `renderer/lib/api.ts` / `IPC_API_MAP.md` 同步。
- 移除 `buildDecisionPrompt`、`taskDecisionsPath` 與啟動時的決策書 prompt。
- `task-workspace-panel.tsx`：spec 輪詢移到 panel 層，tab 有無取決於是否有 spec。
- 退回 Backlog 的確認文案移除「決策紀錄」。

### 本次不包含

- 顯示 plan.md。
- 讓使用者在 UI 編輯 spec。

## 遷移

舊卡留下的 `<key>.DECISIONS.md` 不再讀取；刪卡、退回 Backlog 時仍會一併刪除，避免在使用者的 workspace 留下孤兒檔。
