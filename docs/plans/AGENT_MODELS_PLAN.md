# Agent model 清單：拿掉 API key 依賴

> **狀態：已實作**（`7887793`，2026-10-02）。本文件保留為決策記錄；現行實作在
> `packages/core/src/agent-models.ts`，`agent-connections.ts` 已刪除。

## 問題

目前 model 下拉選單**只**顯示透過 API key 打 `/v1/models` 取回的清單
（`agent-connections.ts` → `settings.agentConnections[id].models`）。沒綁 key
的使用者只會看到「尚未連線或無法取得 model list，將使用預設 model」，
完全無法選 model。`AGENT_CLIS` 裡內建的 `sonnet / haiku / opus`、`gpt-5.5…`
清單在 picker 裡**沒有被用到**。

另外，API key 以明文存在 `vibeflow-state.json` 的 `settings.agentConnections`。

真正執行 agent 的是使用者已登入的 `claude` / `codex` CLI，model 清單應該也從
CLI 這一側取得。

## 目標行為

| Agent | 清單來源（依序 fallback） |
|---|---|
| Claude Code | `AGENT_CLIS` 內建 alias（`sonnet` / `opus` / `haiku`）。CLI 會把 alias 解析到最新版本，不需要動態清單。 |
| Codex CLI | ① 讀 `$CODEX_HOME/models_cache.json`（預設 `~/.codex`），取 `models[].slug`、濾掉 `visibility === 'hide'` → ② 使用者按「重新整理」時才跑 `codex debug models`（有 timeout）→ ③ `AGENT_CLIS` 內建清單 |

兩個 agent 的 picker 都多一個「自訂…」選項，可以直接輸入完整 model id
（例如 `claude-opus-5-5`）。

開新增／編輯任務對話框時**只讀檔、不 spawn process**（守住 `agents.ts:97`
的既有約束）。spawn `codex debug models` 只在設定頁的「重新整理」按鈕觸發。

## 資料形狀與 migration

- 移除 `AppSettings.agentConnections`、`AgentConnection`、`AgentConnections`、
  `ConnectableAgentId`。
- model 清單**不存進 store**：每次由 handler 現算（讀快取檔很便宜），
  「重新整理」的結果寫回 Codex 自己的快取檔是 Codex 的事，我們不另存。
- **Migration**：store 載入時把 `settings.agentConnections` 整個刪掉
  （裡面就是明文 API key）。這一步不可逆，使用者之後想用 key 也已無處可用。
  → 見「待決定」第 1 點。
- 既有任務的 `task.model` 不動：picker 會把不在清單裡的現值補進選項（現有行為保留）。

## 階段

### 1. Core：`agent-models.ts`（取代 `agent-connections.ts`）
- `listAgentModels(id: AgentCliId, opts: { refresh: boolean }): Promise<AgentModelList>`
  - `AgentModelList = { models: AgentModel[]; source: 'builtin' | 'codex-cache' | 'codex-cli'; error?: string }`
  - Codex 快取檔路徑：`process.env.CODEX_HOME ?? ~/.codex`。注意 `launch.ts`
    啟動 session 時會覆寫 `CODEX_HOME` 指向 library 目錄，偵測時要用使用者
    原本的環境，不能用那個。
  - 格式不符（沒有 `models` 陣列、缺 `slug`）→ 靜默退回 builtin，帶 `error`。
  - `codex debug models` 用 `execFile` + timeout（約 20s）+ `windowsHide`。
- 刪除 `agent-connections.ts`。
- 測試 `test/agent-models.test.mjs`：
  - 用暫存目錄當 `CODEX_HOME`：正常快取、`hide` 被濾掉、壞 JSON、檔案不存在。
  - Claude 永遠回 builtin。
  - `refresh` 路徑：注入假的 exec 函式，不真的跑 `codex`。

### 2. Core：handler table 與 migration
- `service.ts`：移除 `settings:connectAgent`、`settings:refreshAgentModels`；
  新增 `agents:listModels`（payload `{ agentId, refresh? }`，驗證 `agentId`
  ∈ `AGENT_CLIS`）。
