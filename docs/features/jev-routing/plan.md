# Plan：Jev 模型與 effort 路由

- 狀態：已確認
- 對應 Spec：[spec.md](./spec.md)
- Spec 確認依據：spec.md 2026-11-03 版，使用者於 2026-11-03 確認（scout 逾時 5 分鐘；master 由 Jev 選模型但不跑 scout）
- 更新日期：2026-11-03
- 確認紀錄：2026-11-03 使用者確認 Plan 並授權實作；每完成一步可 commit，不 push。

> 本檔取代原本只記錄 effort 路由的歷史 plan；那一版的作法已併入下方「現有程式碼調查」。

## 現有程式碼調查

| 檔案 | 現有行為、可重用模式與調查依據 |
| --- | --- |
| `packages/core/src/jev-router.ts` | `createJevRouter({ getApiKey, fetcher })` 只問一題 `effort`，候選為 `selectableEfforts(modelFor(catalog, taskModel(task)))`；失敗回 `status: 'fallback'` + `reason`。`JevRoute` = `{ effort?, status, reason? }`。 |
| `git show 3df0141:packages/core/src/jev-router.ts` | 舊版已實作「複雜度 + 是否規劃 → 最強模型唯讀規劃 → 選模型」：`routeCandidates()`（依名稱分三層、每層取型錄第一個合法 id）、`ask()` 共用請求、`planner` 以 `runAgentPrint` 跑 `claude -p --model X --permission-mode plan` / `codex exec --model X --sandbox read-only --skip-git-repo-check -`、`onPhase` 回報 `judging/planning/selecting`、規劃輸出上限 8,000 字。可直接重用，但當時沒有 effort。 |
| `packages/core/src/agent-print.ts` | `runAgentPrint(bin, args, input, { cwd, timeout, maxBuffer })`：prompt 走 stdin，Windows 經 cmd.exe 找 `.cmd`。`branch-name.ts`、`git.ts` 已這樣用（bin 為 `'claude'` / `'codex'`）。 |
| `packages/core/src/effort.ts` | `modelFor`、`selectableEfforts`、`clampEffort`、`MANUAL_EFFORTS` 可直接用來算 effort 聯集與依選定模型 clamp。 |
| `packages/core/src/service.ts` `launchCommand()`（約 480 行） | 只有 `task.effort === 'auto' && !resume && includeTaskPrompt` 時路由；`routing` Map 去重同卡並發；`setRoute` 寫 `jevRoute` 並 emit `state:changed`；`launchEffort()` 依 `task.model` 找型錄 clamp。新 run（restart/startTask）會清掉 `jevRoute`。 |
| `packages/core/src/service.ts` `startTaskSession()` | `ensureProvisioned` 之後才 `launchCommand`，所以路由時 worktree 已存在，scout 可在 `task.worktreePath` 跑；master 的 `worktreePath` 是它的工作目錄（`isMasterTask`）。`vibeflow:startTask`（`task start`）走同一條路。 |
| `packages/core/src/service.ts` `summarizeTasks()` / `TaskSummary` | `task show`／`task list` 的資料來源，目前沒有模型與 effort 欄位。 |
| `packages/core/src/launch.ts` `buildAgentCommand()` | `sys = role ? [custom, role].join : custom`，role 為 `masterSystemPrompt()` 或 `slaveSystemPrompt()`；`buildPrompt(task)` 只有 title + 描述。`masterSystemPrompt()` 第 2 點寫「需要時可加 --agent / --model / --effort / --base-branch」。 |
| `renderer/lib/jev.ts`、`board-columns.tsx`、`task-workspace-panel.tsx` | 只在 `task.effort === 'auto'` 時顯示 `Jev：選擇 effort 中…` 與 `Jev effort：<effort or 模型預設值>`。 |
| `test/jev-router.test.mjs`、`test/service.test.mjs`（379–440 行）、`test/master-cards.test.mjs`、`test/claude.test.mjs`、`e2e/web.e2e.mjs`（284–292 行） | 既有 Jev / launch / master 測試；router 以 fake `fetcher`、core 以 `jevRouter` 注入；e2e 斷言 `Jev effort：模型預設值` 文案。 |
| `README.md`、`AGENTS.md`、`docs/README.md`、`packages/core/IPC_API_MAP.md` | 都描述「Jev 只選 effort」與「slave 拿 custom + slaveSystemPrompt」，需同步。 |

