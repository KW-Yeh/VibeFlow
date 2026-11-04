# Plan：Jev 路由成效優化

- 狀態：已確認
- 對應 Spec：[spec.md](./spec.md)
- Spec 確認依據：spec.md 2026-11-04 版，使用者於 2026-11-04 確認整份 Spec（拆卡、只做手動升級、機械產生交接摘要、CLI＋執行紀錄清單；項目 5 門檻 ≥15K、舊卡不回補、plan 確認後不主動提示）
- 更新日期：2026-11-04
- 確認紀錄：2026-11-04 使用者確認 Plan（含 `task stats` 預設輸出 JSON、`--table` 印表格），並授權依計畫實作本卡（項目 2）與建立四張子卡；每完成一步可 commit，不 push（推送與開 PR 另行確認）

> 範圍：本卡（`feature/jev-routing-efficiency`）實作**項目 2**。項目 1、項目 3＋交接重開、項目 4、項目 5 各開子卡，實作時回到本檔補細節（下方「子卡」只定邊界與順序）。

## 現有程式碼調查

| 檔案 | 現有行為、可重用模式與調查依據 |
| --- | --- |
| `packages/core/src/store.ts` | `Task.usage?: TokenUsage` 是跨 run 累計；`Task.runId` 只在「重新開始」時由 `randomUUID()` 賦值，**第一個 run 沒有 `runId`**；`Task.launchedAt` 在卡片進 In Progress 時蓋章。`migrateStore` 以欄位存在與否判斷（`recentProjects` 的做法），`STATE_VERSION = 4`。本機真實 store 另有 `executionModel`、`pipeline`、`roleId` 等已不讀的舊欄位仍保留，證明未知 Task 欄位會被原樣帶過。 |
| `packages/core/src/progress.ts` | `TokenUsage`、`normalizeUsage`（不可信資料的收斂做法）、`reduceClaudeLine`（`usageById` 以 assistant message id 去重，key 數即呼叫次數）、`reduceCodexLine`（`token_count` 的 `total_token_usage` 是累計；`session_meta.payload.id` 目前沒讀）。檔頭註明只讀少數欄位、格式由 `test/fixtures/progress/` 固定。 |
| `packages/core/src/progress-tracker.ts` | `compose()` 把一個 run 的所有 transcript（含同 worktree 的其他 session、subagents）加總成 `runUsage`，`totalUsage = priorUsage + runUsage`。`entry.claude` 的 key 是檔案路徑（檔名即 session id，subagents 在 `<session>/subagents/`）；`entry.codex` 的 key 是 rollout 路徑。 |
| `packages/core/src/service.ts` | `usageThroughCurrentRun(task)`（約 404 行）是 run 結束時唯一讀最後用量的地方，三個呼叫點：`vibeflow:resetTaskRun` 的 master 分支與一般分支、`vibeflow:cleanupTask`；寫入同一個 `updateTask` 時一併設 `jevRoute: undefined`，所以**在該呼叫之前 `jevRoute` 都還在**。`launchChoice(task)`（約 674 行）已能算出卡片實際使用的 model／effort（含 Jev 選的、已 clamp）。`vibeflow:startTask` 與 board 搬移只蓋 `launchedAt`，不換 `runId`。 |
| `packages/core/src/launch.ts` | `executorSessionId(taskId, runId)` 決定 Claude executor session id；`runId` 缺省時由 taskId 推得。 |
| `packages/core/src/jev-router.ts` | `JevRoute` 已含 `complexity`、`model`、`effort`、`scoutModel`；effort-only 路由沒有 `complexity`。 |
| `packages/cli/src/task-command.ts` | 所有 `task` 子指令都寫一個 `{ ok: true, … }` JSON 到 stdout；`create`／`update`／`artifact` 直接讀寫 store（`setPlatform` 後 `getStore()`），`start`／`list`／`show`／`send` 經 host。`SUBCOMMANDS`、`TASK_USAGE`、`parseArgs` 的 options 是三處要一起改的地方。 |
| `renderer/components/task-progress.tsx` | `TaskProgressDetail` 顯示待辦與 `UsageTable`（已含「目前 context」）；`usageTotal`／`formatTokens` 可重用。`task-workspace-panel.tsx:615` 是唯一使用處，傳入 `task.usage`。 |
| `renderer/lib/effort.ts`、`test/core-boundary.test.mjs` | renderer 以 `export * from '../../packages/core/src/…'` 重新匯出純模組；可在 renderer bundle 的 core 模組列在 `RENDERER_SAFE`，只允許 `import type`。 |
| `test/progress.test.mjs`、`test/progress-tracker.test.mjs`、`test/service.test.mjs`、`test/task-cli.test.mjs`、`e2e/web.e2e.mjs` | 既有測試落點。tracker 測試用暫存 home 放 fixture transcript；service 測試用 `createCore` 加 fake session backend 與 `homeDir`；e2e 用 fake claude（不寫 transcript）與私有 HOME。 |

