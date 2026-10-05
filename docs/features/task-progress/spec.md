# Spec：任務進度、使用量與階段通知

- 狀態：已確認
- Ticket：尚無
- 需求來源：2026-10-05 對話。使用者希望用程式解析結構化資料取得任務進度，不依賴模型自行更新進度檔；使用量也要一起計算；再加上 hooks 即時推送與階段性通知，並提供通知開關。
- 更新日期：2026-10-05
- 確認紀錄：
  - 2026-10-05 方向確認：保留 CLI／終端機綁定，另加 transcript 旁路資料通道；不改成直接呼叫 API。
  - 2026-10-05 第 1 部分（transcript 解析、進度、使用量）確認；Q1–Q4 照建議：只顯示 token 不顯示金額、Codex 一起做、使用量累加所有 run、不顯示 Codex rate-limit。
  - 2026-10-05 使用者要求加入 hooks 即時推送與階段通知（含開關）；第 2 部分的通知類型、預設開關、管道與不打擾規則經使用者確認，整份 Spec 確認。
  - 2026-10-05 實作時變更，使用者已確認：Codex **不注入** `notify`。實測 `-c notify=…` 會整個取代使用者 `config.toml` 裡原有的 `notify`（本機設定的是 codex-computer-use 的 `turn-ended`），`hooks.Stop` 同理。Codex 卡改為只靠檔案輪詢（約 2 秒），可觀察行為不變，只是比 Claude 慢。

## 問題與目標

現在卡片的進度只能靠模型自己寫進度檔，或使用者進終端機看。模型會忘記更新，寫法也不固定，VibeFlow 沒辦法拿這些內容做運算。使用量（token）也完全看不到。使用者同時開多張卡時，也不知道哪張做完了一個階段、哪張停下來在等他。

但 agent CLI 本身已經把每次執行寫成結構化 JSONL：

- Claude Code：`~/.claude/projects/<cwd→dashes>/<sessionId>.jsonl`。VibeFlow 已經用 `executorSessionId` 固定每張卡的 session id，所以路徑可以直接算出來。
- Codex：`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`。開頭的 `session_meta` 帶 `cwd`，可用卡片的 worktree 路徑比對。

Claude Code 也提供 hooks（VibeFlow 已用 `PreToolUse`／`PostToolUse` 記錄 sub-agent，見 `subagents.ts`），可在事件發生的當下通知 VibeFlow。

目標：core 讀取這些檔案和 hook 事件，由程式算出每張卡的「進度」和「使用量」，推送到 Web UI 和 TUI；在關鍵階段發出通知。agent 不需要做任何額外的事。

## 範圍

### 本次包含

**第 1 部分：transcript 解析**

- core 解析執行中卡片的 transcript，產生 `TaskProgress`。
- **進度**：取自 agent 最新一次的 todo 清單。Claude 用 `TodoWrite` 工具的 input，Codex 用 `update_plan` 工具的 input。
- **使用量**：input／output／cache read／cache write／reasoning token 合計，以及最近一次回合佔用的 context 大小。只顯示 token，不換算金額。
- **活動狀態**：最後活動時間、正在執行的工具、是否回合已結束（在等使用者）。
- 透過 event bus 推送更新，並提供 handler 讓前端初次載入時能讀取目前值。
- Web UI：卡片上顯示精簡進度與 token 數，工作區面板顯示完整 todo 清單與使用量明細。
- TUI：卡片列顯示同樣的精簡資訊。
- 卡片的使用量累加所有 run；完成時寫進 store，讓 Done 卡還看得到。

**第 2 部分：hooks 即時推送與階段通知**

- Claude 的每次啟動都注入額外的被動 hooks。事件發生時立即觸發 core 重新解析該卡，不必等檔案監看輪詢。
- Codex 不注入任何 hook（`-c notify=…` 會取代使用者自己的 `notify`），進度、使用量與「等待輸入」都靠檔案輪詢 rollout。
- hooks 沒觸發時（舊 session、hook 失敗、CLI 版本不支援），仍由檔案監看補上，結果一致，只是較慢。
- **階段通知**，由 core 從進度變化判斷後送出：

  | 通知類型 | 觸發條件 | 預設 |
  | --- | --- | --- |
  | 步驟完成 | todo 中某一項從非 `completed` 變成 `completed` | 關 |
  | 全部步驟完成 | 清單所有項目都 `completed`（至少 1 項） | 開 |
  | 等待輸入 | Claude 回合結束（`Stop`）或要求權限（`Notification` hook）；Codex 回合結束 | 開 |