- `vibeflow:setSettings` 裡過濾 `agentConnections` 的那段改成過濾掉未知鍵
  或直接刪除（欄位已不存在）。
- `store.ts`：載入時刪除 `settings.agentConnections` 並寫回。
- `client.ts`：`listAgentModels(agentId, refresh?)` 取代 `connectAgent` /
  `refreshAgentModels`。
- `IPC_API_MAP.md` 更新。
- 測試：
  - `service.test.mjs`：`'settings writes cannot overwrite stored API keys'`
    改成驗證 migration 後 `agentConnections` 不存在；新增 `agents:listModels`
    的參數驗證測試。
  - store migration 測試：舊 state 含 `agentConnections.apiKey` → 載入後消失。

### 3. Renderer
- `lib/api.ts`：`listAgentModels` wrapper；移除舊的兩個。
- `lib/types.ts`：移除已刪除型別的 re-export。
- `new-task-dialog.tsx` 的 `AgentModelFields`：
  - 改收 `models: AgentModel[]`（由上層依 `agentCli` 呼叫 `listAgentModels`），
    不再收 `agentConnections`。
  - 永遠顯示 select：`使用預設 model` + 清單（顯示 `label`）+ 現值（若不在清單）+ `自訂…`。
  - 選「自訂…」時出現文字輸入框。
- `edit-task-dialog.tsx`、`kanban-board.tsx`、`home.tsx`：拿掉
  `agentConnections` 的 state 與 prop 傳遞。
- `settings-dialog.tsx`：移除 API key 連線頁（輸入框、`keyUrl` 連結、Connect 按鈕）。
  改成每個 agent 一列唯讀資訊：model 數量、來源（內建／Codex 快取／Codex CLI），
  Codex 那列保留「重新整理」按鈕（呼叫 `refresh: true`）。

### 4. TUI
- `task-form.ts`：`FormContext.connections` 換成
  `models: Partial<Record<AgentCliId, AgentModel[]>>`，`modelOptions` 改讀它；
  開表單時對每個已偵測到的 agent 呼叫一次 `listAgentModels`（不 refresh）。
- 自訂 model id 在 TUI **不做**（cycling 選擇維持現狀），避免這次改動擴大。
- `tui-task-form.test.mjs` 對應更新。

### 5. 驗收（DoD）
- `npx tsc --noEmit -p tsconfig.json`
- `npx tsc --noEmit -p renderer/tsconfig.json`
- `npm test`
- `npm run build:web`
- `npm run test:e2e`（handler table 有變）
- 手動：`npm start -- --store-path <tmp> --no-open --port 47831`
  - 用一份含 `agentConnections.apiKey` 的舊 store 啟動，確認 key 被清掉。
  - 新增任務：Claude 看得到 alias、Codex 看得到快取清單、「自訂…」可輸入並成功
    launch（看 terminal 裡實際帶的 `--model`）。
  - 設定頁按 Codex「重新整理」。

## 不做

- Claude Agent SDK `supportedModels()`：要加新相依、要開 SDK session，換來的只是
  alias 已經涵蓋的東西。
- 讀 `~/.claude/settings.json` 的 `availableModels`：可以之後再加，不阻塞這次。
- TUI 的自訂 model 輸入。

## 風險

- `models_cache.json` 與 `codex debug models` 都不是 Codex 的公開穩定介面，
  CLI 升級可能改格式。fallback 到 builtin 可以確保不會壞掉，最差情況是清單變舊。
- 內建 Codex 清單（`gpt-5.5 / 5.4 / 5.4-mini`）已經落後於實際可用的 model，
  但它只在快取讀不到時才出現。

## 待決定

1. **API key 是完全移除，還是保留成選用？**
   預設：完全移除，並在 migration 刪掉 store 裡的明文 key。
   保留的話，store 形狀與設定頁都要留著，這份計劃的第 2、3 階段會縮小，
   但明文 key 的問題仍在。
2. **Claude 的「自訂…」輸入要不要做驗證？** 預設：不驗證，直接傳給 `--model`，
   打錯由 CLI 回報錯誤。
