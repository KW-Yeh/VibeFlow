# Plan：Agent 模型清單與 effort 改由本機 CLI 取得

- 狀態：已確認
- 對應 Spec：[spec.md](./spec.md)
- Spec 確認依據：2026-10-07 使用者確認整份 Spec，以及 Plan 調查後的兩項變更（見 Spec「變更紀錄」）。
- 更新日期：2026-10-07
- 確認紀錄：2026-10-07 使用者確認 Plan 與待確認 1、2（「都同意，plan 確認，開始實作」）。待確認 3 另開卡處理。

## 現有程式碼調查

| 檔案 | 現況與可重用的部分 |
|---|---|
| `packages/core/src/agents.ts:15-33` | `AgentEffort = 'low'\|'medium'\|'high'\|'xhigh'`、`AGENT_EFFORTS`、`DEFAULT_TASK_EFFORT`。`AgentModel` 只有 `{ id, label }`。這個模組會用 `child_process`（`which`），所以 renderer 不能在執行期 import 它。 |
| `packages/core/src/agent-models.ts` | `listAgentModels`：Claude 永遠回內建清單；Codex 讀 `models_cache.json`，`refresh` 時跑 `codex debug models`。沒有任何記憶體快取。`parseCodexCatalog` 的「形狀不符就拋錯、由呼叫端退回」模式可以沿用。 |
| `packages/core/src/launch.ts:324-489` | `assembleCommand` 把 effort 原樣轉成 Claude 的 `--effort` 或 Codex 的 `-c model_reasoning_effort=...`，沒有任何檢查。`taskModel()` 在卡片沒選模型時補 `DEFAULT_MODELS`（`sonnet` / `gpt-5.5`）。renderer 在執行期會 import 這個檔，所以它只能 import type（`test/core-boundary.test.mjs` 的 `RENDERER_SAFE`）。 |
| `packages/core/src/service.ts` | `launchCommand`（`:337-353`）是組指令的唯一入口，由 `pty:start` 呼叫，適合放啟動時的 effort 檢查。`agents:listModels`（`:475-478`）。`vibeflow:updateTask`（`:625`）沒有驗證 effort，`createTask`（`:504`）有。`CoreOptions` 已經有可注入的 `ghRunner`。 |
| `packages/core/src/github.ts:355-414` | 快取模式：快取 promise 本身，讓同時發出的請求共用同一次載入；可注入時鐘與 runner。模型快取沿用這個形狀，但不設 TTL（Spec：啟動時抓一次，加上手動重新整理）。 |
| `packages/cli/src/host.ts:56-127` | `startHost` 依序建立 core、啟動 server。TUI 當 host 時也走同一個 `startHost`。背景預熱放在這裡，`createCore` 本身不啟動程序，所以 `npm test` 直接呼叫 `createCore` 時不會意外跑真的 CLI。 |
| `packages/core/src/env.ts:91-95` | `execEnv()`：複製 `process.env`，並在 PATH 補上常見的安裝目錄。子程序一律用它。 |
| `packages/core/src/library.ts:578-591`、`launch.ts:371-373` | 只有在啟動卡片、且有啟用 library 時，`CODEX_HOME` 才會被改指向 library 目錄；host 程序本身的環境沒有被改。所以查詢清單時用 `execEnv()`，就是使用者原本的 `CODEX_HOME`。 |
| `renderer/components/task-effort-slider.tsx` | `EFFORT_OPTIONS` 寫死 4 級，刻度列寫死 `grid-cols-4`；另外複製了一份 `DEFAULT_TASK_EFFORT`（由 `test/agents.test.mjs` 比對兩份是否一致）。 |
| `renderer/components/new-task-dialog.tsx:202-335` | `AgentModelFields` 自己抓模型清單，不會傳給上層，所以上層算不出 effort 限制。新增卡片有兩種版面，各有一個 slider（`:879`、`:939`）。切換 agent 時只清空 model，不動 effort（`:686`）。 |
| `renderer/components/edit-task-dialog.tsx` | 重用 `AgentModelFields`，有一個 slider（`:331`）；切換 agent 的處理同上（`:192`）。 |
| `renderer/components/settings-dialog.tsx:45-49, 534-590` | `MODEL_SOURCE_LABELS` 是 `Record<AgentModelSource, string>`；只有 Codex 那列有「重新整理」。 |
| `packages/tui/src/task-form.ts` | 自己有一份 `EFFORTS`（4 級）和 `DEFAULT_EFFORT`；`FormContext.models` 只存 id 字串。`EFFORTS.find(...)!` 遇到不在清單的 effort 會讓畫面崩潰。開表單時抓一次清單（`:536-559`）。 |
| `packages/cli/src/task-command.ts:33, 187` | `--effort` 依 `AGENT_EFFORTS` 驗證，所以清單擴充後自動接受新等級。這個指令目前沒有測試。 |
| `e2e/web.e2e.mjs:29-33, 89` | 用 PATH 上的假 `claude` 腳本：不論參數都印出 `fake-claude ready`，在 cwd 寫一個檔案，然後一直讀 stdin。**沒有假的 `codex`**，所以會用到機器上真正的 `codex`（搭配私有 HOME，等於未登入）。 |
| `test/agent-models.test.mjs`、`test/service.test.mjs:151-158`、`test/agents.test.mjs`、`test/tui-task-form.test.mjs` | 現有測試；runner 透過 option 注入。 |

