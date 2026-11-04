# Spec：Jev 路由成效優化

- 狀態：已確認
- Ticket：尚無
- 需求來源：卡片「Jev 路由成效優化：預設由 Jev 選模型、記錄卡片用量」（2026-11-04）及其背景數據；延續 [jev-routing spec](../jev-routing/spec.md)。卡片附的完整報告（claude.ai artifact）本次未讀取，數字以卡片內文為準。
- 更新日期：2026-11-04
- 確認紀錄：2026-11-04 使用者決定四項範圍選擇（拆卡、只做手動升級、機械產生交接摘要、CLI＋執行紀錄清單），並確認整份 Spec；三個待確認預設（項目 5 門檻 ≥15K tokens 且預設關閉、舊卡不回補、plan 確認後不主動提示）依提議定案

## 問題與目標

Jev 已能替未指定模型的卡片選模型與 effort，但 2026-09-04 – 2026-11-04 的資料顯示成本沒有因此下降，也無從判斷它選得對不對：

- 46 張有 `jevRoute` 的卡中 42 張只選了 effort（卡片已指定模型）；Jev 選模型只用過 4 次。
- 用量 ≈ API 呼叫次數 × 每次帶的 context（cache read 佔 97.4%，output 只佔 0.35%）。session 越長每次帶得越多：<10 次呼叫約 68K，100–199 次約 180K，200–399 次約 304K。effort 對總量的影響有限，**run 的長度與單次 context 才是主要成本**。
- 卡片與 transcript 之間沒有關聯，worktree 刪除後無法回查用量；分析只能用標題比對，151 張只對上 53 張。

目標：(1) 讓 Jev 選模型實際發生；(2) 讓每張卡的 run 用量可以直接從卡片資料算出，依「複雜度 × 模型 × effort」統計；(3) 避免單一 run 的 context 無限增長；(4) 在對的階段用對的模型；(5) 量測起手成本，有明顯收益才處理。

### 程式碼現況（調查事實，非需求）

- Web 新增卡片對話框（`renderer/components/new-task-dialog.tsx`，`model` 初值 `''`）、TUI 表單（`packages/tui/src/task-form.ts`，`model: ''`）、`task create`（`--model` 不給即 `undefined`）**三處預設都已是「未指定」**，彼此一致。Web 的「未指定」選項已寫「由 Jev 選擇，沒有金鑰時用 CLI 預設模型」；TUI 仍寫「使用預設 model」。
- 本機 store（152 張卡）指定模型的卡有 97 張，其中 89 張建立於 2026-10-07 之前（`2323910` 把表單預設改成未指定）；之後建立的一般卡 47 張中只有 8 張手動指定。也就是「91 張指定 Opus」多為歷史資料，**預設值本身不是主因**；新的缺口是使用者仍會手動挑最高層級模型，且表單沒有提示。
- `Task.usage`（`TokenUsage`）是**跨 run 的累計值**，只有 input／output／cacheRead／cacheWrite／reasoning，沒有呼叫次數、run 次數、session id，也沒有當時的 `jevRoute`。`jevRoute` 在每次重新開始時被清掉（`service.ts` 的 `resetTaskRun`），所以 run 結束時的「複雜度／模型／effort」會遺失。
- `progress-tracker.ts` 已讀到每個 run 的 usage 與 `contextTokens`（最後一次請求的 context）；Claude 的 executor session id 由 `executorSessionId(taskId, runId)` 決定，Codex 的 rollout 目前不記 session id。`contextTokens` 只在工作區面板的用量表顯示，看板卡片上沒有。
- 「重新開始」（`vibeflow:resetTaskRun`）會把 worktree 還原到 base，**程式碼全部丟棄**；目前沒有「保留程式碼、只換一個新 session」的操作。

## 範圍

### 本次包含

1. **項目 1**：新增卡片預設交給 Jev 的一致性與提示（三處入口一致；有 Jev 金鑰時，手動指定最高層級模型會提示）。
2. **項目 2**：卡片記錄每個 run 的 session、用量、呼叫次數，並與路由結果放在一起；core 提供依「複雜度 × 模型 × effort」的統計。
3. **項目 3**：看板卡片顯示目前 context；超過門檻（可設定）時提示交接。
4. **交接重開**（項目 3 與 4 共用的操作）：保留 worktree、開新 session、附上前一輪摘要，可選擇同模型或升級一層。
5. **項目 4**：已確認 plan 的卡，新 run 優先選中層模型；提供手動的升級重開（不含失敗時的自動建議）。
6. **項目 5**：量測 slave 卡第一次呼叫的 context，決定是否只帶必要工具；先出數字，再決定要不要做。

### 本次不包含

