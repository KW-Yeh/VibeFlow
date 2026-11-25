# Plan：盤點與自主放行

- 狀態：已確認
- 對應 Spec：[spec.md](./spec.md)
- Spec 確認依據：spec.md 更新日期 2026-11-25；2026-11-25 使用者回覆「都照預設」，六個待確認事項依建議定案。
- 更新日期：2026-11-25
- 確認紀錄：2026-11-25 使用者回覆「Accept, confirm plan」，接受三個待確認事項的建議並確認 plan：盤點採固定 allowlist、可在設定中擴充；實作在 feature branch `feat/autonomous-run`；先上線 Claude 的自動接續，Codex 記為已知限制。

## 現有程式碼調查

| 檔案 | 現有行為、可重用模式與調查依據 |
| --- | --- |
| `packages/core/src/store.ts` | `ColumnId = 'backlog' \| 'in_progress' \| 'done'`，`BoardState = Record<ColumnId, Task[]>`。`STATE_VERSION = 4`。`migrateStore` 依欄位是否存在補值（例如 `if (!store.has('tags'))`），不只看版本號，因為舊版程式可能改寫新版 store 而丟掉欄位。`writeBoard` 會清掉 Done 卡片的標籤。 |
| 22 個檔案 | 依賴三個欄位的形狀：core 的 `dependencies.ts`、`board-order.ts`、`recent-projects.ts`、`github.ts`、`progress.ts`、`continuation.ts`、`service.ts`、`tasks.ts`、`tags.ts`、`store.ts`，CLI 的 `task-command.ts`、`main.ts`，TUI 的 `index.ts`，renderer 的 `kanban-board.tsx`、`board-columns.tsx`、`edit-task-dialog.tsx`、`task-workspace-panel.tsx`、`task-progress.tsx`、`home.tsx`、`lib/types.ts`、`lib/board-moves.ts`、`lib/terminal-fit.ts`。新增欄位屬於契約變更。 |
| `packages/core/src/service.ts` | `vibeflow:startTask` 只接受 Backlog 卡片，會移到 In Progress 並呼叫 `startTaskSession`。`ensureProvisioned` 建立分支與 worktree，失敗時把卡片退回 Backlog 並寫入 `launchError`。`carryOnAfterDone` 是「卡片完成後自動啟動下一張」的現成範例。`continueTask` 會換新 session 並把用量累計到 `Task.usage`。 |
| `packages/core/src/launch.ts` | `buildAgentCommand` 組出啟動指令；`masterSystemPrompt()` 是「依卡片角色附加系統提示」的現成範例。`executorSessionId(task.id, task.runId)` 把 Claude session 綁在 `runId` 上，換 `runId` 就是新 session。 |
| `packages/core/src/agent-print.ts`、`jev-router.ts` | `runAgentPrint` 以 stdin 傳 prompt 執行 headless agent。Jev 用 Claude `-p --permission-mode plan`、Codex `exec`。盤點與報告都可以沿用。 |
| `packages/core/src/progress.ts` | 從 transcript 推出 `activity`（`working`、`waiting`、`unknown`）、todos 與用量。`stop_reason === 'end_turn'` 才算 waiting；其他情況都算 working。 |
| 本機 Claude transcript（`~/.claude/projects/**/*.jsonl`） | **額度上限的訊號已實測確認。** 共找到 55 筆，形狀固定：`type: 'assistant'`、`isApiErrorMessage: true`、`error: 'rate_limit'`、`apiError: 'usage_limit_reached'`、`apiErrorStatus: 429`，以及 `quotaLimits: { status: 'rejected', resetsAt: <epoch 秒>, rateLimitType: 'five_hour' }`。文字是「You've hit your 5-hour limit · resets 3pm (Asia/Taipei)」或「session limit」。`message.model` 是 `<synthetic>`、`stop_reason` 是 `stop_sequence`，所以目前的 reducer 會把它判成 **working**，必須修正。 |
| 本機 Codex rollout（`~/.codex/sessions`） | 找不到任何額度上限的紀錄，格式未知。 |
| `packages/core/src/mailbox.ts`、`inbox.ts` | 送訊息給 agent 的唯一管道。`isBlocked(activity)` 判斷權限對話框；會避開使用者的草稿；Claude 走 inbox hook，Codex 走 bracketed paste。heartbeat 的「繼續」沿用它。 |
| `packages/core/src/tags.ts` | `setTaskTags`、`createTag`、`findTag`（依 id 或名稱，忽略大小寫）。CLI 的 tag 指令直接寫 store，不需要 host；執行中的 host 透過監看 store 檔案得知變更。 |
| `packages/core/src/notifier.ts`、`events.ts` | `bus.emit('state:changed', …)` 會推送到所有前端。排程器可以訂閱同一個事件。 |
| `packages/core/src/artifacts.ts` | 卡片的 Artifacts 目錄。報告不屬於任何卡片，所以另外存放。 |
| `test/` | `service.test.mjs` 用 `createCore` 加假的 `SessionBackend` 測 handler；`test/fixtures/progress/` 固定 transcript 形狀；`tags.test.mjs`、`task-cli.test.mjs`、`master-dependencies.test.mjs` 可以當新測試的範本。 |

## 方案與取捨

**1. 盤點用新欄位 `inventory`，不用 Backlog 加標籤。** spec 已定案為獨立欄位。代價是 22 個檔案要跟著改，好處是拖曳規則、並行計算、TUI 顯示都有明確的欄位可以判斷。用 Backlog 加標籤會讓「只有 Backlog 卡片可以編輯」「Backlog 卡片沒有 worktree」這兩條既有規則出現例外。

