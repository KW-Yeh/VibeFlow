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