- 跨 agent CLI 路由（維持 jev-routing 範圍）。
- 讓 Jev 讀 transcript；Jev 仍只回答 choice 問題（`/v1/systemone`）。統計與門檻判斷都在 core 算。
- 自動重開與升級的自動建議：任何交接／升級都由使用者（或 master 經 CLI）觸發；core 只在 context 超過門檻時提示交接。
- master 卡的交接重開（master 沒有 repo，無法產生程式碼摘要）。
- 價格表與成本換算：記錄的是 token，不是金額。每筆 run 都帶模型，之後要加權可以另外做。
- 回補舊卡：沒有 session 關聯的既有卡不推算 run 紀錄。
- 修改 Claude Code 自己的 auto-compact 行為。

## 行為

### 項目 1：預設交給 Jev

| 情境 | 預期行為 |
| --- | --- |
| 在 Web、TUI、`task create` 新增卡片且沒有選模型 | 卡片的 `model` 都是未指定（同一個結果，以測試固定） |
| Web 表單「未指定」選項 | 有 Jev 金鑰：「未指定（由 Jev 選擇）」；沒有金鑰：「未指定（沒有 Jev 金鑰，使用 CLI 預設模型：<label>）」 |
| TUI 表單同一欄位 | 同樣依 Jev 金鑰狀態顯示上述語意，取代現在的「使用預設 model」 |
| 有 Jev 金鑰，使用者手動選了最高層級模型 | 表單在該欄位下顯示提示：指定模型會略過 Jev 選模型；不阻擋建立 |
| 沒有 Jev 金鑰，或選的不是最高層級 | 不提示 |
| `task create --help` | `--model` 說明改為「預設：交給 Jev（沒有金鑰時用 agent 預設模型）」 |

「最高層級」沿用 jev-routing 的名稱推斷（opus／fable／astra／pro 等）；提示用的判斷放在 renderer 可 import 的純模組。

### 項目 2：記錄 run 與用量

一個 **run** 是從卡片啟動（或重新開始、交接重開）到下一次結束為止。run 結束時，core 在卡片上寫入一筆 **run 紀錄**：

| 欄位 | 內容 |
| --- | --- |
| `runId`、`startedAt`、`endedAt` | 此 run 的識別與時間 |
| `endedBy` | `restart`（重新開始，程式碼被丟棄）／`completed`（完成）／`handoff`（交接重開） |
| `agent` | `claude`／`codex` |
| `sessionIds` | 此 run 計入用量的 session：Claude 為 transcript 檔名（不含 subagents 子檔）；Codex 為 rollout 的 session id |
| `model`、`modelSource` | 實際啟動的模型；`card`（卡片指定）／`jev`（Jev 選）／`cli`（未指定且沒有 Jev，用 CLI 預設，`model` 缺省） |
| `effort` | 實際啟動的 effort（已依模型 clamp；沒帶 flag 則缺省） |
| `complexity`、`scoutModel` | 當時 `jevRoute` 的複雜度與 scout 模型（沒有則缺省） |
| `usage` | **這一個 run** 的 `TokenUsage`（不是累計） |
| `calls` | 這個 run 的 API 呼叫次數 |

- `calls`：Claude 為 assistant 訊息 id 去重後的數量（含 subagents）；Codex 為 `total_token_usage` 有增加的 `token_count` 事件數（近似值）。
- `Task.usage` 維持現狀（跨 run 累計，供看板顯示）；run 紀錄是另外一份、可分組的明細。
- 同一個 `runId` 只會有一筆紀錄；完成後再重開再完成，不重複計入已記錄的 run。run 沒有任何 transcript（`calls` 為 0）時不寫紀錄。
- 舊卡沒有 run 紀錄時照常顯示、照常完成；之後新產生的 run 才有紀錄。統計時略過沒有紀錄的卡並回報其數量。
- scout 的 session 與用量沿用現況：算在同一個 run 裡（`sessionIds` 會包含它）。

**統計**（core 純函式，輸入卡片資料，不讀 transcript）：依 `複雜度（無則 none）× 模型（缺省為 cli-default）× effort（缺省為 default）` 分組，每組回傳：run 數、卡片數、總 tokens 中位數、`calls` 中位數、平均每次呼叫 context 中位數（`(input+cacheRead+cacheWrite)/calls`）、**重開率**（組內 `endedBy = restart` 的 run ÷ 已結束的 run）。進行中的 run 不計入。

**呈現**：CLI `vibeflow task stats [--json]` 直接讀 store（不需要 host 在跑）。Web 工作區面板的用量區塊新增「執行紀錄」清單（每個已結束的 run 一行：第幾輪、模型、effort、複雜度、呼叫數、tokens、結束原因），沒有紀錄時不顯示。

### 項目 3：context 顯示與交接提示