## 方案與取捨

**run 紀錄在 run 結束時一次算出，不在啟動時另存。** run 結束的三個點（重新開始、完成，以及之後的交接）都已經是「先讀最後用量、再清 `jevRoute`」的順序，所以把 `usageThroughCurrentRun` 擴充成 `finishRun(task, endedBy)`，一次回傳要寫入的 `{ usage, runs }`。替代方案「啟動時先把 model／effort／session 存進 Task」會多一組要同步的暫存欄位，且 host 在 run 中途當掉時留下半筆資料；不採用。

**Run 的身分是 `(runId ?? '', startedAt)`，同一個 key 再寫入是取代、不是新增。** 看板只有從 Backlog 按「開始」才重蓋 `launchedAt`（`kanban-board.tsx` 的 `startTask`、TUI 同理），Done 拉回 In Progress（`moveTask`）既不換 `runId` 也不改 `launchedAt`，所以重開後 tracker 會以同一個 `since` 讀到整個 run 的 transcript（舊檔仍在 `~/.claude/projects`）。取代才不會把同一批 transcript 記兩次；`startedAt` 取 `Task.launchedAt`。沒有 `launchedAt`，或沒有任何 transcript（`runCalls === 0`）時不寫紀錄。

**`usage` 存 run 自己的 `runUsage`，不是 `totalUsage`。** `Task.usage` 維持累計不動（看板與既有測試依賴它）；`runs[].usage` 是可分組的明細。對有 `runs` 的新卡，兩者的關係是 `Task.usage ≥ Σ runs[].usage`，差額是舊資料，不另設不變式。

**`calls` 與 `sessionIds` 由 tracker 提供。** `TaskProgress` 新增 `runCalls`、`runSessionIds`（additive）。Claude：`calls` = 各 transcript（含 subagents）`usageById` 的 key 數；session id = 非 subagents 檔案的檔名。Codex：`CodexState` 新增 `sessionId`（`session_meta.payload.id`）與 `calls`（`total_token_usage` 的總量比上一筆大才 +1，避免重複事件）。

**模型來源與複雜度取自結束當下的卡片。** `model` = `launchChoice(task).model`；`modelSource` = 卡片有 `model` → `card`；否則 `jevRoute.model` → `jev`；否則 `cli`（`model` 缺省）。`effort` 同樣取 `launchChoice`。`complexity`／`scoutModel` 取自尚未清除的 `jevRoute`。

**新模組皆為純函式、無 import（除 type）。**
- `packages/core/src/run-records.ts`：`RunRecord` 型別、`normalizeRuns(value)`（逐筆驗證、丟棄壞資料，沿用 `normalizeUsage` 的做法）、`upsertRun(runs, record)`、`runKey`。列入 `RENDERER_SAFE`，renderer 用同一份 normalize。
- `packages/core/src/routing-stats.ts`：`routingStats(board)` 依 `複雜度 × 模型 × effort` 分組，回傳 run 數、卡片數、tokens／calls／平均 context 的中位數（偶數筆取兩中間值平均、四捨五入）與重開率；另回傳略過的舊卡數。master 卡納入統計（同樣有 run）。

**CLI `task stats` 沿用「所有 task 子指令輸出 JSON」的慣例。** Spec 寫的 `[--json]` 在此調整為：預設輸出 `{ ok: true, groups, runs, cardsWithoutRuns }`（與其他子指令一致，master／agent 可直接解析）；加 `--table` 才印人看的表格。它直接讀 store，不需要 host（與 `create`／`update` 同路），`--store-path`／`--profile` 照舊。這是對 spec 措辭的小幅修正，不改行為。