## 方案與取捨

**Router 一個入口、兩種模式。** `route(task, catalog, opts)` 依 `opts.chooseModel` 分流：

- `chooseModel: false`（卡片有指定模型）：保留現行單題 effort 請求，行為與測試不變（AC-5）。
- `chooseModel: true`：
  1. `routeCandidates()`（自 `3df0141` 還原）算出低／中／高三個候選；空 → fallback（CLI 預設）。
  2. 第一次請求一次問齊：`complexity`（含 `unclear`）、`model`、以及 `opts.chooseEffort` 時的 `effort`（候選 = 各候選模型 `selectableEfforts` 的聯集，依 `MANUAL_EFFORTS` 排序）。合併成一次請求，讓最常見的情境（判得出來）只多花一次 HTTP，而不是舊版的兩次。
  3. `complexity !== 'unclear'` → 採用。`unclear` 且 `opts.scout` → `onPhase('scouting')`，以最高層模型 + `high`（clamp）跑 scout，再 `onPhase('selecting')` 問第二次（無 `complexity`，state 帶 `context`）。`unclear` 且不 scout（master）→ 直接最高層 + `high`。
  4. 最終 effort 一律依選定模型 `clampEffort`；選定模型宣告不接受 effort 時為 undefined。
  5. 失敗：第一次請求前／中 → `fallback`（無 model、無 effort）；scout 失敗 → `fallback` 但帶 `model = 最高層`、`effort = high(clamp)`；第二次 Jev 請求失敗 → 與第一次相同（無 model、無 effort），但保留 `context` 附給 agent。HTTP 402／429 的 `reason` 寫明額度用完。（2026-11-03 使用者追加）

**Scout 執行器可注入。** `createJevRouter({ scout })`，預設實作用 `runAgentPrint`：Claude `['-p', '--model', id, '--permission-mode', 'plan', '--effort', e]`，Codex `['exec', '--model', id, '-c', 'model_reasoning_effort="e"', '--sandbox', 'read-only', '--skip-git-repo-check', '-']`；timeout 300,000 ms、maxBuffer 128 KB、輸出 trim 後截 8,000 字。args 只放固定 token（agent-print 的 Windows 限制），prompt 走 stdin。模型 id 先過 `^[a-zA-Z0-9][a-zA-Z0-9._-]*$`，才能安全放進命令列。

**路由結果都放在 `jevRoute`，不寫回 `Task.model`／`Task.effort`。** 這樣卡片仍是「未指定」，重新開始時會再判斷一次，resume 則沿用（AC-6）。`JevRoute` 擴充為 `{ status, phase?, reason?, model?, effort?, complexity?, scoutModel?, context? }`。

**service 的觸發條件**改為 `needsRoute = !resume && includeTaskPrompt && (!taskModel(task) || task.effort === 'auto')`。`chooseModel = !taskModel(task)`、`chooseEffort = task.effort === 'auto'`、`scout = !isMasterTask(task)`、`cwd = task.worktreePath`。啟動時的模型 = `taskModel(task) ?? route?.model`；`launchEffort` 改用這個模型找型錄，手動 effort 也依它 clamp（AC-4）。scout 分析經 `LaunchOptions.preface` 傳給 `buildAgentCommand`。

**Slave 只拿 slave prompt。** `buildAgentCommand` 中，`task.masterId` 時 `sys = slaveSystemPrompt()`；master 仍為 custom + master prompt。替代方案「以設定開關控制」被否決：Spec 明訂 slave 只聽 master。

**前端只讀 `jevRoute`**：顯示條件從 `task.effort === 'auto'` 改為「有 `jevRoute`」，標籤由 `renderer/lib/jev.ts` 依 phase／model／effort 組出；scout 分析在工作區面板以 `<details>` + `MarkdownContent` 收合顯示。

## 預計修改