**2. 狀態標籤用保留 id，不靠名稱。** 新增 `status-tags.ts`，定義八個 `TagDef`，id 固定為 `status:<key>`（例如 `status:ready`），host 啟動時補齊缺少的。`task status --set` 依 key 或目前的名稱找標籤，設定時移除同組其他狀態標籤。使用者改名或改色不影響程式。

**3. 狀態事件記在放行批次，不從標籤反推。** `setTaskStatus` 是寫入狀態的唯一入口，每次寫入時，如果卡片屬於目前的批次，就附加一筆事件。使用者在 UI 手動改狀態標籤，走 `vibeflow:setTaskTags`，這條路徑也要偵測狀態標籤的變化並記錄事件。

**4. 額度上限用 transcript 偵測，Claude 先做，Codex 先退回探測。** Claude 的訊號已確認，直接在 `progress.ts` 的 reducer 認出 `isApiErrorMessage && error === 'rate_limit'`，產生 `activity: { state: 'waiting', waitingFor: 'quota', resetsAt }`。Codex 的格式未知：第一階段嘗試取得樣本；取不到時，Codex 卡片不會被自動判為「等待額度」。使用者已確認先上線 Claude，Codex 記為已知限制。

**5. heartbeat 是 host 裡的一個排程器，每張卡各自一筆計時。** 新增 `heartbeat.ts`，在 `createCore` 啟動、在 `shutdown` 清除。卡片進入 quota 等待時，把 `{ resetsAt, agent, statusBefore }` 存到 `Task.quotaWait`，在 `resetsAt` 加上 60 秒緩衝時觸發。觸發時用 `runAgentPrint` 跑一次最小探測（Claude `-p --model haiku`，Codex `exec` 用最小 model），通過就清掉 `quotaWait`、恢復原狀態標籤，並經由 mailbox 送出「繼續」。session 已經不在時，用 `resume: true` 重新啟動同一個 `runId`。沒有 `resetsAt` 或探測失敗時，依設定的間隔重試。host 啟動時，從 store 中的 `quotaWait` 重建計時器。

**6. 盤點用 headless，而且權限採固定清單加使用者擴充。** 新增 `inventory.ts`，以 `runAgentPrint` 啟動盤點：

- Claude：`-p --permission-mode acceptEdits --allowedTools <清單>`。清單包含讀取工具、在功能文件目錄寫檔，以及一組常見的驗證指令（`npm ping`、`npm whoami`、`gh auth status`、`git fetch`、專案的 typecheck 與 test）。
- Codex：`exec --sandbox workspace-write`，不開放網路以外的額外權限。
- 清單以外的指令會被拒絕。agent 要把「需要允許指令 X」寫進執行準備，並把狀態設為「待回答」。使用者可以在設定中擴充驗證指令清單。

替代方案是用 `bypassPermissions`。這個方案比較簡單，但 headless、無人看管的盤點加上不受限的 Bash，風險太高，所以不採用（2026-11-25 使用者確認）。

盤點的 prompt 由 `launch.ts` 新增的 `inventorySystemPrompt()` 組出，內容包括：卡片內容、附件、額外 context、既有 spec 與 plan 的路徑，以及「用 feature-spec-plan 產出文件、不做功能實作、依 spec 規定的五個部分寫執行準備、不讀 secret、最後用 `task status --set` 設定狀態」。盤點程序的 stdout 最後一段存成 `Task.inventory.lastSummary`，顯示在盤點區。

**7. 執行階段沿用 `startTask`，改為接受盤點欄的卡片。** 盤點欄的卡片已經有 worktree，啟動時換一個新的 `runId`，也就是新 session。第一則訊息由 `launch.ts` 新增的 `executionBrief()` 組出，指向 spec.md 與 plan.md，並說明授權範圍以執行準備為準、遇到停止條件就設狀態並停止。

**8. 放行排程器只負責數名額和放行。** 新增 `release.ts`。觸發時機有三個：開關切換、`state:changed`、host 啟動。邏輯是：計算 In Progress 中非 master、狀態為「執行中」或「等待額度」的卡片數量，名額有空時，依盤點欄順序放行帶「準備開工」的卡片。這個計算方式符合 spec 的規則：「待你確認」「卡住」「已開 PR」的卡片會讓出名額，手動拖入的卡片也計入。

**9. 報告先由程式產生表格，再由 agent 補寫敘述。** 新增 `report.ts`。關閉開關時，先由程式從批次事件、`Task.usage`、時間戳組出表格版 markdown，寫到 `<storeDir>/reports/<id>.md`；接著用設定的 agent 以 `runAgentPrint` 補寫敘述。補寫失敗或碰到額度上限時，報告標為 `pending`，交給 heartbeat 重試。state 只存索引，寫入新報告後依保留份數刪除最舊的。

**10. 持久化形狀與 migration。** `STATE_VERSION` 升到 5。`migrateStore` 依欄位補值：`board.inventory = []`、`release = { enabled: false }`、`batches = []`、`reports = []`、`settings.autonomous` 使用預設值。新增的卡片欄位 `quotaWait`、`inventory` 是選填欄位，舊卡片不需要補。舊版程式讀到 v5 store 時會忽略未知的欄位，但如果改寫 board，可能會丟掉 `inventory` 欄裡的卡片，這一點記在風險。

## 預計修改