**Migration（見下節）不重寫資料。**

## Migration（Task 形狀變更）

| 項目 | 做法 |
| --- | --- |
| 新欄位 | `Task.runs?: RunRecord[]`（選填）。`AppSettings.contextWarnTokens` 屬於項目 3 子卡，不在本卡。 |
| 既有 store | 不重寫、不回補、**不調整 `STATE_VERSION`**。欄位缺省即「沒有紀錄」；沿用 `recentProjects` 的做法，以欄位存在與否為準，而不是以版本號。 |
| 讀取 | 所有讀取點（`finishRun`、`routingStats`、renderer 清單）一律經 `normalizeRuns`：非陣列、缺欄位、型別錯誤的項目被丟棄，不拋例外。 |
| 舊卡顯示與完成 | 無 `runs` 的卡：看板、用量表、完成、重開都與現在相同；`Task.usage` 不動。之後新結束的 run 才開始累積紀錄。 |
| 統計 | 沒有 `runs` 的卡略過並計入 `cardsWithoutRuns`。 |
| 降版相容 | 舊版 binary 不認得 `runs`，但 Task 欄位會被原樣帶過（真實 store 中的 `executionModel`、`pipeline` 等已廢欄位即為證）；`setBoard` 以 `...current` 保留未知欄位。 |
| 驗證 | `test/service.test.mjs` 以不含 `runs` 的舊形狀 store 跑重新開始與完成；`test/run-records.test.mjs` 餵壞資料。 |

## 預計修改（本卡：項目 2）

| 檔案 | 修改內容 | 對應驗收條件 |
| --- | --- | --- |
| `packages/core/src/progress.ts` | `CodexState` 加 `sessionId`、`calls`；`reduceCodexLine` 讀 `session_meta.payload.id`、依總量增加計數；新增 `claudeCalls(state)`；檔頭註明新增讀取的欄位 | AC-3、AC-5 |
| `packages/core/src/progress-tracker.ts` | `TaskProgress` 加 `runCalls`、`runSessionIds`；`compose()` 計算並輸出；`sameTarget` 不變 | AC-3、AC-5 |
| `packages/core/src/run-records.ts`（新增） | `RunRecord`、`normalizeRuns`、`upsertRun`、`runKey` | AC-3、AC-4、AC-6 |
| `packages/core/src/routing-stats.ts`（新增） | `routingStats(board)` 與中位數工具 | AC-7 |
| `packages/core/src/store.ts` | `Task.runs?: RunRecord[]`（type import） | AC-3、AC-6 |
| `packages/core/src/service.ts` | `usageThroughCurrentRun` → `finishRun(task, endedBy)`；`resetTaskRun`（master／一般兩分支）寫 `endedBy: restart`，`cleanupTask` 寫 `completed`；未佈署卡不寫 | AC-3、AC-4、AC-6 |
| `packages/cli/src/task-command.ts` | `stats` 子指令（`--table`、`--store-path`、`--profile`）、`TASK_USAGE`、`SUBCOMMANDS`、`parseArgs` options | AC-7 |
| `renderer/lib/types.ts`、`renderer/lib/run-records.ts`（新增） | 重新匯出 `RunRecord` 型別與 `normalizeRuns` | AC-8 |
| `renderer/components/task-progress.tsx`、`renderer/components/task-workspace-panel.tsx` | `TaskProgressDetail` 新增「執行紀錄」清單（第幾輪、模型、effort、複雜度、呼叫數、tokens、結束原因）；無紀錄不顯示；進行中的當前 run 以進度即時值標示 | AC-8 |
| `test/core-boundary.test.mjs` | `RENDERER_SAFE` 加入 `run-records.ts` | 工程品質 |
| `test/progress.test.mjs`、`test/progress-tracker.test.mjs`、`test/fixtures/progress/` | 新讀欄位的斷言；必要時補 Codex fixture 的 `session_meta.id`（現為占位字串 `ROLLOUT`）與重複 `token_count` 案例 | AC-5 |
| `test/run-records.test.mjs`、`test/routing-stats.test.mjs`（新增） | normalize 壞資料；upsert 冪等；分組、中位數（奇／偶筆）、重開率、略過舊卡數 | AC-6、AC-7 |
| `test/service.test.mjs`、`test/task-cli.test.mjs` | 重新開始與完成產生紀錄、模型來源三種、舊形狀 store、重複完成不重複；`task stats` 的 JSON 與 `--table` | AC-3、AC-4、AC-6、AC-7 |
| `e2e/web.e2e.mjs` | 於私有 HOME 放一份 Claude transcript fixture，重新開始後斷言面板出現「執行紀錄」 | AC-8 |
| `AGENTS.md`、`packages/core/IPC_API_MAP.md`、`test/README.md` | Task 形狀與 `task stats`；`progress:update`／`progress:get` 的 `runCalls`／`runSessionIds`；新測試檔 | AC-13 |