| 檔案 | 修改內容 | 對應驗收條件 |
| --- | --- | --- |
| `packages/core/src/jev-router.ts` | 擴充 `JevRoute`、加 `JevRoutePhase`；還原 `routeCandidates`、`ask`；新增模型路由流程、scout 注入、effort 聯集與 clamp；保留 effort-only 路徑 | AC-1～AC-5、AC-9 |
| `packages/core/src/service.ts` | `launchCommand` 觸發條件、傳 `chooseModel/chooseEffort/scout/cwd/onPhase`；`setRoute` 帶 phase；啟動模型取 `route.model`；`launchEffort` 以實際模型 clamp；`TaskSummary` 加 `model?`、`effort?`（實際使用值）並在 `summarizeTasks` 填入 | AC-1、AC-4～AC-7 |
| `packages/core/src/launch.ts` | `buildPrompt(task, preface?)` 附「前置分析（<model>，僅供參考）」；`LaunchOptions.preface`；slave 不帶 custom system prompt；`masterSystemPrompt()` 第 2 點改為預設不帶 `--model`／`--effort` | AC-2、AC-8、AC-9 |
| `renderer/lib/jev.ts` | phase 標籤（判斷任務中…／補充 context 中…／選擇模型中…）與結果標籤（`<model or CLI 預設模型> · <effort or 模型預設>`） | AC-10 |
| `renderer/components/board-columns.tsx`、`renderer/components/task-workspace-panel.tsx` | 顯示條件改為有 `jevRoute`；結果顯示模型 + effort；面板加 scout 分析收合區塊 | AC-10 |
| `test/jev-router.test.mjs` | 新增：判得出時一次請求即採用；`unclear` → scout → 第二次請求（無 unclear、帶 context）；scout 失敗 fallback；手動 effort 不問 effort；非型錄模型被拒；master（scout:false）`unclear` 直接最高層；effort 依選定模型 clamp | AC-1～AC-4、AC-9 |
| `test/service.test.mjs` | 未指定模型時 routed model 進入命令；scout context 進入 prompt；resume 不重新路由；指定模型時行為不變；`task:summaries` 有 model/effort；slave 經 `vibeflow:startTask` 也路由 | AC-1、AC-5～AC-7 |
| `test/master-cards.test.mjs` | slave 命令不含 custom system prompt（Claude、Codex）、一般卡與 master 仍含；`masterSystemPrompt()` 新文案 | AC-8、AC-9 |
| `e2e/web.e2e.mjs` | 更新 fallback 文案斷言（無 key 時 `Jev：CLI 預設模型 · 模型預設`） | AC-10、AC-11 |
| `README.md`、`AGENTS.md`、`docs/README.md`、`packages/core/IPC_API_MAP.md`、`docs/features/master-cards/spec.md` | 改寫 Jev 說明（選模型 + effort + scout）；「What a launch sends」slave 例外；`pty:start` 與 `task:summaries` 說明；master-cards spec 記下 slave 不再帶 custom prompt | 工程品質 |

## 實作順序

1. **launch.ts**：slave system prompt、`buildPrompt` preface、master 派工文案；跑 `test/master-cards.test.mjs`、`test/claude.test.mjs`。
2. **jev-router.ts**：先寫 router 測試（fake fetcher + fake scout），再實作；跑 `test/jev-router.test.mjs`。
3. **service.ts**：接線、`TaskSummary`；補 service 測試；跑 `npm test`。
4. **renderer**：jev 標籤與兩處顯示；`npm run build:web`、renderer typecheck。
5. **文件**同步；e2e 文案更新後跑 `npm run test:e2e`。
6. **Live 驗證**：暫存 store 啟 host，以真 key 或無 key 驗一張未指定模型的卡、一張 master 派的 slave。

每一步各自一個 commit（需你授權後才 commit）。

## 風險與依賴

- **Claude `-p` 與 `--effort` 的組合**：互動模式已在用 `--effort`，`-p` 是否接受需在 live 驗證時確認；不接受就讓 scout 不帶 effort，在 Plan 紀錄中註明。
- **啟動延遲**：判得出時多一次 Jev 請求（≤15 秒逾時）；`unclear` 時再加最多 5 分鐘 scout 與一次請求。UI 會顯示階段，讓使用者知道在等什麼。
- **成本**：master 一次派多張不明確的 slave 時會並發多個 scout；本次不加併發上限，在限制中已揭露。
- **型錄分層靠名稱推斷**：與 `3df0141` 相同的已知限制；測試以 fixture 型錄釘住。
- **resume 後模型漂移**：resume 沿用 `jevRoute.model`；若該模型已從 CLI 下架，由 CLI 報錯，與手動指定已下架模型的行為一致。
- **既有卡片相容**：舊卡的 `jevRoute` 沒有 `model`，`taskModel(task) ?? route?.model` 為 undefined 時回到 CLI 預設，與現況一致。

