# Spec：Agent 模型清單與 effort 改由本機 CLI 取得

- 狀態：已確認
- Ticket：尚無
- 需求來源：2026-10-07 對話。使用者要求「不設 API key、不用開發者個人憑證」取得可用模型，並指定兩個做法：
  Claude Code 用 headless session 握手；Codex 用 `codex app-server`（使用者在 Codex 中確認過的流程）。
- 更新日期：2026-10-07
- 確認紀錄：2026-10-07 使用者確認整份 Spec（「spec 確認，開始寫 plan」）。過程中確認的決策——
  - 清單在 host 啟動時於背景取得，設定頁可手動重新整理。
  - Claude 選單列出全部項目，但去掉 `default`。
  - effort 選單本次一起跟著模型變化；等級全部依模型宣告開放，包含 `max` 和 Codex 的 `ultra`。
  - 切換模型時保留卡片的 effort，只在不支援時降級；不採用 Codex 的 `defaultReasoningEffort`。模型完全不支援 effort 時停用 slider，啟動時不帶 effort。
  - Codex 的來源順序：app-server → `models_cache.json` → 內建清單。app-server 取代 `codex debug models`。
  - Codex 呼叫 `account/read`，但只用來判斷登入狀態；用 API key 登入也放行。

## 問題與目標

兩個 agent 的模型選單目前都有缺口（`packages/core/src/agents.ts`、`packages/core/src/agent-models.ts`）：

- **Claude Code**：只有寫死的 `sonnet` / `haiku` / `opus` 三個別名。別名會解析到最新版，但**新系列不會出現**（例如帳號已可用的 `fable`），也看不出別名實際對應哪個模型。
- **Codex**：讀 `models_cache.json`，重新整理時跑 `codex debug models`。兩者都不是公開介面，讀不到時退回的內建清單（`gpt-5.5` 等）已經過時。
- **effort**：slider 對所有模型一律提供 `low`～`xhigh`。選 Haiku 時照樣送出它不支援的 effort，兩邊都支援的 `max`、Codex 的 `ultra` 卻選不到。

目標：

1. 模型清單改成「使用者已登入的本機 CLI 回報、這個帳號可用的模型」。不需要任何 API key，也不讀取 CLI 儲存的憑證。
2. effort 可選的等級跟著選到的模型走。

前一輪決策（`docs/plans/AGENT_MODELS_PLAN.md`）因為要新增依賴、開 SDK session，否決了 Agent SDK 的 `supportedModels()`。
本 Spec 不加任何依賴：直接對使用者已安裝的 `claude` 和 `codex` 做初始化握手，兩者都不建立對話、不送 prompt。

## 取得方式

### Claude Code（2026-10-07 實測，Claude Code 2.1.292）

```sh
claude -p --input-format stream-json --output-format stream-json --verbose
# stdin 只寫入一行，不送任何 user message：
{"type":"control_request","request_id":"r1","request":{"subtype":"initialize"}}
```

- stdout 會出現 `{"type":"control_response","response":{"response":{"models":[...], ...}}}`。
- 每個 model 有：`value`（傳給 `--model` 的值）、`resolvedModel`、`displayName`、`description`，
  以及選填的 `supportsEffort`、`supportedEffortLevels`（字串陣列）、`supportsAdaptiveThinking`、`supportsFastMode`、`supportsAutoMode`。
- 實測回傳 12 筆：`default`、`opus`、`sonnet`、`fable`、`haiku`、`claude-sonnet-5`、`claude-opus-5`、`claude-fable-5`、`claude-opus-4-8`、`claude-opus-4-7`、`claude-opus-4-6`、`claude-sonnet-4-6`。
  多數模型的 effort 是 `low`～`max`；`claude-opus-4-6`、`claude-sonnet-4-6` 沒有 `xhigh`；`haiku` 沒有 `supportsEffort`。
- 約 0.7 秒收到回應；關閉 stdin 後程序以 exit 0 結束（總計約 2 秒）。
- 不會產生 `result` 訊息、不計費，`~/.claude/projects/` 也沒有新增 transcript。
- 同一個回應還帶有 `account` 等欄位。**只取 `models`**，其他欄位不解析、不記錄、不寫入磁碟。

### Codex CLI（2026-10-07 實測，codex-cli 0.153.4）