## 方案與取捨

**1. 子程序互動抽成可注入的「傳輸層」。**
Claude 和 Codex 的查詢各寫成一個函式，透過一個小介面和子程序溝通：送出一行 JSON、收到一行 JSON、結束。正式環境由 `child_process.spawn` 實作；單元測試換成記憶體中的假物件，用來驗證協定順序：Codex 要等 `initialize` 成功才送下一個請求（AC-8）、會一路翻頁到 `nextCursor` 為 `null`（AC-7）、不會保留帳號欄位（AC-9）。
另外用 `process.execPath` 執行一支故意不回應的小腳本，驗證逾時時子程序真的被結束（AC-15）。
不直接 mock `child_process`：注入點越少，測試越貼近真實的行為。

**2. 快取放在 `createCore` 的 closure 裡**（`createModelCatalog`，沿用 github 的模式）：
- 每個 agent 各存一個「最近一次查詢」的 promise。
- `get(agent)` 不啟動任何程序：查詢已完成就回傳結果；還沒查過或還在查時，回傳退回清單（Codex 讀 `models_cache.json`，再不行就內建清單），並帶 `pending: true`。
- `refresh(agent)` 重新查詢並更新快取。
- `warm()` 在背景對兩個 agent 都跑一次 `refresh`，只由 `startHost` 呼叫。
- `CoreOptions` 新增 `modelCatalog?`，測試可以注入假的實作。
- 不寫入 store，所以不需要 migration。

**3. effort 規則放進新的純函式模組 `packages/core/src/effort.ts`。**
它不 import 任何東西，所以 renderer、TUI 和 core 可以共用同一份規則：
- `AGENT_EFFORTS = ['low','medium','high','xhigh','max','ultra']`（由淺到深）。`agents.ts` 改成從這裡 re-export，既有的 import 不用改。
- `allowedEfforts(model?: AgentModel)`：
  - 回傳 `null` 表示模型資訊不可用（自訂 ID、內建清單、快取檔），此時開放 `low`～`xhigh`。
  - 回傳 `[]` 表示模型不支援 effort。
  - 其他情況回傳模型宣告的等級。
- `clampEffort(effort, allowed)`：
  - `[]` 回傳 `undefined`（不帶 effort）。
  - 原本的等級不被允許時，回傳「不超過原本等級」中最高的；沒有任何等級不超過原本等級時，回傳允許清單中最低的。
- `test/core-boundary.test.mjs` 的 `RENDERER_SAFE` 加入 `effort.ts`。這是把一個沒有任何 import 的模組列入允許名單，不是放寬規則：該測試仍會要求 `effort.ts` 只能 import type。

替代方案：把規則放進 `launch.ts`（renderer 本來就能 import）。沒有採用，因為 `AGENT_EFFORTS` 這個值必須住在一個 renderer 能在執行期 import 的模組；與其讓 `agents.ts` 反過來依賴 `launch.ts`，不如獨立一個模組。