- **通知管道**：Web UI 顯示頁內 toast；另可開啟瀏覽器桌面通知（需使用者授權）。TUI 在狀態列顯示一行訊息。
- **設定**：設定頁新增「通知」區塊：總開關、三種類型各自的開關、桌面通知開關。屬於全域設定，存在 `AppSettings`，所有前端共用。

### 本次不包含

- 改成直接呼叫 Anthropic／OpenAI API，或任何登入取得 API token 的流程。
- Headless `stream-json` 執行模式。
- 用 diff 大小、commit 數、測試結果推估進度（diff 已有獨立分頁）。
- 跨卡片或跨專案的使用量報表、預算上限、使用量告警。
- 美元成本估算、Codex 帳號 rate-limit 顯示。
- 每張卡各自的通知設定、手機推播、聲音、email／Slack 等外部通知。
- 修改 agent 的 system prompt 或要求它輸出特定格式。

## 行為

### 進度與使用量

| 情境或觸發條件 | 預期行為 |
| --- | --- |
| 卡片 agent 執行中，呼叫了 TodoWrite／update_plan | 卡片顯示「n/m」和進度條（Claude 有 hook 時約 1 秒內，否則數秒內）；工作區面板列出每一項及其狀態，`in_progress` 那項標示為目前步驟。 |
| agent 更新 todo 清單 | 以最新一次的完整清單取代舊清單（不合併）。 |
| agent 從未建立 todo 清單 | 不顯示進度條和比例（不捏造百分比），只顯示活動狀態與使用量。 |
| 每個 assistant 回合結束 | 使用量累加。Claude 同一 `message.id` 拆成多行時只計一次；Codex 取最後一筆 `token_count.total_token_usage`。 |
| agent 正在執行某工具 | 顯示「執行中：<工具名>」與最後活動的相對時間。 |
| 最後一筆是回合結束（Claude `stop_reason: end_turn`；Codex `task_complete`） | 顯示「等待輸入」。 |
| 卡片 Restart（新 `runId` → 新 session） | 進度改看新 session；卡片總使用量包含前幾次 run。 |
| 找不到 transcript（尚未啟動、檔案還沒寫出、Codex 找不到對應 session） | 不顯示進度區塊，不報錯。 |
| transcript 有無法解析的行，或 CLI 改了格式 | 略過該行，繼續處理其餘行；不讓 host 崩潰。 |
| 卡片移到 Done | 最終使用量存進 `Task`；停止監看；Done 卡仍顯示總 token 數。 |
| App 重啟 | 從 transcript 重新解析，結果與重啟前一致。 |

### Hooks 與通知

| 情境或觸發條件 | 預期行為 |
| --- | --- |
| hook 執行失敗或 core 沒在跑 | agent 不受影響（hook 一律 exit 0、不輸出 decision）；core 起來後由檔案監看補上進度。 |
| 某項 todo 完成，且「步驟完成」開啟 | 通知：「<卡片標題>：完成 3/7 — <該項內容>」。 |
| 所有 todo 完成，且「全部步驟完成」開啟 | 通知：「<卡片標題>：所有步驟已完成」。同一份清單只通知一次。 |
| agent 停下等待輸入，且「等待輸入」開啟 | 通知：「<卡片標題>：等待你的輸入」。同一次停頓只通知一次，agent 再次開始工作後才會重新觸發。 |
| 總開關關閉 | 不送任何通知；進度與使用量照常更新。 |
| 使用者正在看該卡片的工作區，且頁面在前景 | 不跳 toast、不送桌面通知。 |
| 開啟桌面通知 | 瀏覽器詢問授權；被拒絕時設定頁顯示「瀏覽器已封鎖通知」，開關回到關閉。 |
| 點擊通知 | 開啟 Web UI 並選取該卡片。 |
| App 重啟、從 transcript 重新解析 | 不為重啟前已發生的變化補發通知。 |
| 同時開著多個前端（多個分頁、Web + TUI） | 每個前端各自顯示；設定共用。 |