| 檔案 | 修改內容 | 對應驗收條件 |
| --- | --- | --- |
| `packages/core/src/store.ts` | `ColumnId` 加 `'inventory'`；`Task` 加 `quotaWait`、`inventory`（`context`、`attachments`、`lastSummary`、`runningSince`）；`VibeFlowState` 加 `release`、`batches`、`reports`；`AppSettings` 加 `autonomous`；`STATE_VERSION = 5` 與 migration | AC-1、AC-11 |
| `packages/core/src/status-tags.ts`（新增） | 八個保留狀態的定義、`ensureStatusTags`、`setTaskStatus`（互斥、記事件） | AC-4 |
| `packages/core/src/progress.ts` | Claude reducer 認出額度上限，產生 `waitingFor: 'quota'` 與 `resetsAt` | AC-6 |
| `test/fixtures/progress/` | 新增去識別化的額度上限 transcript fixture | AC-6 |
| `packages/core/src/heartbeat.ts`（新增） | 每張卡的計時器、探測、經由 mailbox 送「繼續」、session 不在時 resume、host 啟動時重建 | AC-6、AC-7 |
| `packages/core/src/inventory.ts`（新增） | headless 盤點、權限清單、重新盤點、盤點中碰到額度上限 | AC-1、AC-2、AC-3 |
| `packages/core/src/launch.ts` | `inventorySystemPrompt()`、`executionBrief()`、盤點的 allowlist 參數 | AC-1、AC-5 |
| `packages/core/src/release.ts`（新增） | 放行排程器、名額計算、批次與事件紀錄 | AC-5、AC-8 |
| `packages/core/src/report.ts`（新增） | 表格版報告、agent 補寫、pending 重試、保留份數 | AC-8、AC-9、AC-10 |
| `packages/core/src/service.ts` | handler：`vibeflow:startInventory`、`vibeflow:rerunInventory`、`vibeflow:setInventoryContext`、`vibeflow:setTaskStatus`、`vibeflow:setRelease`、`reports:list`、`reports:read`；`startTask` 接受盤點欄卡片；`setTaskTags` 記錄狀態事件；接上 heartbeat 與 release | AC-1 到 AC-10 |
| `packages/core/src/client.ts`、`packages/core/IPC_API_MAP.md` | 新 handler 的 client 方法與文件 | 工程品質 |
| 其他依賴欄位的 core 檔案（`dependencies.ts`、`board-order.ts`、`recent-projects.ts`、`github.ts`、`continuation.ts`、`tasks.ts`、`tags.ts`） | 處理第四個欄位，確認沒有寫死三個欄位的地方 | AC-11、AC-12 |
| `packages/cli/src/task-command.ts`、`main.ts` | `task status --set`、`task inventory start\|rerun\|context`、`release on\|off\|status`、`report list\|show`；`--status` 接受 `inventory` | AC-2、AC-4、AC-5 |
| `packages/tui/src/index.ts` | 顯示盤點欄，不提供盤點操作 | spec 決策 |
| `renderer/lib/types.ts`、`lib/board-moves.ts`、`lib/api.ts` | 新欄位型別、拖曳規則（Backlog 與盤點互拖、盤點拖進 In Progress）、API wrapper | AC-1、AC-5 |
| renderer 元件（`kanban-board.tsx`、`board-columns.tsx`、`home.tsx` 等，以及新增的盤點區、放行開關、報告頁、設定區） | 先做能用的最小版本，視覺設計交給 Design 後再調整 | AC-1、AC-2、AC-8 |
| `test/*.test.mjs` | 新增 `status-tags`、`heartbeat`、`inventory`、`release`、`report` 測試；`progress.test.mjs`、`service.test.mjs`、`json-store` 或 migration 測試補案例；更新 `test/README.md` | 全部 |
| `AGENTS.md`、`docs/README.md` | 補上新欄位、CLI 指令、狀態標籤與 heartbeat 的說明 | 工程品質 |

## 實作順序

每個階段結束時跑該階段的驗證並 commit。

1. **實測與 fixture。** 把 Claude 額度上限 transcript 去識別化，存成 fixture。嘗試取得 Codex 的額度上限樣本，取不到就記錄為限制。實測 headless 盤點的 Claude `--allowedTools` 與 Codex sandbox：能不能寫功能文件、能不能跑清單內的驗證指令、清單外的指令會不會被拒絕。驗證：fixture 存在，實測結果寫進「實作與驗證紀錄」。
2. **Store 與 migration。** 新欄位、新型別、`STATE_VERSION = 5`，並修改所有依賴欄位的 core、CLI 與 TUI 檔案。驗證：core typecheck、`npm test`，再用一份 v4 store 的複本啟動 host，確認資料保留（AC-11、AC-12）。
3. **狀態標籤。** `status-tags.ts`、`setTaskStatus`、CLI `task status --set`。驗證：新的 `status-tags.test.mjs` 與 `task-cli.test.mjs` 案例（AC-4）。
4. **額度上限偵測與 heartbeat。** reducer 修正、`heartbeat.ts`、接上 mailbox。驗證：`progress.test.mjs` 用 fixture 測偵測；`heartbeat.test.mjs` 用假時鐘與假 backend 測計時、探測、等待使用者時不送訊息、host 重啟後重建（AC-6、AC-7）。
5. **盤點。** `inventory.ts`、`inventorySystemPrompt()`、handler 與 CLI。驗證：`inventory.test.mjs` 用假 agent 測狀態轉換；再在 dev profile 上用真的 Claude 對一個測試 repo 跑一次盤點（AC-1、AC-2、AC-3）。
6. **執行與放行。** `executionBrief()`、`startTask` 接受盤點卡、`release.ts`。驗證：`release.test.mjs` 測名額計算與放行順序；`service.test.mjs` 測盤點卡被放行時換新 session（AC-5、AC-8 前半）。
7. **報告。** `report.ts`、handler 與 CLI。驗證：`report.test.mjs` 測表格內容、pending 重試、保留份數（AC-8、AC-9、AC-10）。
8. **最小 UI。** 盤點欄、拖曳規則、盤點區（顯示摘要與執行準備、貼上與附加 context、重新盤點）、放行開關、報告列表與閱讀、設定區。驗證：renderer typecheck、`npm test`（含 `ui-consistency`）、`npm run build:web`、`npm run test:e2e`，再到 live Web UI 實際操作一次完整流程。
9. **文件。** `AGENTS.md`、`IPC_API_MAP.md`、`test/README.md`、`docs/README.md`。
10. **交給 Design。** 盤點區、放行開關、報告頁、設定區的視覺設計另外處理，不在這個 plan 的完成範圍內。