**4. 模型資料形狀。**
- `AgentModel` 擴充為 `{ id, label, description?, efforts?: AgentEffort[] }`：
  - 沒有 `efforts` 欄位 = 資訊不可用（內建清單、快取檔）。
  - `efforts: []` = 不支援 effort。
  - CLI 回報了未知的等級（例如未來新增的 `minimal`）就直接略過，不讓型別外的值流進來。
- `AgentModelList` 擴充：`pending?: true`、`loginRequired?: true`（Codex 未登入時）。
- `AgentModelSource` 改為 `'builtin' | 'claude-cli' | 'codex-app-server' | 'codex-cache'`，移除 `codex-cli`。

**5. 啟動時的 effort 檢查放在 `service.ts` 的 `launchCommand`。**
先用 `taskModel` 的規則決定實際要跑的模型（含 `DEFAULT_MODELS` 補上的值），再到快取中找這個模型：
- 找得到：用 `clampEffort` 調整後才交給 `buildAgentCommand`。
- 快取還沒好或找不到：照原值送出。
`launch.ts` 只需要讓 `taskModel` 可以被 export 使用，維持 types-only。

**6. Renderer：清單改由上層取得。**
- 新增 `useAgentModels(agentCli)` hook，`AgentModelFields` 改成接收 `models` prop。
- 兩個對話框依「目前的 agent 和模型」算出允許的 effort，並在模型改變時用 `clampEffort` 調整 effort。
- slider 改成接收 `levels`（允許清單或 `null`）和停用時的說明文字；刻度列依等級數動態排列。
- `max` 與 `ultra` 的中文標籤與說明寫在 slider 裡，風格和既有 4 級一致：
  - `max`：最大，最深的推理，適合最困難的問題。
  - `ultra`：委派，最深推理並自動委派子任務，耗時與用量可能明顯增加。

  Spec 原本寫「顯示 CLI 回報的說明」。改用固定中文文字的理由是：Claude 沒有回報各等級的說明，而且其他等級本來就是固定中文，混用英文說明會不一致。見待確認 1。

**7. e2e 不碰真實的 CLI。**
- 假 `claude` 腳本收到 `-p` 時，改成讀 stdin 並回覆固定的 `control_response`（內容取自 fixture）。這樣 e2e 可以驗證 AC-1：選單會出現 fixture 中的模型。
- 新增一個假 `codex`，直接以非 0 結束，讓 Codex 穩定走退回路徑，不再依賴機器上有沒有裝真的 `codex`。

## 預計修改