## 驗收條件

### 第 1 部分

- [x] AC-1：給一份含多次 TodoWrite 的 Claude transcript fixture，解析結果等於最後一次的清單，完成數正確。
- [x] AC-2：同一 `message.id` 重複出現多行時，Claude 使用量只計一次；總和等於 fixture 手算值。
- [x] AC-3：給一份 Codex rollout fixture，`update_plan` 解析出清單，使用量等於最後一筆 `total_token_usage`。
- [x] AC-4：Codex 的 session 以 `session_meta.cwd` 對到卡片 worktree；cwd 不符的 rollout 不會被採用。
- [x] AC-5：沒有 todo 的 transcript，`progress` 為空，UI 不顯示比例。
- [x] AC-6：壞掉或被截斷的行被略過，其餘結果正確（針對截斷的最後一行做單元測試）。
- [x] AC-7：沒有 hook 時，transcript 增加內容後，前端在數秒內收到新的進度事件。
- [x] AC-8：卡片完成後，store 內 `Task` 帶有累加所有 run 的使用量；重啟 host 後 Done 卡仍顯示。

### 第 2 部分

- [x] AC-9：Claude 啟動指令的 `--settings` 含新的被動 hooks，且原有 sub-agent hooks 與 theme 設定不變（launch 單元測試）。
- [x] AC-10：送入一筆 hook 事件後，core 約 1 秒內推出更新後的進度事件（service 測試，fake backend）。
- [x] AC-11：通知判斷為純函式：給前後兩份進度，正確產生「步驟完成」「全部完成」「等待輸入」，且不重複觸發（單元測試）。
- [x] AC-12：關閉總開關或個別類型後，對應通知不再送出；設定重啟後保留。
- [x] AC-13：重啟 host 後重新解析，不會補發舊通知。
- [ ] AC-14：Web UI 收到 toast；開啟桌面通知後收到系統通知，點擊後選取該卡片（runtime check）。TUI 狀態列顯示通知（runtime check）。

### 共通

- [x] AC-15：Web UI 卡片與工作區面板、TUI 卡片列，都能在實際 host 上看到進度與 token 數（runtime check）。
- [x] AC-16：`npm test`、兩個 typecheck、`npm run build:web`、`npm run test:e2e` 全部通過。

## 限制與依賴

- 兩個 CLI 的 JSONL 格式都**不是公開穩定 API**，版本更新可能改變。解析器必須防禦性撰寫、只依賴少數欄位，並以 fixture 測試鎖住目前格式。
- 進度品質取決於 agent 是否使用 todo 工具。Claude Code 在多步驟任務通常會用；本次不強制。
- 現在只有 Claude 的 session id 是 VibeFlow 固定的；Codex 要靠 cwd 和時間找 rollout。同一 worktree 有多個 Codex session 時，取最新的一個。
- hooks 必須維持被動：不阻擋、不修改 agent 行為，且在 tmux session 比 core 活得久的情況下也不能出錯。傳遞方式（寫檔或呼叫 host）在 Plan 決定。
- Codex 的設定覆寫（`-c`）是整個鍵取代、不能附加，所以 VibeFlow 不碰使用者的 `notify` 與 `hooks`。
- 瀏覽器桌面通知需要 secure context；Web UI 在 loopback（`localhost`／`127.0.0.1`）上屬於 secure context，可以使用。
- 必須遵守 core 邊界：只在 `packages/core` 讀檔與判斷通知，前端只能透過 handler table 與 bus 取得資料；handler 只收 task id。「使用者正在看哪張卡」是 UI 概念，由前端自行決定是否顯示，core 不知道。
- Claude 的 sub-agent 對話可能寫在主 transcript（sidechain）或另外的檔案；計算時要確認不重複、不遺漏（Plan 階段再查實際格式）。

## 待確認事項

- 無