## 風險與依賴

- **Codex 的額度上限格式未知。** 取不到樣本時，Codex 卡片碰到額度上限不會被自動接續。處理方式：第一階段嘗試取得樣本，取不到就記為已知限制，並在 spec 的實作紀錄標註。
- **Claude transcript 不是公開 API。** `quotaLimits` 欄位可能改名。處理方式：fixture 固定目前的形狀；reducer 同時接受 `quotaLimits.resetsAt` 與 `apiErrorParams.rate_limit_info.resetsAt`，兩者都沒有時退回依間隔探測。
- **headless 盤點的權限清單可能不夠。** 不同專案的驗證指令不一樣。處理方式：清單外的指令讓盤點進入「待回答」，不是靜默失敗；設定中可以擴充清單。
- **新增欄位會改到 22 個檔案。** 處理方式：第二階段集中修改，`npm test` 與 e2e 守住既有行為（AC-12）。
- **舊版程式改寫 v5 store。** 舊版 VibeFlow 的 `writeBoard` 只認得三個欄位，可能丟掉盤點欄的卡片。處理方式：記錄在 release note；這和既有 `recentProjects` 遷移的做法一致，只能降低風險，無法完全避免。
- **自動送「繼續」可能打擾使用者。** 處理方式：一律經過 mailbox 的草稿與權限對話框保護；卡片在等使用者回答時不送。
- **報告用的 agent 本身也會碰到額度上限。** 處理方式：表格版先存，補寫交給 heartbeat 重試。
- **host 沒有執行時，什麼都不會發生。** spec 已經把這點排除在範圍外。

## 驗證計畫

| 檢查 | 命令或操作 | 對應驗收條件 |
| --- | --- | --- |
| Core typecheck | `npx tsc --noEmit -p tsconfig.json` | 工程品質 |
| Renderer typecheck | `npx tsc --noEmit -p renderer/tsconfig.json` | 工程品質 |
| 測試 | `npm test`；開發中用 `node scripts/run-tests.mjs ./test/<file>.test.mjs` | AC-4、AC-6、AC-7、AC-9、AC-10、AC-11、AC-12 |
| Web UI 建置 | `npm run build:web` | 工程品質 |
| E2E | `npm run test:e2e` | AC-1、AC-5、AC-12 |
| Migration | 複製一份 v4 store 到暫存目錄，`npm start -- --store-path <tmp> --no-open --port 47831`，確認看板、標籤、設定都保留 | AC-11 |
| 真實盤點 | dev profile 上建一張需要新增套件的卡，拖進盤點；JFrog token 未設定與已設定各跑一次，搜尋 transcript、文件與 store，確認沒有 token 的值 | AC-1、AC-2、AC-3 |
| 放行流程 | dev profile 上準備三張準備開工的卡，並行上限設 2，打開開關，觀察放行順序；關閉開關，確認報告出現 | AC-5、AC-8 |
| 額度上限 | 用 fixture 驅動 heartbeat 測試；真實額度上限無法按需觸發，只在碰到時觀察並記錄 | AC-6、AC-7 |

## 待確認事項

- 無

## 實作與驗證紀錄

### 階段 1：實測與 fixture（2026-11-25）

- Claude 額度上限 fixture：`test/fixtures/progress/claude-rate-limit.jsonl`，取自本機真實 transcript（Claude Code 2.1.330），去除 cwd、session、request id 與內容。形狀與調查時一致：`isApiErrorMessage: true`、`error: 'rate_limit'`、`quotaLimits.resetsAt` 與 `apiErrorParams.rate_limit_info.resetsAt`（epoch 秒）。另外發現：額度上限那一行之後，Claude 會寫入 `origin.kind: 'task-notification'` 的 user 行（子 agent 也因額度失敗），現有 reducer 會因此把 activity 改回 working，所以額度狀態要撐過非人類的 user 行，直到出現真正 model 的 assistant 回覆或人類訊息。
- Codex：`~/.codex/sessions` 中沒有任何「已碰到」額度上限的紀錄。`event_msg` 的 `token_count` 帶有 `rate_limits.primary/secondary.{used_percent, resets_at}`，但只是用量，不是被拒絕的訊號。結論：Codex 額度上限偵測維持已知限制，不自動判為「等待額度」。
- Claude headless 權限（Claude Code 2.1.332，`claude -p --model haiku`，拋棄式 repo）：
  - `--permission-mode dontAsk` 會拒絕所有未預先允許的工具，不會卡在詢問。`acceptEdits` 會接受 cwd 內任何檔案寫入，不符合「只寫功能文件目錄」，改用 `dontAsk`。
  - 檔案寫入要用 `Edit(./docs/features/**)`；`Write(...)` 規則不會被檔案權限檢查採用（CLI 會印警告）。`Edit(docs/features/**)`（沒有 `./`）沒有放行寫入。
  - 實測：`docs/features/demo/spec.md` 寫入成功；`other.txt` 被拒；`Bash(git status:*)`、`Bash(npm ping:*)` 執行成功；`ls /` 被拒。
