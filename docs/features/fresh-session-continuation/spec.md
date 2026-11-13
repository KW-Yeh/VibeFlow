# Spec：卡片換新 session 接續

- 狀態：已確認
- Ticket：尚無
- 需求來源：使用者需求（2026-11-13）：讓 In Progress 的卡片可以換一個新的 agent session 繼續，新 session 只帶必要的接續資訊，不帶整段歷史。依據：過去對話紀錄中，卡片每次 API 呼叫的 context 中位數 182k token，約 363k 才自動壓縮；存活超過 24 小時的卡占全部卡片成本 46%，其中 71% 是 cache read。
- 更新日期：2026-11-13
- 確認紀錄：2026-11-13 使用者在看過 spec 與五個待確認事項後回覆「繼續」，沒有逐項回答；視為接受建議預設並定案（見末段「待確認事項」），使用者隨時可推翻。2026-11-13 隨後修正一處實作細節（不改行為）：不新增 `LaunchIntent` 欄位，簡報只由 core 組出。

## 問題與目標

`launch.ts` 的 `executorSessionId(task.id, task.runId)` 把 Claude session 釘在卡片上，之後一律 `--resume`。`runId` 只有 `vibeflow:resetTaskRun`（退回 Backlog，會丟棄 worktree 變更）才會換，所以實作、PR review、驗收、PR 監聽都疊在同一個 session，context 越滾越大。

目標：In Progress 的卡片可以結束目前的 agent session，改開一個新 session 繼續同一張卡（同 worktree、同分支、不丟任何程式碼），新 session 的第一則訊息只有卡片內容、分支與 PR 狀態、前一個 session 的精簡摘要。

## 範圍

### 本次包含

- Core：新 handler `vibeflow:continueTask`；由 core 組出「接續簡報」。
- Web UI：卡片終端機工具列新增按住確認的「新 Session 接續」按鈕。
- CLI：`task start --task <id> --new-session [--force]`（只對 In Progress 的卡片有效）。
- 用量跨 session 累計、master／slave、inbox、Codex 的行為（見下）。

### 本次不包含

- 自動換 session（含 pr-watch 階段預設換 session）。
- 讓使用者輸入「接續指示」的欄位（要補充時用既有的 `task send`）。
- 舊 transcript 的檢視器；TUI 鍵位；重新路由 Jev；context 過大時的 UI 提示。

## 行為

| 情境或觸發條件 | 預期行為 |
| --- | --- |
| 在 In Progress、已執行過（`launchedAt`）的卡片按住「新 Session 接續」，或執行 `task start --new-session` | 舊 session 被新 session 取代（不是先 kill 再開，避免 master 收到「session 結束」通知）；worktree、分支、commit、未 commit 變更、artifacts 全部保留；新 session 以簡報作為第一則訊息 |
| 卡片不在 In Progress、沒有 worktree、從未執行過 | 拒絕，回明確錯誤碼，不動任何狀態 |
| agent 正在執行或卡在權限確認 | CLI／handler 回 `AGENT_BUSY`，加 `--force` 才中斷；UI 的按住確認就是 force |
| 沒有存活的 session（已結束、host 重啟） | 直接開新 session，不需 force |
| 同一張卡同時兩次接續 | 第二次被拒（`ALREADY_CONTINUING`），不會開出兩個 session |
| 舊 session 的子 agent 時間軸 | 清空，新 session 從空的時間軸開始 |
| 不重新路由 | 沿用 `jevRoute` 的模型與 effort；沒有路由結果就用 CLI 預設；不再跑 scout，不重複 scout 分析 |
| system prompt、Library、board CLI、auto mode | 與任何一次啟動相同，重新組裝；slave 卡仍只帶 `slaveSystemPrompt()` 並向 master 回報 |
| 啟動後 | `runId` 換新、`launchedAt` 設為現在，進度與 context 讀數改看新 session |

### 接續簡報（由 core 整理，不要求舊 agent 寫交接檔）

以繁體中文、固定段落，總長上限 8,000 字；任何一段取不到就省略，不讓整個簡報失敗：

1. 任務標題與描述（同首次啟動）。
2. 分支與程式碼：分支、base、`base..HEAD` 的 commit（最多 20 筆）、未 commit 變更的檔案清單、是否已 push。
3. PR：以分支找到的 PR 編號、狀態、連結；`gh` 不可用或逾時就寫「PR 狀態未知」。
4. 前一個 session 的 todo 清單（來自 progress 資料）。
5. 前一個 session 最後一則 assistant 文字回覆（上限 2,000 字，僅 Claude；Codex 的 rollout 格式未釘住，不新增解析）。
6. 接續指示（固定文字）：先確認 git status 與 PR 狀態，有未完成的 todo 就繼續，沒有就簡短回報目前狀態並等待指示。

Master 卡：沒有 git／PR，第 2、3 段換成「底下的卡片」表（id、標題、欄位、是否執行中、todo、PR），資料來自 `task:summaries` 既有邏輯。

### 回答 spec 要求的問題