| 檔案 | 修改內容 | 對應驗收條件 |
|---|---|---|
| `packages/core/src/effort.ts`（新增） | `AgentEffort`、`AGENT_EFFORTS`（6 級）、`allowedEfforts`、`clampEffort` | AC-10～AC-13 |
| `packages/core/src/agents.ts` | 從 `effort.ts` re-export；`AgentModel` 新增 `description?`、`efforts?` | 契約 |
| `packages/core/src/claude-models.ts`（新增） | Claude 握手：用 `execEnv()`、在暫存目錄中執行；送出 `initialize`；只解析 `models`，略過 `default`；逾時（15s）後結束子程序並清掉暫存目錄 | AC-1、AC-5、AC-9、AC-15 |
| `packages/core/src/codex-models.ts`（新增） | app-server 用戶端：`initialize` → `initialized` → `account/read`（只讀登入狀態）→ `model/list` 翻頁；結束子程序 | AC-2、AC-6～AC-9、AC-14、AC-15 |
| `packages/core/src/agent-models.ts` | `createModelCatalog`（`get` / `refresh` / `warm` / 查詢單一模型）；退回順序；移除 `codex debug models` | AC-4～AC-6 |
| `packages/core/src/service.ts` | `CoreOptions.modelCatalog?`；`Core.warmModelCatalog()`；`agents:listModels` 改讀 catalog；`launchCommand` 調整 effort；`updateTask` 補上 effort 驗證 | AC-4、AC-13 |
| `packages/core/src/launch.ts` | export `taskModel`（維持 types-only） | AC-13 |
| `packages/cli/src/host.ts` | `startHost` 在 server 啟動後呼叫 `core.warmModelCatalog()`（不 await） | AC-1、AC-2 |
| `packages/core/src/client.ts`、`renderer/lib/api.ts`、`renderer/lib/types.ts` | 型別擴充；re-export `effort.ts` 的值給 renderer | 契約 |
| `renderer/components/task-effort-slider.tsx` | 支援 6 級、`levels`、停用說明、動態刻度；`DEFAULT_TASK_EFFORT` 的複本保持不變 | AC-10～AC-12 |
| `renderer/components/new-task-dialog.tsx`、`edit-task-dialog.tsx` | `useAgentModels`；`AgentModelFields` 改收 `models`；依模型限制並調整 effort（兩個版面都要改） | AC-1、AC-2、AC-10、AC-11 |
| `renderer/components/settings-dialog.tsx` | 新來源的標籤；兩個 agent 都有「重新整理」；`loginRequired` 時顯示「請執行 `codex login`」 | AC-17 |
| `packages/tui/src/task-form.ts` | `EFFORTS` 改為 6 級；`FormContext.models` 改存 `AgentModel[]`；effort 循環只在允許清單內；切換模型時調整 effort | AC-16 |
| `test/fixtures/agent-models/`（新增） | Claude `control_response`（含 `account`）、Codex `model/list` 兩頁、`account/read` 未登入與已登入（含帳號欄位） | AC-5～AC-9 |
| `test/effort.test.mjs`（新增）、`test/agent-models.test.mjs`、`test/service.test.mjs`、`test/claude.test.mjs`、`test/agents.test.mjs`、`test/tui-task-form.test.mjs`、`test/core-boundary.test.mjs` | 見「驗證計畫」 | AC-4～AC-16 |
| `e2e/web.e2e.mjs` | 假 `claude` 回應握手；新增假 `codex`；驗證選單出現 fixture 中的模型 | AC-1、AC-18 |
| `packages/core/IPC_API_MAP.md`、`test/README.md`、`AGENTS.md` | 更新 handler 說明；新增測試 suite 的列；說明 renderer 可在執行期 import 的模組多了 `effort.ts`，以及模型清單的來源 | 文件 |

## 實作順序

每個階段結束跑該階段的檢查。commit 要等你另外同意。

1. **開 feature branch**（例如 `feature/agent-model-catalog`）。目前在 `main`，這份 spec / plan 也一併放到新 branch。
2. **effort 規則**：`effort.ts`、`agents.ts` re-export、`core-boundary` 允許名單。
   驗證：`npx tsc --noEmit -p tsconfig.json`、`node scripts/run-tests.mjs ./test/effort.test.mjs ./test/agents.test.mjs ./test/core-boundary.test.mjs`。
3. **兩個查詢函式與 fixture**。先實測 Codex `account/read` 的回應形狀：只印出欄位名稱，不印值，用來製作 fixture。
   驗證：tsc，以及 `node scripts/run-tests.mjs ./test/agent-models.test.mjs`。
4. **catalog、service、host**：快取、handler、啟動時的 effort 檢查、`updateTask` 驗證，以及 client 型別。
   驗證：tsc、`npm test`。
5. **檢查所有使用端**：用 grep 找出 `AgentEffort`、`AGENT_EFFORTS`、`AgentModel`、`AgentModelSource`、`codex-cli`、`EFFORTS` 的使用處，逐一確認。
6. **Renderer**：slider、兩個對話框、設定頁。
   驗證：`npx tsc --noEmit -p renderer/tsconfig.json`、`npm test`（含 `ui-consistency`）、`npm run build:web`。
7. **TUI**。
   驗證：tsc，以及 `node scripts/run-tests.mjs ./test/tui-task-form.test.mjs`。
8. **e2e 與文件**。
   驗證：`npm run test:e2e`。
9. **完整 DoD 與手動驗證**（見下方），把結果寫進「實作與驗證紀錄」。

## 風險與依賴

- **Claude 握手是非公開協定**：靠 fixture 和退回機制兜底。實作時以當時安裝的 CLI 版本再跑一次握手，確認 fixture 仍然一致。
- **Claude 握手可能觸發使用者自己的 hooks**（例如 SessionStart）。實測時沒有產生 transcript，但沒有特別檢查 hooks。在暫存目錄執行可以避開專案層級的設定；使用者層級的 hooks 是否會觸發，實作時要確認並記錄。
- **Codex 是否接受 `max` / `ultra`**：設定層不檢查值（連 `bogus` 都收下），要送出實際請求時才會知道。確認需要跑一次真的對話、消耗你的額度，所以手動驗證前會先問你。
- **e2e 的假 `claude` 會在 cwd 寫檔**：握手在暫存目錄執行，結束後刪除，所以不會污染 repo。
- **host 啟動時多兩個子程序**：不 await，也有逾時，不影響啟動時間。如果 CLI 卡住，最多 15 秒後就會被結束。