**契約檢查（動到共用型別，須檢查所有使用端）：** `TaskProgress` 的使用處為 `progress.ts`、`progress-tracker.ts`、`client.ts`、`service.ts`、`packages/tui/src/index.ts`、`renderer/lib/api.ts`、`renderer/lib/types.ts`、`renderer/pages/home.tsx`、`kanban-board.tsx`、`board-columns.tsx`、`task-workspace-panel.tsx`、`workspace-task-rail.tsx`、`task-progress.tsx`；新增欄位為必填，以兩份 `tsc` 找出建構點（預期只有 `compose()` 與測試）。`Task` 新增選填欄位，不影響既有使用端。

## 實作順序（本卡）

每步一個 commit（使用者已授權依項逐步 commit；不 push），完成前先跑該步驗證。

1. **tracker 讀欄位**：`progress.ts` 與 `progress-tracker.ts` 加 `sessionId`／`calls`／`runCalls`／`runSessionIds`，補 fixture 與測試。驗證：`node scripts/run-tests.mjs ./test/progress.test.mjs ./test/progress-tracker.test.mjs`、core `tsc`（會一併暴露其他 `TaskProgress` 建構點）。
2. **資料模型與統計**：`run-records.ts`、`routing-stats.ts`、`Task.runs`、新測試。驗證：兩個新測試檔、core `tsc`。
3. **service 寫入**：`finishRun`，接上 `resetTaskRun` 與 `cleanupTask`，補 service 測試（含舊形狀 store、完成→拉回→再完成只有一筆）。驗證：`test/service.test.mjs`、`npm test`。
4. **CLI**：`task stats`。驗證：`test/task-cli.test.mjs`；實跑 `npm run vibeflow -- task stats --store-path <tmp>`。
5. **Web UI**：執行紀錄清單、`RENDERER_SAFE`。驗證：兩份 `tsc`、`npm test`（含 `ui-consistency`、`core-boundary`）、`npm run build:web`。
6. **e2e 與文件**：e2e 斷言、`AGENTS.md`／`IPC_API_MAP.md`／`test/README.md`。驗證：`npm run test:e2e`。
7. **整體 DoD 與 Web UI 實測**：見驗證計畫；結果寫入文末紀錄。
8. **驗收**：另開一張驗收卡（獨立 session，只執行驗收項目、不改程式碼），回報結果後才關閉本卡的驗收項。

## 子卡（本卡不實作；各自開工前回到本檔補細節並重新確認）

| 順序 | 子卡 | 範圍 | 主要檔案 | 依賴 | 對應 AC |
| --- | --- | --- | --- | --- | --- |
| 2 | 項目 1：表單預設與提示 | Web／TUI 「未指定」文案依 Jev 金鑰；最高層級提示；`--model` 說明；三處預設一致的測試。層級判斷抽到 renderer 可用的純模組 | `renderer/components/task-form-layout.tsx`、`packages/tui/src/task-form.ts`、`packages/cli/src/task-command.ts`、`packages/core/src/effort.ts` 或新純模組、`test/tui-task-form.test.mjs`、`test/tasks-create.test.mjs` | 無 | AC-1、AC-2 |
| 3 | 項目 3＋交接重開 | 看板 context 顯示、`contextWarnTokens` 設定與舊 store 預設、交接重開（新 `runId`＋新 session、保留 worktree、機械摘要、同模型／升一層）、`task handoff` CLI | `service.ts`（新 handler，與 `resetTaskRun` 並列）、`launch.ts`（摘要段落）、`store.ts`（`AppSettings`）、`settings-dialog.tsx`、`board-columns.tsx`、`task-workspace-panel.tsx`、`task-command.ts`、`client.ts`、`renderer/lib/api.ts` | 項目 2（`finishRun` 的 `handoff`） | AC-9、AC-10 |
| 4 | 項目 4：依階段選模型 | 已確認 `plan.md` 偵測（沿用 `specs.ts` 只讀標頭）、Jev 候選去掉最高層、「升一層」規則；不做自動建議 | `jev-router.ts`、`specs.ts`、`service.ts`、`test/jev-router.test.mjs` | 子卡 3（升一層重用其 handler） | AC-11 |
| 5 | 項目 5：量測起手成本 | 量測腳本與數字寫回本檔；≥15K 才實作（預設關閉的設定） | 量測用暫存腳本；視結論決定 `launch.ts` | 無 | AC-12 |