- Codex headless 權限（codex-cli 0.170.0）：`codex exec --sandbox workspace-write` 可以寫入功能文件，但沙盒預設沒有網路（`curl` 解析不到 host），資源驗證會全部失敗。加上 `-c sandbox_workspace_write.network_access=true` 後網路可用。Codex 沒有逐指令的 allowlist，限制只到「workspace 內可寫、可上網」；設定中擴充的驗證指令只對 Claude 生效，記為已知限制。

### 階段 2：Store 與 migration（2026-11-25）

- 改動：`ColumnId` 加 `inventory`（`COLUMN_IDS` 依看板順序）；`Task` 加 `quotaWait`、`inventory`、`statusNote`；`VibeFlowState` 加 `release`、`batches`、`reports`；`AppSettings.autonomous` 與 `resolveAutonomousSettings`；`STATE_VERSION = 5`。`status-keys.ts` 放八個狀態 key（無 import，renderer 可用）。
- Migration 依欄位補值：`board.inventory`、`release`、`batches`、`reports`。`settings.autonomous` 不寫入 store，讀取時由 `resolveAutonomousSettings` 補預設值，之後調整預設值也會套用到沒有設定過的 store（與 `notifications` 的做法一致）。`normalizeBoard` 用在所有讀 board 的地方，`writeBoard` 一律寫出四欄。
- 相容：`vibeflow:setBoard` 收到沒有 `inventory` 的 board（舊前端）時，保留目前盤點欄的卡片。TUI 顯示盤點欄，但 H/L 會跳過盤點欄、盤點欄的卡片不能移動（spec：TUI 不提供盤點操作）。renderer 只補型別（看板仍是三欄，盤點 UI 在階段 8）。
- 測試期望值調整（屬於 spec 要求的契約變更，不是消音）：`recent-projects.test.mjs` 的 migration 版本從 `4` 改成 `STATE_VERSION`；`tui.test.mjs` 的欄位索引因新增盤點欄而位移，並新增「跳過盤點欄」案例。
- 驗證：
  - `npx tsc --noEmit -p tsconfig.json`：通過。
  - `npx tsc --noEmit -p renderer/tsconfig.json`：通過。
  - `npm test`：675 個測試全數通過（含新增的 `test/store-migration.test.mjs` 5 個案例）。
  - `npm run build:web`：成功。
  - `npm run test:e2e`：5 個測試全數通過（AC-12 的既有流程）。
  - Runtime：以手寫的 v4 store（一張帶標籤的 Backlog 卡、一張 Done 卡、一個標籤、`autoMode: false` 與自訂 system prompt）在拋棄式 `--store-path` 啟動 host，`task list` 讀得到卡片；store 檔升為 `version: 5`，四欄、標籤、設定都保留，`release`/`batches`/`reports` 為預設值（AC-11）。之後以 `vibeflow shutdown` 停止。

### 階段 3：狀態標籤（2026-11-25）

- 改動：`status-tags.ts`（八個保留狀態、固定 id `status:<key>`、`ensureStatusTags`、`setTaskStatus`、`setTaskTagsWithStatus`、`recordStatusEvent`）；host 啟動時補齊狀態標籤；`vibeflow:setTaskTags` 改走 `setTaskTagsWithStatus`（加上狀態標籤會換掉另一個，並以 `source: 'user'` 記事件）；新 handler `vibeflow:setTaskStatus`；`deleteTag` 拒絕刪除狀態標籤（`RESERVED_TAG`）；CLI `task status --set <key|名稱> [--reason] | --clear`，不需要 host。狀態名稱可用 key 或標籤目前的名稱；使用者已有同名標籤時，狀態標籤改名為「名稱（狀態）」。
- 設計取捨：一般的 `task tag` 不會順便建立狀態標籤，只有 host 啟動與 `task status` 會；這樣既有的標籤清單不會因為一次打標籤而多出八個。
- 驗證：
  - `npx tsc --noEmit -p tsconfig.json`：通過。
  - `node scripts/run-tests.mjs ./test/status-tags.test.mjs ./test/task-cli.test.mjs ./test/tags.test.mjs`：28 個全數通過（AC-4：`--set 卡住 --reason` 換掉原有狀態、未知狀態回 `UNKNOWN_STATUS` 並列出可用狀態且不新增標籤）。
  - `npm test`：684 個全數通過。

### 階段 4：額度上限偵測與 heartbeat（2026-11-25）

- 改動：
  - `progress.ts`：`claudeQuotaLimit` 認出 `isApiErrorMessage` + `error: 'rate_limit'`（或 `apiError: 'usage_limit_reached'`），產生 `activity: { state: 'waiting', waitingFor: 'quota', resetsAt }`；`resetsAt` 先讀 `quotaLimits.resetsAt`，再讀 `apiErrorParams.rate_limit_info.resetsAt`，都沒有就不帶。子 agent（`isSidechain`）的額度上限不算卡片的。等待額度時，非人類的 user 行與 synthetic assistant 行不會把狀態改回 working；人類訊息或真正 model 的回覆才會。
  - `progress-tracker.ts`：等待額度時，Stop hook 不覆蓋它；只有更新的 working hook 會。
  - `mailbox.ts`：等待額度視同閒置（agent 停在提示字元），所以 inbox 的訊息能叫醒它；權限對話框與草稿的保護不變。
  - `heartbeat.ts`（新增）：每張卡一個計時器，時間是 `resetsAt + 60 秒`，沒有重置時間就用「碰到上限的時間 + heartbeat 間隔」；探測失敗把下一次時間存進 `quotaWait.nextProbeAt`，再等一個間隔；同一個 provider 30 秒內共用一次探測。時鐘可注入。
  - `quota-probe.ts`（新增）：Claude `-p --model haiku --no-session-persistence`、Codex `exec --skip-git-repo-check --ephemeral`，在暫存目錄跑一句話的 prompt；失敗或輸出含額度上限字樣都算沒通過。
  - `service.ts`：progress 更新時偵測額度上限，寫入 `Task.quotaWait`（含 `statusBefore`）並把狀態設成「等待額度」（`source: 'host'`）；heartbeat 觸發時，session 還活著且仍在等額度就經 mailbox 送「繼續」，已經在等人（回答或權限）就不送、只結束等待；session 已經不在就以 `resume` 重啟同一個 session 再送「繼續」。結束等待時恢復原本的狀態標籤。host 啟動時依 store 重建計時器。盤點階段的額度等待在階段 5 接上。