## 驗證計畫

| 檢查 | 命令或操作 | 對應驗收條件 |
|---|---|---|
| Core typecheck | `npx tsc --noEmit -p tsconfig.json` | 工程品質 |
| Renderer typecheck | `npx tsc --noEmit -p renderer/tsconfig.json` | 工程品質 |
| effort 規則 | `test/effort.test.mjs`：允許清單的三種情況、降級（`xhigh` 到 Opus 4.6 變 `high`、`ultra` 到 Claude 變 `max`）、`[]` 回傳 `undefined` | AC-10～AC-12 |
| 查詢與快取 | `test/agent-models.test.mjs`：兩種協定的順序與翻頁、略過 `default`、略過未知等級、帳號欄位不出現在輸出、各種失敗的退回順序、`get` 不啟動程序（計數）、逾時時子程序被結束、子程序收到的環境變數是使用者原本的 `CODEX_HOME` | AC-4～AC-9、AC-14、AC-15 |
| handler 與啟動 | `test/service.test.mjs`：注入假 catalog；`agents:listModels` 的 `refresh` 與一般讀取；`updateTask` 拒絕未知 effort。`test/claude.test.mjs`：Haiku 不帶 `--effort`、Opus 4.6 的 `xhigh` 變 `high`、`max` / `ultra` 的指令字串 | AC-11～AC-13 |
| TUI | `test/tui-task-form.test.mjs`：模型選項、effort 循環只在允許清單內、切換模型時調整 effort | AC-16 |
| 邊界與 UI 慣例 | `test/core-boundary.test.mjs`、`test/ui-consistency.test.mjs`（`npm test` 會一起跑） | 工程品質 |
| 全部單元測試 | `npm test` | AC-4～AC-16 |
| 建置 | `npm run build:web` | AC-18 |
| e2e | `npm run test:e2e` | AC-1、AC-18 |
| 手動：live Web UI | `npm start -- --store-path <tmp> --no-open --port 47831`，開啟印出的網址（保留 `?token=`）：兩個 agent 的選單、Opus 4.6／Haiku 的 slider、切換時的降級、設定頁的重新整理，然後啟動一張 Claude 卡片，檢查 terminal 的 `--model` / `--effort`。用 `visual-parity` 在三種寬度截圖 | AC-1～AC-3、AC-10、AC-11、AC-17 |
| 手動：實際執行 `max` / `ultra` | 各啟動一張 Claude `max`、Codex `ultra` 的卡片，確認 CLI 接受（**會消耗額度，執行前先問你**） | AC-12 |
| 手動：Codex 未登入 | 用沒有登入資料的 `CODEX_HOME` 啟動 host，設定頁應顯示 `codex login` 提示 | AC-17 |

## 待確認事項

1. **`max` / `ultra` 的說明文字**：採用固定中文（方案第 6 點），而不是顯示 CLI 回報的英文說明。這和 Spec 的字面寫法不同；如果你同意，我會在 Spec 補一筆變更紀錄。
2. **Spec 的變更**：「使用預設 model」的 effort 依據已修正（見 Spec「變更紀錄」），需要你重新確認。
3. **（不阻塞，建議另開卡）Codex 的預設模型 `gpt-5.5` 不在這台機器的 `model/list` 裡**（清單是 `gpt-6-astra` 等 4 個）。卡片沒選模型時，啟動指令會帶 `--model gpt-5.5`，可能因為無法使用而失敗。這是現有的問題，不在本次範圍；之後可以改成以清單的第一個模型當預設。

## 實作與驗證紀錄

2026-10-07，branch `feature/agent-model-catalog`（尚未 commit）。

### 完成內容