子卡由本卡完成後以 `vibeflow task create`（Backlog、不啟動）建立，各卡 prompt 指向本 spec／plan 的對應段落。

## 風險與依賴

- **Codex `calls` 是近似值**：`token_count` 事件可能重複或缺漏；以「總量增加才計」降低重複，spec 已註明近似。
- **Done 卡拉回再完成**：`runKey` 不變，run 紀錄被取代為「整個 run 的用量」，不會重複。但 `Task.usage`（既有行為）在這個情境下可能把舊 transcript 再加一次——這是本卡之前就存在的問題，不在範圍內；測試會釘住 run 紀錄只有一筆，並在實作紀錄中回報 `Task.usage` 的實際表現。
- **scout 的 session 併入同一 run**：沿用 jev-routing 既有決定，`sessionIds` 會多一個、`calls` 含 scout 的呼叫；統計時不拆分。
- **`TaskProgress` 為必填欄位新增**：若漏改建構點，由 `tsc` 擋下，不靠肉眼。
- **tokens ≠ 成本**：統計一律帶模型維度，之後才能套單價；本卡不做換算。
- **真實 store 不可碰**：開發與驗證一律用 `--store-path <tmp>`；本機真實 store 只做過唯讀的計數查詢，沒有寫入。
- **e2e 的 transcript fixture**：host 以 `HOME` 找 `~/.claude/projects/<cwd>`，e2e 已用私有 HOME；若 macOS 路徑經 symlink 解析不同，沿用 tracker 的 `pathAliases` 行為，測試以實際 worktree 路徑計算目錄名。

## 驗證計畫

| 檢查 | 命令或操作 | 對應驗收條件 |
| --- | --- | --- |
| Core typecheck | `npx tsc --noEmit -p tsconfig.json` | 工程品質 |
| Renderer typecheck | `npx tsc --noEmit -p renderer/tsconfig.json`（有 phantom 重複型別錯誤時先 `rm -rf renderer/.next`） | 工程品質 |
| 單元／整合測試 | `npm test`；迭代時 `node scripts/run-tests.mjs ./test/<file>.test.mjs` | AC-3～AC-7 |
| Web UI build | `npm run build:web`（受限環境加 `-- --webpack`） | AC-8 |
| E2E | `npm run test:e2e`（需先 build:web） | AC-8、AC-13 |
| CLI 實跑 | 在暫存 store 以測試建出含 `runs` 的卡，`npm run vibeflow -- task stats --store-path <tmp>` 與 `--table`；確認舊卡被略過並回報數量 | AC-7 |
| Live Web UI | `npm start -- --store-path <tmp> --no-open --port 47831`，私有 HOME 放 fixture transcript；建卡→啟動→重新開始→工作區面板看到「執行紀錄」；再完成一張卡看第二筆；截圖留存 | AC-3、AC-4、AC-8 |
| 舊形狀 store | 暫存 store 手寫不含 `runs` 的卡（含 `usage`），開面板、重新開始、完成，確認無錯誤且用量表不變 | AC-6 |
| 文件 | `AGENTS.md`、`IPC_API_MAP.md`、`test/README.md` 與程式碼一致 | AC-13 |

## 待確認事項

無（`task stats` 預設輸出 JSON、`--table` 才印表格，已於 2026-11-04 確認，spec 措辭已同步）。

## 實作與驗證紀錄

尚未實作。