- 驗證：
  - `npx tsc --noEmit -p tsconfig.json`：通過。
  - `node scripts/run-tests.mjs ./test/progress.test.mjs ./test/mailbox.test.mjs ./test/progress-tracker.test.mjs`：54 個全數通過（含 3 個新增的額度上限案例，使用階段 1 的 fixture）。
  - `node scripts/run-tests.mjs ./test/heartbeat.test.mjs`：7 個全數通過。包括假時鐘下的計時與重試、不同 provider 各自接續、AC-6（掛上「等待額度」並存有重置時間、探測通過後原 session 收到「繼續」、在等人回答時不送）、AC-7（第一個 host 探測失敗後關閉，第二個 host 依 store 重建計時器、以 `--resume` 重啟並送出「繼續」）。
  - 實際呼叫 `probeAgent('claude')` 一次，回傳 `true`（目前沒有額度上限）。
  - `npm test`：694 個全數通過。
  - 沒有驗證：真實的額度上限無法按需觸發，live 環境的接續要等實際碰到時觀察。

### 階段 5：盤點（2026-11-25）

- 改動：
  - `inventory.ts`（新增）：內建驗證指令清單（git 唯讀指令、`npm ping/whoami/view/config get registry/ls`、專案 typecheck/lint/test、`gh auth status`）、`isSafeInventoryCommand`（設定中擴充的指令只能是一般字詞，不能有 `;`、`|`、`$()`、引號等）、Claude 參數（`-p --permission-mode dontAsk --session-id … --allowedTools Read Glob Grep LS Edit(./docs/features/**) Bash(<指令>:*)… --disallowedTools Read(./.env)…`，Windows 上把含空白或括號的 token 加引號）、Codex 參數（`exec --sandbox workspace-write -c sandbox_workspace_write.network_access=true`）、結果解析。
  - `launch.ts`：`inventoryPrompt()`，要求依 feature-spec-plan 產出文件、執行準備的五個部分與停止條件、不讀不印 secret、清單外指令寫進待決定事項、不能事先授權的操作只能列為停止條件。
  - `service.ts`：`vibeflow:startInventory`（Backlog → 盤點、掛「盤點中」、`ensureProvisioned` 建立 worktree 與分支、背景跑一次 pass）、`vibeflow:rerunInventory`、`vibeflow:setInventoryContext`（context 存在 `Task.inventory.context`，附件寫進 worktree，描述不變）；pass 結束後依結果設「準備開工」或「待回答」，碰到額度上限（讀該 pass 的 transcript，或輸出中的額度上限字樣）就進入 phase 為 `inventory` 的「等待額度」，heartbeat 在重置後重跑盤點；卡片被拖出盤點欄時中止 pass 並清掉盤點相關的狀態標籤，worktree 依 Backlog 卡片的既有規則保留。`TaskSummary` 加上 `status`、`statusReason`、`quotaResetsAt`。
  - `agent-print.ts`：`signal` 選項，可以中止 headless 執行。
  - CLI：`task inventory start|rerun|context --task <id> [--text] [--attach]`（需要 host）。
- 與 plan 的差異：plan 寫的是盤點 agent「最後用 `task status --set` 設定狀態」。實作改成 agent 在最後一行輸出 `VIBEFLOW_INVENTORY_RESULT: ready|needs_answer`，由 VibeFlow 解析後設定狀態。原因：讓 agent 呼叫 VibeFlow CLI 需要在 allowlist 放行 `node …`，等於放行任意程式碼；改由程式設定狀態，allowlist 可以維持只有驗證指令。行為結果與 spec 相同，不影響驗收條件，因此沒有標成待重新確認。
- 驗證：
  - `npx tsc --noEmit -p tsconfig.json`：通過。
  - `node scripts/run-tests.mjs ./test/inventory.test.mjs`：9 個全數通過（參數與 allowlist、危險指令不加入、結果解析、prompt 內容；用假 agent 走過 AC-1 與 AC-2：盤點欄、worktree、spec 與 plan 含執行準備、待回答 → 貼上 context → 重新盤點 → 準備開工且描述不變；盤點碰到額度上限 → 等待額度 → 探測通過後重跑；拖回 Backlog 中止 pass；master 與非 Backlog 卡片被拒、盤點卡不能編輯）。
  - `npm test`：703 個全數通過。
  - 真實盤點（拋棄式 `--store-path`，不是 dev profile：依交辦規則不使用真實 store）：測試 repo 的 `.npmrc` 指向一個不存在 token 的 JFrog registry，卡片用 Claude haiku、effort low。`task inventory start` 後約 60 秒結束，worktree 中只多出 `docs/features/lodash-dependency/spec.md` 與 `plan.md`，plan.md 有完整的執行準備；`npm config get registry` 通過、`npm whoami` 回 ENEEDAUTH 記為失敗，盤點區摘要列出「JFrog auth token：缺少」，卡片掛「待回答」（AC-1、AC-3 的未設定半段）。agent 嘗試一次 `cat .npmrc` 被 `dontAsk` 拒絕，沒有重試；store 中搜尋不到 `_authToken` 或 npm token 形狀的字串。之後以 `vibeflow shutdown` 停止 host。
  - 沒有驗證：AC-3 的「設定 token 後重新盤點通過」需要真實的 JFrog token，這個環境沒有，未驗證；真實環境的重新盤點只用假 agent 測過。