| 情境 | 預期行為 |
| --- | --- |
| 卡片在 In Progress 且有 `contextTokens` | 看板卡片的用量徽章旁顯示目前 context（例如 `ctx 182K`）；工作區面板的「目前 context」維持 |
| `contextTokens` ≥ 門檻 | 看板卡片與工作區面板顯示「context 已達 <N>K，建議交接重開」並提供「交接重開」入口；不打斷 agent |
| context 回落到門檻以下（例如 agent 自己 compact） | 提示消失 |
| 門檻設定 | 設定 `contextWarnTokens`，預設 250,000，`0` 為關閉；可在 Settings 修改；舊 store 沒有此欄位時用預設值 |
| master 卡 | 只顯示 context，不提示交接 |
| Codex 卡 | 同上，使用其 `last_token_usage.input_tokens` |

### 交接重開（項目 3、4 共用）

| 情境 | 預期行為 |
| --- | --- |
| 使用者在卡片或工作區按「交接重開」 | 對話框選擇模型：**同模型**（預設）或**升級一層**；確認後執行 |
| 執行 | 結束目前 run（寫 `endedBy: handoff` 的 run 紀錄）；**保留 worktree 與程式碼**；換新的 `runId` 與新的 agent session（不是 resume）；第一個 prompt = 卡片 title／描述 + 「前一輪交接摘要」段落 |
| 摘要內容 | 由 core 機械產生，不呼叫 LLM、不讀 transcript 原文：agent 待辦清單與狀態、worktree 相對 base 的 `git diff --stat` 與 commit 清單、交接原因、前一輪的模型與 effort |
| 模型 | 同模型：沿用前一輪實際模型。升級一層：低→中、中→高（以 jev-routing 的層級為準）；已是最高層則不提供升級。不再問 Jev；`jevRoute` 記為 `routed`，`reason` 說明為交接 |
| 目前沒有 worktree、master 卡、或 agent 不在執行 | 不提供此操作，並說明原因 |
| CLI | `vibeflow task handoff --task <id> [--model same\|up]`，讓 master 能替自己的 slave 升級；規則與 `task send` 相同（只有 master 與它的卡之間可以操作） |

### 項目 4：依階段選模型

| 情境 | 預期行為 |
| --- | --- |
| 新 run 開始，卡片分支上有已確認的 `plan.md` | 啟動時 Jev 的候選只含低、中層（去掉最高層）；複雜度與 effort 照常詢問；`jevRoute` 記錄原因為「計劃已確認，執行階段」 |
| 「已確認」的判斷 | 分支新增或修改的 `plan.md`，其標頭有 `狀態：已確認`（feature-spec-plan 範本格式）；讀法沿用 `specs.ts` 對 `spec.md` 的做法，只讀標頭 |
| 卡片指定了模型 | 不套用（行為同現況） |
| 升級 | 只做手動：交接重開的「升級一層」，以及 master 用的 `task handoff --model up`。**不做**測試連續失敗或 agent 回報卡住的自動建議（transcript 沒有穩定訊號；待項目 2 累積資料後再議） |

### 項目 5：量測起手成本

- 量測 slave 卡第一次 API 呼叫的 context（`input + cacheRead + cacheWrite`），比較：預設啟動、`--strict-mcp-config`、`--disallowedTools` 只留必要工具。
- 結果與判斷寫回 `plan.md` 的實作紀錄，附原始數字與量測指令。
- 採用門檻（待確認）：任一做法讓第一次呼叫的 context 少 ≥15K tokens（約基線 65K 的 20%）才實作；實作時預設關閉、以設定啟用，因為會移除使用者的 MCP 與工具。沒有明顯差異就不做，並在 plan 記錄結論。

## 驗收條件