前提：使用者已安裝 Codex CLI，並以 `codex login` 登入。參考 OpenAI 文件：[Codex 驗證](https://learn.chatgpt.com/docs/auth)、[app-server](https://learn.chatgpt.com/docs/app-server)。

1. 執行 `codex app-server --listen stdio://`，用 stdin/stdout 傳送逐行 JSON。
2. 送出 `initialize`，**等到成功回應**後才送 `initialized` 通知和後續請求。
3. 呼叫 `account/read` 判斷是否已登入。未登入時提示使用者執行 `codex login`。用 API key 登入也放行。
4. 呼叫 `model/list`，參數 `includeHidden: false`。回應的 `nextCursor` 不是 `null` 時，下一次請求在 `params` 加上 `cursor`，直到 `nextCursor` 為 `null`。
5. 取得清單後關閉 app-server。過程不需要 `thread/start`、`turn/start` 或 prompt。

```
{"method":"initialize","id":1,"params":{"clientInfo":{"name":"vibeflow","title":"VibeFlow","version":"<app-version>"}}}
{"method":"initialized","params":{}}
{"method":"account/read","id":2,"params":{"refreshToken":false}}
{"method":"model/list","id":3,"params":{"limit":100,"includeHidden":false}}
```

- `model/list` 的回應是 `{ data: [...], nextCursor }`。每個 model 有 `id`（模型識別碼）、`displayName`、`description`、`hidden`、
  `supportedReasoningEfforts`（**物件陣列**：`[{ reasoningEffort, description }]`）、`defaultReasoningEffort`，以及其他本次用不到的欄位。
- 實測：約 0.2 秒完成握手、0.65 秒取得清單，回傳 4 個可見模型（`gpt-6-astra`、`gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna`），程序以 exit 0 結束，沒有建立對話。
  前 3 個模型的 effort 是 `low`～`ultra`，`gpt-5.6-luna` 是 `low`～`max`。`ultra` 的說明是「最高推理深度，並自動委派子任務」。
  （VibeFlow 這次的實測沒有呼叫 `account/read`；使用者在自己的實測中有呼叫。）
- `account/read` 的回應**只讀登入狀態與登入類型**，其他帳號欄位不保留、不記錄。
- `model/list` 是選單目錄，**列出來不保證能執行**。選用後的權限錯誤由 CLI 在 terminal 裡回報，VibeFlow 不預先驗證。
- `launch.ts` 啟動 session 時會把 `CODEX_HOME` 改指向 library 目錄。查詢清單時必須用**使用者原本的** `CODEX_HOME`，否則會讀不到登入狀態。

## 範圍

### 本次包含

- **Core**：`listAgentModels` 兩個 agent 都改用上面的握手。
  - Claude 新增來源 `claude-cli`，失敗時退回內建別名。
  - Codex 新增來源 `codex-app-server`，取代 `codex debug models`（來源 `codex-cli`）；失敗時依序退回 `models_cache.json`（`codex-cache`）、內建清單。
  - 每個模型解析出 `id`、顯示名稱、說明，以及支援的 effort 等級。
- **觸發時機**：host 啟動時在背景執行一次，結果存在 host 記憶體；設定頁「重新整理」可手動重跑。開新增／編輯任務對話框時**不啟動程序**。
- **Claude 選單**：列出全部項目，但去掉 `value: 'default'`（「使用預設 model」已經涵蓋）。
- **Codex 選單**：列出 `includeHidden: false` 的全部模型。
- **effort**：
  - `AgentEffort` 新增 `max`、`ultra`，順序為 `low` < `medium` < `high` < `xhigh` < `max` < `ultra`。
  - slider 只提供目前模型宣告支援的等級，不分 agent。
  - 切換模型（或切換 agent）時保留卡片的 effort；新模型不支援時，降到「不超過原本等級」中最高的那個。
  - 模型完全不支援 effort 時停用 slider，啟動時不帶 effort。
  - 新卡片的預設維持 `medium`（`DEFAULT_TASK_EFFORT`），不採用 Codex 的 `defaultReasoningEffort`。
  - 啟動時 core 依快取的模型資訊再檢查一次，所以 CLI 建立的卡片或舊卡片也不會送出不支援的 effort。
- **設定頁「模型」區塊**：兩個 agent 都顯示來源並提供「重新整理」。Codex 未登入時提示「請執行 `codex login`」。
- **測試**：用 fixture 固定兩種回應的形狀，讓 CLI 改格式時由測試抓到，而不是在使用者畫面上壞掉。
- **TUI**：模型選項透過同一個 handler 取得；effort 的切換也套用同一套限制。
- **CLI**：`vibeflow task create --effort` 接受 `max`、`ultra`。CLI 程序手上沒有模型資訊，所以不在建立時檢查，交給啟動時降級。

### 本次不包含

- 讀取或保存任何帳號資訊（Claude 的 `account`、Codex `account/read` 中登入狀態以外的欄位）。
- 用 API key 或 OAuth token 呼叫任何模型 API。
- 依方案限制使用者（例如只允許 ChatGPT 方案）。
- 自訂模型輸入：已經存在，行為不變。自訂的 ID 不在清單中，effort 不做限制。
- 預先驗證選到的模型能否執行。

## 行為

| 情境 | 預期行為 |
|---|---|
| host 啟動，CLI 已安裝且已登入 | 兩個 agent 各在背景跑一次握手，結果存在 host 記憶體；不阻塞啟動 |
| 開啟新增／編輯任務對話框 | 讀記憶體快取，不啟動程序；快取尚未就緒或失敗時，顯示該 agent 的退回清單 |
| 模型選單內容 | 顯示名稱用 `displayName`，說明用 `description`；送給 CLI 的是 Claude 的 `value` 或 Codex 的 `id`。Claude 不列 `default` |
| 卡片既有的 `task.model` 不在新清單中 | 照現行行為補進選項，不改卡片資料 |
| 選到的模型只支援部分 effort（例如 Opus 4.6 沒有 `xhigh`） | slider 只能選它支援的等級 |
| 從 `xhigh` 切到 Opus 4.6 | effort 自動變成 `high` |
| Codex 選 `ultra` 後改成 Claude 模型 | effort 自動變成 `max` |
| 切到不支援 effort 的模型（Haiku） | slider 停用並說明原因；卡片保留原本的值，但啟動時不帶 effort |
| 再切回支援 effort 的模型 | slider 恢復，沿用卡片保留的值（必要時再降級） |
| 「使用預設 model」 | effort 依 VibeFlow 啟動時實際補上的模型（`launch.ts` `DEFAULT_MODELS`：Claude 是 `sonnet`、Codex 是 `gpt-5.5`）在清單中的支援等級；不在清單中則視為模型資訊不可用 |
| 自訂模型 ID，或模型資訊不可用（`models_cache.json` / 內建清單） | effort 提供 `low`～`xhigh`（等同現行行為）；`max`、`ultra` 只在模型資訊明確宣告時開放 |
| 選 `ultra` | slider 顯示固定的中文說明（會自動委派子任務，耗時與用量可能明顯增加），讓使用者知道成本可能較高 |
| Codex 未登入 | 退回快取檔或內建清單；設定頁顯示「請執行 `codex login`」 |
| 設定頁按「重新整理」 | 重跑該 agent 的握手並更新快取與來源標示；失敗則顯示退回清單和錯誤訊息 |
| 未安裝 CLI／逾時／回應形狀不符 | 走退回順序，並帶 `error` |
| 握手程序 | 完成或逾時後一定結束子程序，不留殘留程序 |

## 驗收條件

- [ ] AC-1：已登入的環境中，host 啟動後打開新增任務對話框，Claude 選單包含 `fable` 等內建清單沒有的模型，顯示名稱來自 `displayName`，且沒有 `default`。
- [ ] AC-2：同樣條件下，Codex 選單列出 `model/list` 的模型（實測環境是 4 個），顯示名稱來自 `displayName`。
- [ ] AC-3：選擇清單中的模型並啟動卡片後，terminal 裡實際執行的指令帶有對應的模型（Claude 是 `--model <value>`，Codex 是 `--model <id>`）。
- [ ] AC-4：打開對話框不會啟動任何 CLI 程序（測試用假的 runner 計數驗證）。
- [ ] AC-5：Claude runner 拋錯、逾時或形狀不符時，結果是內建別名、`source: 'builtin'`，並帶 `error`。
- [ ] AC-6：Codex app-server 失敗時退回 `models_cache.json`（`source: 'codex-cache'`）；快取檔也不可用時退回內建清單；兩種情況都帶 `error`。
- [ ] AC-7：Codex 的 `model/list` 有 `nextCursor` 時會帶 `cursor` 繼續取，直到 `nextCursor` 為 `null`，最後合併全部頁面。
- [ ] AC-8：Codex `initialize` 沒有成功回應前，不會送出任何其他訊息。
- [ ] AC-9：解析結果、log 與 store 都不含帳號資訊（以含 `account` 的 Claude fixture、含帳號欄位的 Codex `account/read` fixture 驗證）。
- [ ] AC-10：選 Opus 4.6 時 slider 沒有 `xhigh`；先選 `xhigh` 再切到 Opus 4.6，effort 變成 `high`。
- [ ] AC-11：選 Haiku 時 slider 停用；啟動後 terminal 的指令沒有 `--effort`。
- [ ] AC-12：Claude 模型可以選 `max`，啟動時帶 `--effort max`；Codex 模型可以選 `ultra`，啟動時帶 `model_reasoning_effort="ultra"`。
- [ ] AC-13：core 在啟動時依模型資訊降級或省略 effort（以 `launch.ts` 的單元測試驗證，不依賴 UI）。
- [ ] AC-14：Codex 子程序以使用者原本的 `CODEX_HOME` 執行，不是 library 的目錄（單元測試驗證傳入的環境變數）。
- [ ] AC-15：成功、失敗、逾時三種情況下，子程序都會結束（單元測試驗證）。
- [ ] AC-16：TUI 的模型與 effort 選項遵守 AC-1、AC-2、AC-10、AC-11 的相同規則。
- [ ] AC-17：設定頁兩個 agent 的「重新整理」都能更新清單與來源標示；Codex 未登入時顯示 `codex login` 提示。
- [ ] AC-18：DoD 全部通過：兩個 tsc、`npm test`、`npm run build:web`、`npm run test:e2e`，再加上 live Web UI 的手動檢查。

## 限制與依賴

- **介面穩定度**：
  - Claude 的 `initialize` 控制請求是 Claude Code 和 Agent SDK 之間的內部協定，沒有公開文件，CLI 升級時可能改變。
  - Codex 的 app-server 有 OpenAI 公開文件，比原本的 `models_cache.json` / `codex debug models` 穩定。
  - 兩者都有退回機制和 fixture；最壞情況是選單和 effort 退回現在的樣子。
- 需要使用者已安裝並登入對應的 CLI；這本來就是在 VibeFlow 執行該 agent 卡片的前提。
- **會動到的契約**（Plan 需要一個「檢查所有使用端」的階段）：
  - `AgentEffort` / `AGENT_EFFORTS` 新增 `max`、`ultra`：使用端有 `service.ts` 驗證、`task-command.ts`、`launch.ts`（Claude 的 `--effort` 和 Codex 的 `model_reasoning_effort`）、TUI `task-form.ts`（它也有一份 `EFFORTS`），以及 renderer `task-effort-slider.tsx`（它也複製了一份 `DEFAULT_TASK_EFFORT`）、`test/agents.test.mjs`。
  - `AgentModel` 新增說明與 effort 相關欄位；`AgentModelSource` 新增 `claude-cli`、`codex-app-server`，移除 `codex-cli`（renderer 的 `MODEL_SOURCE_LABELS` 依賴它）。
  - `client.ts` / `renderer/lib/api.ts` 的 `listAgentModels` 回傳形狀擴充；登入提示需要新欄位或沿用 `error`，在 Plan 決定。
- **持久化資料**：`task.effort` 存在 `vibeflow-state.json`。新增 `max`、`ultra` 只是擴充可接受的值，舊資料依然合法，不需要 migration；降級是在 UI 與啟動時計算，不回寫舊卡片。模型快取只放在 host 記憶體，不寫入 store。
- 「卡片保留原值、啟動時才省略或降級」的前提是：啟動時 core 手上有模型資訊。若快取尚未就緒或失敗，就照原值送出（等同現行行為），交給 CLI 處理。
- Codex 是否接受 `-c model_reasoning_effort="ultra"`、`"max"` 這兩個寫法，Plan 階段要先實測確認。

## 待確認事項

- 無。

## 變更紀錄

- 2026-10-07（Plan 調查後，待重新確認）：「使用預設 model」的 effort 依據，原本寫的是 Claude 握手回報的 `default` 那筆。
  但 VibeFlow 在卡片沒選模型時並不使用 CLI 的預設，而是由 `launch.ts` 的 `DEFAULT_MODELS` 補上 `sonnet`／`gpt-5.5`。
  改成依實際補上的模型，effort 限制才會和真正執行的模型一致。
- 2026-10-07：`max` / `ultra` 的說明改用固定中文，與既有 4 級一致（Claude 不回報各等級說明）。
- 2026-10-07：使用者確認以上兩項變更（「都同意，plan 確認，開始實作」）。