### 階段 6：執行與放行（2026-11-25）

- 改動：
  - `launch.ts`：`executionBrief()`，第一則訊息指向 spec.md 與 plan.md、說明「執行準備」就是授權範圍、不能事先授權的操作要停下來，並教 agent 用 `task status --set needs_review|stuck|pr_opened --reason` 回報。
  - `service.ts`：`startTask` 接受盤點欄的卡片（換新的 `runId` = 新 session；盤點中的卡片拒絕 `INVENTORY_RUNNING`）。盤點完成的卡片第一次啟動時，不論是被放行、`task start` 還是手動拖曳後的 `pty:start`，`launchCommand` 都改用執行簡報並記下 `inventory.handedOffAt`，之後的重啟不會再收到簡報；卡片狀態設為「執行中」。
  - `release.ts`（新增）：`occupiedSlots`（In Progress 中非 master、狀態不是「待你確認／卡住／已開 PR」的卡片都佔名額，手動拖入與等待額度的也算）、`readyCards`、`releaseCandidates`。
  - 放行排程：`vibeflow:setRelease` 開啟時建立批次並放行；`state:changed`、`setBoard`、`cleanupTask` 與 host 啟動時各觸發一次（以 microtask 延後，避免在 core 還沒建好時啟動卡片）；同時只有一輪在跑，期間的觸發合併成再跑一輪。放行時先把卡片與標題記進批次，狀態事件因此會寫進批次；啟動失敗的卡片掛「卡住」並附原因。關閉時記錄 `endedAt`，交給報告（階段 7）。
  - CLI：`vibeflow release on|off|status`（on/off 需要 host，status 直接讀 store）。
- 驗證：
  - `npx tsc --noEmit -p tsconfig.json`：通過。
  - `node scripts/run-tests.mjs ./test/release.test.mjs`：6 個全數通過（名額計算、依盤點欄順序放行；AC-5：並行上限 2 時三張準備開工的卡前兩張以新 session 與執行簡報啟動，一張改成「已開 PR」後第三張被放行，批次記錄卡片、標題與狀態事件；關閉開關後不再放行、執行中的卡不受影響、批次有結束時間；開關開著時 host 重啟會繼續放行；手動啟動也拿到執行簡報且只拿一次）。
  - `npm test`：709 個全數通過（含既有的 `continueTask` 與 Backlog 啟動測試，AC-12）。

### 階段 7：報告（2026-11-25）

- 改動：
  - `report.ts`（新增）：`reportRows` 從批次事件取每張卡的最後狀態與原因（Done 卡的標籤已清掉，所以不看標籤），用量取 `Task.usage`（In Progress 的卡加上目前這一輪），耗時是第一筆到最後一筆事件、還沒結束的算到批次結束，PR 取 `outcome.pr`，否則取「已開 PR」事件原因裡的網址；`reportTable` 產生 markdown 表格與狀態時間軸；`narrativePrompt` 只給 agent 表格；`createReporter` 先寫表格版（狀態 `pending`、內文標「待補寫」），再請 agent 補敘述，成功改成 `complete`，失敗或輸出含額度上限字樣就依 heartbeat 間隔重試；寫入新報告後依保留份數刪除最舊的報告檔與索引，已結束且報告已刪除的批次一併移除；host 啟動時重新排程待補寫的報告。
  - `service.ts`：關閉放行開關時呼叫 reporter；報告用設定的 agent、model、effort（預設 Claude haiku、low），Claude 以 `-p --permission-mode dontAsk --no-session-persistence` 在暫存目錄執行，不能用任何工具；handler `reports:list`、`reports:read`（只接受報告 id 形狀的字串）。
  - CLI：`vibeflow report list`、`vibeflow report show --report <id>`（直接讀 store，不需要 host）。
- 修正：寫測試時發現 `reportRows` 與時間格式用 truthy 判斷，時間戳為 0 時會被當成沒有值，改成判斷 `undefined`；已刪除的卡不再標成「進行中」。
- 驗證：
  - `npx tsc --noEmit -p tsconfig.json`：通過。
  - `node scripts/run-tests.mjs ./test/report.test.mjs`：5 個全數通過（AC-8：表格含 Done 卡的狀態、原因、用量、耗時、PR 與時間軸，進行中的卡標「進行中」；AC-9：agent 失敗時保留表格並標待補寫，假時鐘推進後補上敘述；AC-10：保留 3 份時第 4 份刪除最舊的檔案與索引；host 重啟後補寫待補寫報告；經 host 打開再關閉開關後，`reports:list`／`reports:read` 讀得到報告，`vibeflow report show` 輸出同一份）。
  - `npm test`：714 個全數通過。

### 階段 8：最小 UI（2026-11-25）