- Core：`effort.ts`（6 級與降級規則）、`json-lines-process.ts`（子程序傳輸層，逾時與結束保證）、`claude-models.ts`、`codex-models.ts`、`agent-models.ts`（`createModelCatalog`）；`service.ts` 接上 catalog、啟動時降級 effort、`updateTask` 驗證 effort；`host.ts` 啟動時背景預熱。
- Renderer：`useAgentModels` / `useModelEfforts`、`AgentModelFields` 改收 `models` 並顯示模型說明、slider 依模型顯示可選等級、設定頁兩個 agent 都可重新整理並顯示 `codex login` 提示。
- TUI：`effortOptions` / `fitEffort`，6 級，模型以名稱顯示。
- e2e：假 `claude` 回應握手、假 `codex` 直接失敗，驗證選單與退回。
- 文件：`AGENTS.md`、`test/README.md`、`IPC_API_MAP.md`。

### 與 Plan 的差異

- Codex `account/read` 實測：未登入時 `account` 為 `null`，但 `model/list` 仍會成功並回傳另一份清單。所以登入狀態只能從 `account/read` 判斷（`isCodexSignedIn`），不能靠 `model/list` 是否成功。
- 查詢子程序的共用傳輸層獨立成 `json-lines-process.ts`，而不是寫在兩個查詢檔裡。

### 檢查結果

| 檢查 | 結果 |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | 通過 |
| `npx tsc --noEmit -p renderer/tsconfig.json` | 通過 |
| `npm test` | 397 / 397 通過 |
| `npm run build:web` | 通過 |
| `npm run test:e2e` | 修正後連續 5 次通過（見下方「實作中發現的問題」第 2 點） |
| 真實 CLI 查詢（`fetchClaudeModels` / `fetchCodexModels`） | Claude 0.66 秒 11 個模型、Codex 1.3 秒 4 個；暫存目錄已刪除、無殘留子程序 |
| 手動：live Web UI（真實 CLI，拋棄式 store） | AC-1、AC-2：選單內容正確、無 `default`、顯示模型說明。AC-10：`xhigh` 換 Opus 4.6 變 `high`。AC-11：Haiku 顯示「不適用」。Codex GPT-6-Astra 有 6 級並顯示 `ultra` 成本說明；`ultra` 換回 Claude 變 `max`。AC-17：兩個 agent 都能重新整理；空的 `CODEX_HOME` 顯示 `codex login` 提示 |
| 手動：375px 寬度 | 設定頁無水平溢出；登入提示改為可換行 |

### 實作中發現並已修正的問題

1. 切換 agent 的那一次 render 裡，`useAgentModels` 還拿著前一個 agent 的清單，導致 `ultra` 換回 Claude 時被降成 `xhigh`（應為 `max`）。改成清單記住它屬於哪個 agent，對不上就視為載入中。
2. e2e 斷言只等 Claude 查完，Codex 還在查時就檢查 `error`，偶發失敗（3 次中 1 次）。改成等兩者都查完。

### 未驗證

- **AC-3、AC-12 的實際啟動**：沒有真的啟動卡片讓 CLI 執行 `--model` / `--effort max` / `model_reasoning_effort="ultra"`，因為會消耗使用者的額度。指令字串由 `test/service.test.mjs`、`test/claude.test.mjs` 驗證；CLI 是否接受 `ultra` / `max` 仍待使用者同意後實測。
- Windows：子程序走 cmd.exe，逾時時 `kill` 只會結束 cmd.exe，不保證連帶結束 CLI 本身。沒有 Windows 環境可驗證。
- Claude 握手會不會觸發使用者層級的 hooks：沒有特別檢查。

### 已知限制與後續

- Web UI 的編輯對話框在開啟時就會依模型降級 effort（例如 Opus 4.6 卡片存的 `xhigh` 會顯示成 `high`，按儲存才會寫回）。TUI 只在切換模型時降級。啟動時 core 都會再降級一次，所以實際送出的值一致。
- Codex 的預設模型 `gpt-5.5` 不在 `model/list` 裡（待確認 3）。`model/list` 有 `isDefault` 欄位，可以用來決定預設模型，建議另開卡處理。
- 既有問題：以 `vibeflow shutdown` 關閉 host 時，程序以 exit code 13 結束（`host:shutdown` 沒有讓 `cmdWeb` 等待的 promise 結束）。已另開卡處理。