- [ ] AC-1：在 Web 對話框、TUI 表單、`task create` 不選模型建立卡片，三者寫入的 `model` 都是未指定。
- [ ] AC-2：有 Jev 金鑰時，Web／TUI 的「未指定」選項顯示「由 Jev 選擇」；沒有金鑰時顯示使用 CLI 預設模型。選了最高層級模型時顯示提示且仍可建立；選其他模型或沒有金鑰時不提示。
- [ ] AC-3：Claude 卡經「重新開始」後，卡片多一筆 `endedBy: restart` 的 run 紀錄，欄位如「行為」表所列，`usage` 為該 run 自己的用量，`complexity`／`model`／`effort` 是該 run 啟動時的實際值（即使 `jevRoute` 之後被清掉）。
- [ ] AC-4：卡片完成時寫入 `endedBy: completed` 的 run 紀錄；同一 `runId` 重複完成不新增紀錄。
- [ ] AC-5：Codex 卡的 run 紀錄含 rollout session id 與近似 `calls`；`test/fixtures/progress/` 的 fixture 固定新讀取的欄位。
- [ ] AC-6：沒有 `runs` 欄位的舊 store 能載入、顯示、完成與重開，且之後新 run 會產生紀錄；`Task.usage` 不變。
- [ ] AC-7：不讀任何 transcript，僅憑卡片資料，統計函式與 `vibeflow task stats` 能輸出各「複雜度 × 模型 × effort」組合的 run 數、tokens／calls／平均 context 中位數與重開率，並回報被略過的舊卡數量。
- [ ] AC-8：Web 工作區面板顯示執行紀錄清單；沒有紀錄的卡不顯示該區塊。
- [ ] AC-9：In Progress 卡片在看板上顯示目前 context；超過門檻時顯示交接提示，低於時消失；`contextWarnTokens` 可在 Settings 修改，`0` 關閉，舊 store 使用預設 250,000。
- [ ] AC-10：交接重開後 worktree 的檔案與 commit 不變、`runId` 與 session 改變、第一個 prompt 含卡片文字與交接摘要；產生 `endedBy: handoff` 紀錄；「升級一層」的模型為下一層；master 卡與無 worktree 的卡不提供。
- [ ] AC-11：分支有 `狀態：已確認` 的 `plan.md` 且卡片未指定模型時，新 run 的 Jev 候選不含最高層；指定模型的卡不受影響；`task handoff --model up` 與交接重開的「升級一層」都能把模型升到下一層。
- [ ] AC-12：項目 5 產出量測數字與是否採用的結論，寫入 `plan.md`；若採用，預設關閉且有設定可啟用。
- [ ] AC-13：AGENTS.md 的 Definition of Done：兩份 typecheck、`npm test`、`npm run build:web`；動到 Web UI 流程、transport 或 handler table 的項目加 `npm run test:e2e`；每個已實作的項目在 Web UI 實際驗證一次。

## 限制與依賴

- transcript 格式不是公開 API：只新增讀取 Codex `session_meta` 的 session id 與 `token_count` 次數等少數欄位，沿用 `progress.ts` 的寬鬆讀法，並用 `test/fixtures/progress/` 固定格式。
- 項目 2 改變 store 中 `Task` 的形狀（新增選填 `runs`），並在 `AppSettings` 新增選填 `contextWarnTokens`。兩者皆為新增選填欄位，不改寫既有資料；讀取時以 `normalize*` 容忍缺失與壞資料（沿用 `normalizeUsage` 的做法）。migration 細節與 `STATE_VERSION` 是否需要調整在 plan 決定。
- token 數不等於成本：不同模型每 token 單價不同，所以統計一律帶模型維度；「選便宜模型是否真的省」需要把模型單價套到這份統計上，本次不做。
- 模型層級依名稱推斷（jev-routing 已知限制），提示與「升級一層」都受它影響。
- `plan.md` 的「已確認」判斷綁定 feature-spec-plan 的範本格式；格式改變時需同步。規劃與實作通常在同一個 run 裡完成，所以「去掉最高層」只會在 plan 確認**之後才開始**的 run 生效（重新開始、交接重開、master 派發已有 plan 的卡）；run 進行中不會自動換模型。
- 交接重開依賴 `service.ts` 的啟動與 session 流程（`startTaskSession`、`resetTaskRun` 周邊），不得動到 master／slave 的通知與 mailbox 行為。
- 文件需同步：`AGENTS.md`（Task 形狀、CLI 指令、launch 例外）、`packages/core/IPC_API_MAP.md`（handler table）、`docs/README.md`、`test/README.md`。

## 待確認事項

已由使用者決定（2026-11-04）：

- 拆卡：整份 spec 涵蓋五項；本卡實作 spec／plan 與**項目 2**，項目 1、項目 3＋交接重開、項目 4、項目 5 各開一張子卡，順序為 項目 2 → 項目 1 → 項目 3＋交接重開 → 項目 4 → 項目 5。
- 升級觸發：只做手動，不做自動建議。
- 交接摘要：由 core 機械產生（待辦、`git diff --stat`、commit 清單、原因）。
- 統計呈現：CLI `vibeflow task stats` 加卡片的執行紀錄清單，不新增 Web 統計頁。

依提議定案（2026-11-04 隨整份 Spec 確認）：

- **項目 5 的採用門檻**：≥15K tokens（約基線 65K 的 20%）才實作，且預設關閉。
- **舊卡不回補**：舊卡無 session 關聯、worktree 已刪，推算只會產生不可靠的資料；統計略過並回報數量。
- **plan 確認後的提示**：「去掉最高層」只影響之後才開始的 run；run 進行中不主動提示換模型。

目前沒有未解決的待確認事項。