- 改動：
  - 看板四欄（Backlog、盤點、In Progress、Done）。`board-moves.ts`：Backlog → 盤點（`startInventory`，在 host 上 headless 執行）、盤點 → Backlog（寫 board，core 中止 pass 並清掉盤點狀態）、盤點 → In Progress（`startTask`，由 host 組執行簡報）；其他移動規則不變。卡片在盤點欄與 In Progress 顯示狀態原因，等待額度時顯示重置時間。
  - `autonomous.tsx`（新增）：盤點面板（狀態與原因、盤點摘要、plan.md 全文、spec.md 摺疊、補充 context 文字框、附加檔案、「儲存並重新盤點」「開始執行」；盤點卡點開就是這個面板，不是編輯對話框）、看板頂列的放行開關（顯示「佔用名額／並行上限 · 準備開工數」）與「報告」按鈕、報告對話框（列表與 markdown 閱讀）、設定頁的「盤點與放行」區塊（並行上限、探測間隔、報告保留份數、報告 agent／model／effort、盤點額外指令）。
  - core：`vibeflow:readInventoryDocs`（只讀這張卡自己的 pass 記錄的文件，且必須在 worktree 內）。
  - renderer 的進度文字認得「等待額度」。`status-keys.ts` 加進 `core-boundary` 的 renderer-safe 清單（它沒有任何 import），renderer 透過 `lib/status.ts` 使用。
- 驗證：
  - `npx tsc --noEmit -p tsconfig.json`、`npx tsc --noEmit -p renderer/tsconfig.json`：通過。
  - `npm test`：715 個全數通過（含 `ui-consistency`、`core-boundary`、新增的拖曳規則案例）。
  - `npm run build:web`：成功。
  - `npm run test:e2e`：5 個全數通過。
  - Live Web UI（拋棄式 `--store-path`，port 47833，內建瀏覽器）：看板顯示四欄，盤點卡帶「待回答」標籤與原因；點開盤點面板，摘要與 `docs/features/lodash-dependency/plan.md` 全文都有顯示；在補充 context 輸入回答後按「儲存並重新盤點」，卡片轉為「盤點中」，真的 Claude 跑完第二次後仍為「待回答」（JFrog token 依然缺），store 中描述未變、context 已存、`passes` 為 2；以 DragEvent 把 Backlog 卡拖到盤點欄，卡片進入盤點欄並開始真實盤點，結束後為「待回答」；放行開關開 → 關，產生一份 0 張卡的報告，真的 haiku 補上敘述，報告對話框可以列出並閱讀；設定頁把並行上限改成 3 並儲存，store 中 `settings.autonomous.concurrency` 為 3。結束後以 `vibeflow shutdown` 停止 host，tmux 中沒有測試卡的 session。
  - 沒有在 live UI 驗證：從 UI 按「開始執行」或放行真的啟動執行（會開真實的互動 agent session）；這條路徑由 `release.test.mjs` 與 `service` 層測試覆蓋。視覺設計（窄螢幕時頂列擁擠等）屬於階段 10，不在這次範圍。

### 階段 9：文件（2026-11-25）

- 改動：`AGENTS.md`（新增「Inventory, status tags, release and reports」一節、v5 store 與 `COLUMN_IDS`／`normalizeBoard` 的慣例、`--status inventory`、新檔案的結構說明、`release`／`report` 指令）、`packages/core/IPC_API_MAP.md`（新 handler 與 `startTask`、`setTaskTags` 的新行為）、`test/README.md`（6 個新測試檔與既有測試的新範圍）、`docs/README.md`（autonomous-run 索引）。
- 驗證（最終狀態，整個 DoD）：
  - `npx tsc --noEmit -p tsconfig.json`：通過。
  - `npx tsc --noEmit -p renderer/tsconfig.json`：通過。
  - `npm test`：715 個全數通過。
  - `npm run build:web`：成功。
  - `npm run test:e2e`：5 個全數通過。
  - `vibeflow --help` 列出 `release` 與 `report`。
- 整體沒有驗證的部分：AC-3 設定 JFrog token 後重新盤點通過（沒有真實 token）；真實的額度上限接續（無法按需觸發，只以 fixture 與假時鐘測過）；Codex 額度上限偵測（已知限制）；live UI 中真的啟動執行階段的 agent session；`npm run build:npm` 與打包後的 `vibeflow doctor`（這次沒有打包）。

### 追加：欄位名稱改為繁體中文（2026-11-25，使用者要求）

- 使用者在實作中途要求：因為「盤點」是繁體中文，其他欄位名稱也改用繁體中文，類似情況一律用繁體中文呈現。
- 改動：新增 `column-labels.ts`（待辦、盤點、進行中、已完成；沒有 import，列入 renderer-safe 清單），看板欄名、卡片狀態點、編輯與 Done 詳情的標題、工作區 rail、TUI、報告表格、退回／移回對話框、錯誤訊息（含 `目前在<欄名>`）、通知 master 的訊息、`vibeflow status` 的看板摘要都改用它。資料、CLI JSON 與旗標中的欄位 id 維持英文；Jira 看板的欄名是 Jira 的資料，不改。報告中未結束的卡仍標「進行中」（spec 規定）。
- 測試期望值隨需求改為新用詞：`test/inventory.test.mjs`、`master-cards.test.mjs`、`notifier.test.mjs`、`report.test.mjs`、`service.test.mjs`、`e2e/web.e2e.mjs`（欄位標題、退回／移回按鈕、Done 詳情標題）。
- 驗證：`npx tsc --noEmit -p tsconfig.json`、`npx tsc --noEmit -p renderer/tsconfig.json` 通過；`npm test` 715 個全數通過；`npm run build:web` 成功；`npm run test:e2e` 5 個全數通過。
- 未處理（建議另行決定）：畫面上其他英文詞，例如 Auto Mode、Master、Artifacts、session、Git diff 分頁名。這些不是欄位或狀態名稱，範圍較大，沒有在這次一起改。