- **觸發方式**：UI 手動＋CLI 兩者都有，共用同一個 handler。**不**自動、**不**讓 pr-watch 預設換 session：pr-watch 的監聽腳本是舊 session 的子行程，換 session 會一併結束，需要新 session 重新啟動；而「PR 階段開始」只存在於 agent 的行為中，core 無法可靠判斷。先手動／CLI 觸發並量測，數據支持再另開需求。
- **摘要來源**：core 從 transcript、progress、git、`gh` 整理為主，不要求舊 agent 寫交接檔。理由：沿用 task-progress 的原則「進度來自 transcript，不靠模型自己寫」；不需要在 180k+ context 上多花一輪呼叫；agent 當掉或卡住時仍可用；Codex 同樣適用。代價：看不到對話中的口頭決策，只靠最後一則回覆近似；舊 session 仍留在磁碟，必要時可手動 `claude --resume`。
- **用量累計**：換 session 前先把目前總用量折進 `Task.usage`（與 `resetTaskRun`、`cleanupTask` 同一函式 `usageThroughCurrentRun`），再更新 `launchedAt`，舊 transcript 因早於 `since` 不再被重複計入。UI 顯示的總量 = 折入值 + 新 session。
- **舊 transcript**：檔案原封不動留在 `~/.claude/projects/…`；UI 目前就沒有任何 transcript 檢視器，本次不新增，也不保存舊 session id 清單。
- **jevRoute**：不重新路由（見上表）。
- **inbox**：`.vibeflow-inbox` 在 worktree 內，尚未被讀的訊息保留，由新 session 的 hook 送達；啟動時照舊清掉 `.ready` 標記。
- **Codex**：沒有釘住的 session id，「新 session」= 新的 `codex` 行程，簡報併入 system prompt 後作為 prompt 參數（與現行 Codex 啟動方式相同）；用量由同一個折入規則處理。
- **Store 資料形狀**：不新增任何欄位，只重用 `runId`、`launchedAt`、`usage`，**不需要 migration**；沒有 `runId` 的舊卡片第一次接續時會得到新的 `runId`。計劃需驗證舊 store 載入後可接續。

## 驗收條件

- [x] AC-1：In Progress 且已執行的卡片執行接續後，`runId` 換新、`launchedAt` 更新、worktree 與分支內容不變；`Task.usage` ≥ 接續前的總用量，且完成卡片後總量不重複計算舊 session。
- [x] AC-2：新 session 的啟動指令第一則訊息包含簡報各段；取不到的段落被省略；簡報 ≤ 8,000 字；master 卡的簡報不含 git／PR，含底下卡片表。
- [x] AC-3：Backlog／Done／未佈建／從未執行的卡片被拒絕且狀態不變；`AGENT_BUSY` 與 `--force` 行為正確；沒有存活 session 時可直接接續。
- [x] AC-4：接續過程不對 master 發出「session 結束」通知；slave 卡的新 session 仍只帶 `slaveSystemPrompt()`；inbox 中未讀訊息保留。
- [x] AC-5：`task start --new-session` 與 UI 按鈕走同一個 handler；Web UI 按鈕只出現在已執行的 In Progress 卡片，按住確認後終端機顯示新 session。
- [x] AC-6：以丟棄式 `--store-path` 起 host，真實 Claude 卡跑完一輪（舊 session 最後一次呼叫 context ≥ 80k）後接續，新 session 第一次呼叫的 context ≤ 舊 session 最後一次的 50%；量測方式：取 transcript 中 assistant 訊息 `usage` 的 `input + cache_read + cache_creation`（與 `progress.ts` 的 `contextTokens` 同定義），附兩個數字與取值位置。
- [x] AC-7：`docs/` 索引、`IPC_API_MAP.md`、AGENTS.md 的 CLI 說明已更新；AGENTS.md 的 Definition of Done 全部通過，含 `npm run test:e2e`。

## 限制與依賴

- 新 handler 依序更新 `service.ts`、`client.ts`、`renderer/lib/api.ts`、`packages/core/IPC_API_MAP.md`；`vibeflow:continueTask` 只接受 task id 與 `force`，不接受任何文字、命令或路徑，簡報完全由 core 組出。
- Claude transcript 不是公開介面：最後回覆的解析只讀少數欄位，並用 `test/fixtures/progress/` 釘住。
- `SINCE_SLACK_MS`（5 秒）：在 session 啟動後 5 秒內接續，舊 session 可能被重複計入，屬已知極小風險。
- 簡報是新的 core 邏輯，必須在 `test/` 有單元測試；UI 變更要做像素級比對與錄影。

## 待確認事項

無。下列五點依建議預設定案（使用者以「繼續」接受，可隨時推翻）：

1. 觸發只做手動＋CLI，不自動，pr-watch 不預設換 session。
2. 摘要由 core 整理，不要求舊 agent 寫交接檔。
3. Master 卡納入第一版，簡報改列底下卡片表。
4. 不保存舊 session id 清單（不新增欄位）。
5. CLI 採 `task start --new-session`，不另開 `task continue`。