## 驗證計畫

| 檢查 | 命令或操作 | 對應驗收條件 |
| --- | --- | --- |
| Core typecheck | `npx tsc --noEmit -p tsconfig.json` | 工程品質 |
| Renderer typecheck | `npx tsc --noEmit -p renderer/tsconfig.json` | 工程品質 |
| 單元／整合測試 | `npm test`（迭代時 `node scripts/run-tests.mjs ./test/jev-router.test.mjs` 等） | AC-1～AC-9 |
| Web UI build | `npm run build:web` | AC-10、AC-11 |
| E2E | `npm run test:e2e` | AC-10、AC-11 |
| Live：未指定模型的卡 | `npm start -- --store-path <tmp> --no-open --port 47831`，建一張未指定模型的卡並開始；看卡片階段標籤、最後的「Jev：<model> · <effort>」，以及 terminal 中的 `--model`／`--effort` | AC-1、AC-10 |
| Live：slave | 建 master 卡，由它 `task create` + `task start` 一張 slave；確認 slave 的 Jev 標籤、`task show` 的 model/effort，以及啟動命令沒有 custom system prompt | AC-7、AC-8 |
| Live：scout（有 key 時） | 一張刻意模糊的卡，確認出現「補充 context 中…」，面板顯示 scout 分析；無 key 時改以 fake router 的 service 測試涵蓋 | AC-2 |

## 待確認事項

無

## 實作與驗證紀錄

2026-11-03 實作完成，commits：`4fdfc9a`（launch：slave prompt、前置分析、master 文案）、`6095d98`（jev-router）、`14ebf64`（service 接線、TaskSummary）、`d0c07db`（Web UI）、`258415f`（文件）。

| 檢查 | 結果 |
| --- | --- |
| `npx tsc --noEmit -p tsconfig.json` | 通過 |
| `npx tsc --noEmit -p renderer/tsconfig.json` | 通過 |
| `npm test` | 518 tests，511 pass、0 fail（其餘為既有 skip） |
| `npm run build:web` | 通過 |
| `npm run test:e2e` | 3/3 pass |
| scout 旗標 | 實際執行 `claude -p --model haiku --permission-mode plan --effort low` 與 `codex exec --model gpt-5.6-luna -c model_reasoning_effort=low --sandbox read-only --skip-git-repo-check -` 皆成功，`-p` 接受 `--effort` |

**Live 驗證**（暫存 `--store-path`、真 Jev key、Windows pty、一個只有 `math.js` 的 demo repo；設定了 custom system prompt 標記 `HOUSE-RULES-MARKER`）：

- slave「後端：add subtract / add multiply」（master 派發、未指定模型）經 `task start` 啟動：Jev 判 `simple` → `haiku` · `low`。實際 `claude.exe` 命令列含 `--model haiku --effort low`、`VIBEFLOW_MASTER_ID`、slave prompt，**不含** custom 標記（AC-1、AC-7、AC-8）。
- 一般卡「Make it better」「Tidy things up」：Jev 判 `unclear` → `opus` scout 讀 repo（1,639／3,333 字分析）→ 第二次判斷選 `sonnet` · `xhigh`／`medium`；啟動含 scout 約 37 秒。命令列含 custom 標記與前置分析，無 `VIBEFLOW_MASTER_ID`（AC-2、AC-8）。
- `task:summaries` 回傳上述 model/effort（AC-7）。
- 看板卡片顯示「Jev：sonnet · xhigh」；工作區面板顯示結果與可展開的「前置分析（opus）」（AC-10）。

**限制與觀察**

- scout 的 Claude transcript 寫在卡片 worktree 對應的 `~/.claude/projects/<dir>` 下，progress tracker 會把它的 token 算進卡片用量；todo／進度仍只跟 executor session。視為合理的成本歸屬，未另外處理。
- 驗證過程中，部分在背景（`task start`）啟動的卡片，在 Web UI 開啟其工作區後 agent 行程不在了；未經 Jev 的對照卡（指定 `haiku` + `low`）也一樣，因此與本功能無關，未在本次處理。另一張相同方式啟動的卡開啟後仍存活，未能穩定重現。
- 瀏覽器 pane 在背景時，工作區頁有時停在「載入中…」，與本功能無關。
