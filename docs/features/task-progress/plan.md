# Plan：任務進度、使用量與階段通知

- 狀態：已確認
- 對應 Spec：[spec.md](./spec.md)
- Spec 確認依據：2026-10-05 使用者確認整份 Spec（含第 2 部分 hooks 與通知）
- 更新日期：2026-10-05
- 確認紀錄：2026-10-05 使用者確認 Plan，授權依計畫實作；同日確認 Codex 不注入 `notify` 的變更並授權 commit（不含 push）。

## 現有程式碼調查

| 檔案 | 現有行為、可重用模式與調查依據 |
| --- | --- |
| `packages/core/src/launch.ts` | `buildClaudeSettings(worktreePath)` 已組出 inline `--settings`，掛 `PreToolUse`／`PostToolUse`（matcher `Task`）hook，把 stdin 寫成 `<worktree>/.vibeflow-subagents/<epoch>-$$-$RANDOM.json`。`executorSessionId(taskId, runId)` 決定 Claude session id；只有 `includeTaskPrompt` 的 launch 會帶固定 session，agent-only launch 是另一個新 session。Codex 指令在 `assembleCommand` 組出，可帶 `CODEX_HOME=<library>/codex-home`。 |
| `packages/core/src/subagents.ts` | 「hook 寫檔 → core `fs.watchFile` 800ms 輪詢 → 比對 JSON → `bus.emit`」的完整範例，`watchSubAgents`／`unwatchSubAgents`／`resetSubAgents`。本功能照這個模式做。 |
| `packages/core/src/git.ts` | `ensureLocalExclude` 把 `.vibeflow-subagents/` 寫進 `.git/info/exclude`；`RUNTIME_ARTIFACT_DENYLIST` 與 diff 過濾（約 1032 行）把它排除在 artifacts／diff 之外。新的事件目錄要加進同樣三處。 |
| `packages/core/src/service.ts` | `pty:start` 在啟動後呼叫 `watchSubAgents`；restart handler（約 425–445 行）換新 `runId`、`launchedAt` 並 `resetSubAgents`；`vibeflow:cleanupTask` 捕捉 `outcome` 後移除 worktree；`claudeSessionFile()` 已能算出 transcript 路徑；`shutdown` 會 `unwatchAllSubAgents`。 |
| `packages/core/src/library.ts` | `buildCodexHome` 建出 `<library>/codex-home`，`auth.json`／`config.toml` 連回使用者的 `~/.codex`。**有 library 時 Codex 的 rollout 寫在 `<library>/codex-home/sessions/`，不在 `~/.codex/sessions/`**，兩處都要找。`config.toml` 是連結，不能改。 |
| `packages/core/src/store.ts` | `Task`（`launchedAt`、`runId`、`outcome`）、`AppSettings`（`autoMode`、`systemPrompt`、`workstationPath`）。新欄位都設成 optional，舊 store 不需 migration。 |
| `packages/core/src/client.ts`、`renderer/lib/api.ts` | `onSubAgentsUpdate` 是事件訂閱的範例（`t.on('subagents:update')`）。 |
| `renderer/pages/home.tsx` | 持有 `selectedTaskId`、訂閱 `onSubAgentsUpdate` 並把資料往下傳給 `kanban-board.tsx` 和工作區面板。進度資料照同樣方式傳。 |
| `renderer/components/settings-dialog.tsx` | 以 `<section className="space-y-2">` 分區（Auto Mode、工作站資料夾、Library、CLI 與帳號）。通知區塊加在這裡。 |
| Renderer toast | **沒有現成的 toast 元件**（`task-workspace-panel.tsx:714` 有註解寫明沒有）。要新增一個小型元件。 |
| `packages/tui/src/index.ts` | 已有 `message` 狀態列（`setMessage`）。通知直接寫進這一列。 |
| Claude transcript 實際格式（本機 2.1.288） | `~/.claude/projects/<cwd→dashes>/<sessionId>.jsonl`；assistant 行有 `message.id` 和 `message.usage`（`input_tokens`、`cache_creation_input_tokens`、`cache_read_input_tokens`、`output_tokens`）。同一個 `message.id` 會出現在多行。Sub-agent 的對話寫在 `<sessionId>/subagents/agent-*.jsonl`，不在主檔。 |
| Claude todo 工具 | binary 內同時有 `TodoWrite` 和 `TaskCreate`／`TaskUpdate`（另有 `CLAUDE_CODE_ENABLE_TASKS` 開關），以及 `TaskCreated`／`TaskCompleted` hook 事件。本機 transcript 中兩者都沒出現過，**兩種格式都要支援，並先錄真實 fixture**。 |
| Codex rollout 實際格式（本機 0.144.5） | 第一行 `session_meta.payload.cwd`；`event_msg` 中 `type: token_count` 的 `info.total_token_usage` 是累計值；`response_item` 中 `function_call` 名稱 `update_plan`，`arguments` 是 JSON 字串 `{plan:[{step,status}]}`。 |
| 測試 | `test/subagents.test.mjs`、`test/claude.test.mjs`（launch 指令）、`test/service.test.mjs`（`createCore` + fake backend）、`test/ui-consistency.test.mjs`（renderer class 規則）。`test/support/repo.mjs` 提供 `makeRepo()`。 |

## 方案與取捨

### 資料來源：transcript 是唯一事實來源，hook 只負責「叫醒」與補充

- 進度與使用量**一律由解析 transcript 得出**。hook 事件只做兩件事：
  1. 觸發立即重新解析（取代等輪詢）。
  2. 提供 transcript 沒有的資訊：Claude 的 `Notification`（等待權限）和 `UserPromptSubmit`（使用者回覆了，結束等待）。
- 這樣 hook 失敗、舊 session 沒掛 hook、host 重啟，結果都一樣，只差速度。

替代方案：hook 直接帶完整進度給 core。否決，因為 hook 沒觸發時資料就不完整，而且要維護兩套解析。

### hook 傳遞：寫檔，不打 HTTP

- 新目錄 `<worktree>/.vibeflow-events/`，hook 一律 `cat > <dir>/<epoch>-$$-$RANDOM.json`，與 sub-agent hook 相同。
- core 處理後刪除檔案（消費式），避免目錄一直變大。
- 否決打 host HTTP：需要 token、host 沒跑時事件會遺失，而 tmux session 本來就比 core 活得久。

Claude 新增的 hook（全部 exit 0、不輸出 decision）：

| 事件 | matcher | 用途 |
| --- | --- | --- |
| `PostToolUse` | `TodoWrite\|TaskCreate\|TaskUpdate` | todo 變化 → 立即重新解析 |
| `Stop` | — | 回合結束 → 等待輸入 |
| `Notification` | — | 等待權限或閒置 → 等待輸入（帶 message） |
| `UserPromptSubmit` | — | 使用者回覆 → 回到工作中 |

原本的 `Task` matcher sub-agent hooks 保持不變，同一個事件的多個 matcher 放在同一個陣列。

Codex：**不注入**（實作時變更）。`-c notify=["bash","-c",…]` 在 Windows 上能跑，但 `-c` 會整個取代使用者 `config.toml` 的 `notify`（本機是 codex-computer-use 的 `turn-ended`），`hooks.Stop` 同理，等於弄壞使用者既有的整合。Codex 卡只靠輪詢 rollout；`task_complete` 就是「等待輸入」，延遲約一個輪詢週期（2 秒）。

### 解析：增量 reducer

- `progress.ts` 寫成純函式：`reduceClaudeLine(state, line)`、`reduceCodexLine(state, line)`，`state` 包含 todo 清單、已計入的 `message.id` 集合、usage 合計、最後活動。
- watcher 記住每個檔案已讀到的 byte offset，只讀新增內容，只處理到最後一個換行（截斷的行留到下次）。transcript 可能數 MB，不能每次重讀。
- 壞行 `try/catch` 略過。

### todo 的兩種 Claude 格式

- `TodoWrite`：input 帶完整 `todos[]`，整份取代。
- `TaskCreate`／`TaskUpdate`：增量。以 `TaskCreate` 的 tool_result（`toolUseResult` 中的 task id）建立項目，`TaskUpdate` 依 `taskId` 改 status；`status: deleted` 移除。實際欄位名在階段 0 用真實 fixture 確認後才寫解析器。
- 統一輸出 `TodoItem { content, status: 'pending' | 'in_progress' | 'completed' }`。

### 要算哪些 session

- **使用量**：該 worktree 在本次 run（`launchedAt` 之後開始）的所有 session 總和。
  - Claude：`~/.claude/projects/<munged worktree>/` 下所有第一筆 timestamp ≥ `launchedAt` 的 `*.jsonl`，加上各自的 `subagents/agent-*.jsonl`。這樣 agent-only 終端分頁的花費也算在這張卡上。
  - Codex：`~/.codex/sessions` 和 `<library>/codex-home/sessions` 中，日期目錄 ≥ `launchedAt` 當天、`session_meta.cwd` 等於 worktree（Windows 不分大小寫、統一分隔符）且 timestamp ≥ `launchedAt` 的 rollout；各檔取最後一筆 `total_token_usage` 後加總。
- **進度與活動**：Claude 看 executor session（`executorSessionId(task.id, task.runId)`）；Codex 看上述 rollout 中最新的一個。
- **跨 run 累加**：`Task.usage` 存「已結束的 run」的合計。Restart 前把目前 run 的使用量加進去，cleanup 時也一樣。畫面上顯示的總量是 `Task.usage + 目前 run`。

### 通知：core 判斷，前端決定要不要顯示

- `diffProgress(prev, next)` 純函式，產生 `step_completed`、`all_completed`、`waiting_input`。
- 防重複規則：
  - `all_completed`：以清單內容的 hash 記錄已通知過的清單。
  - `waiting_input`：只在狀態從非等待變成等待時觸發。
- 每個 tracker 第一次同步只建立基準、不發通知，滿足 AC-13「重啟不補發」。
- core 依 `AppSettings.notifications` 過濾類型後才 `bus.emit('progress:notify')`。
- 「正在看該卡」是 UI 概念，由 Web UI 自己判斷：`document.visibilityState === 'visible'` 且 `selectedTaskId === taskId` 時不顯示。TUI 一律顯示在狀態列。

### Tracker 的生命週期

- 與終端的掛載**脫鉤**：tmux 下 agent 可能在沒有任何前端掛載時繼續跑。
- 開始：host 啟動時，對所有 `in_progress` 且有 `worktreePath` 的卡開始追蹤；`pty:start` 帶 launch intent 時也開始（重複呼叫不重複建立）。
- 停止：cleanup、delete、restart（換新 run 後重新開始）、`shutdown`。
- 輪詢：`fs.watchFile` 1 秒輪詢事件目錄和目前的 transcript；有 hook 事件時立即同步。

## 預計修改

| 檔案 | 修改內容 | 對應驗收條件 |
| --- | --- | --- |
| `packages/core/src/progress.ts`（新增） | 型別 `TokenUsage`、`TodoItem`、`TaskProgress`、`ProgressNotification`；`reduceClaudeLine`、`reduceCodexLine`、`addUsage`、`diffProgress`。純函式，不碰檔案系統。 | AC-1–6, AC-11 |
| `packages/core/src/progress-tracker.ts`（新增） | 找 transcript 檔案、增量讀取、消費 `.vibeflow-events/`、per-task tracker（`trackTask`／`untrackTask`／`untrackAll`／`currentProgress`）。home 目錄與 Codex home 列表用參數注入，方便測試。 | AC-4, AC-7, AC-10, AC-13 |
| `packages/core/src/launch.ts` | `buildClaudeSettings` 加上新 hooks；Codex 指令不變。匯出事件目錄常數。 | AC-9 |
| `packages/core/src/git.ts` | `.vibeflow-events/` 加進 local exclude、artifact denylist、diff 過濾。 | 工程品質 |
| `packages/core/src/store.ts` | `Task.usage?: TokenUsage`；`AppSettings.notifications?: NotificationSettings`，加上預設值（總開關開、步驟完成關、全部完成開、等待輸入開、桌面通知關）與讀取 helper。 | AC-8, AC-12 |
| `packages/core/src/service.ts` | `progress:get` handler（`requireTask`）；啟動時追蹤 in-progress 卡；`pty:start` 開始追蹤；restart 與 cleanup 時把 run 使用量累加進 `Task.usage`；delete、cleanup、shutdown 停止追蹤；依設定 emit `progress:update`／`progress:notify`。 | AC-7, AC-8, AC-10, AC-12 |
| `packages/core/src/client.ts` | `getProgress(taskId)`、`onProgressUpdate`、`onProgressNotify`。 | AC-15 |
| `packages/core/IPC_API_MAP.md` | 新 channel 與兩個事件。 | 文件 |
| `renderer/lib/api.ts` | 對應 wrapper（bridge 不存在時回傳 null／no-op）。 | AC-15 |
| `renderer/pages/home.tsx` | 持有 `progress` map（初次載入用 `getProgress`，之後訂閱）；訂閱通知，做「正在看該卡」過濾，送到 toast 與桌面通知；點擊通知時 `setSelectedTaskId`。 | AC-14, AC-15 |
| `renderer/components/notification-toaster.tsx`（新增） | 右下角堆疊 toast，數秒後自動消失、可點擊。使用 design token 與 radius ladder。 | AC-14 |
| `renderer/components/task-progress.tsx`（新增） | `TaskProgressBadge`（卡片用：n/m、細進度條、token 數、執行中或等待輸入的標示）與 `TaskProgressDetail`（工作區用：todo 清單、usage 明細、context 大小、最後活動）。 | AC-15 |
| `renderer/components/kanban-board.tsx` | 卡片顯示 `TaskProgressBadge`；Done 卡只顯示 `Task.usage` 總量。 | AC-8, AC-15 |
| `renderer/components/task-workspace-panel.tsx` | 任務分頁加上 `TaskProgressDetail`。 | AC-15 |
| `renderer/components/settings-dialog.tsx` | 「通知」區塊：總開關、三種類型、桌面通知（開啟時呼叫 `Notification.requestPermission()`；被拒時顯示「瀏覽器已封鎖通知」並退回關閉）。 | AC-12, AC-14 |
| `packages/tui/src/index.ts` | 卡片列加上 `3/7 · 12.3k tok`；訂閱 `onProgressNotify` 寫入 `message`。 | AC-14, AC-15 |
| `test/progress.test.mjs`（新增） | 解析與 diff 的單元測試，使用 `test/fixtures/progress/` 中的真實 fixture（新增，內容已去除敏感資訊）。 | AC-1–6, AC-11 |
| `test/progress-tracker.test.mjs`（新增） | 暫存 home、模擬寫入 transcript 與事件檔：增量讀取、cwd 比對、`launchedAt` 過濾、不補發通知。 | AC-4, AC-7, AC-10, AC-13 |
| `test/claude.test.mjs` | `--settings` 含新 hooks、舊 hooks 不變；Codex 指令不含 `notify`。 | AC-9 |
| `test/service.test.mjs` | `progress:get` 驗證 task id；restart／cleanup 累加 `Task.usage`；通知依設定過濾。 | AC-8, AC-10, AC-12 |
| `test/README.md`、`AGENTS.md`、`docs/README.md` | 新測試套件；架構說明加上 progress 模組與 `.vibeflow-events/`。 | 文件 |

## 實作順序

0. **錄真實 fixture**：在暫存 repo 用 Claude（預設，以及 `TodoWrite` 和 Task 工具兩種模式）與 Codex 各跑一個會建立 todo 的小任務，錄下 transcript 與 hook stdin，並確認 Codex `notify` 在 Windows 上能啟動 `bash`。之後去除敏感資訊存成 fixture。這一步會花一點使用量。
1. `progress.ts` 加上 `test/progress.test.mjs`（TDD）。驗證：`node scripts/run-tests.mjs ./test/progress.test.mjs`。
2. `progress-tracker.ts` 加上它的測試。
3. `launch.ts`、`git.ts` 的 hook 與 exclude，以及 `test/claude.test.mjs`。
4. `store.ts`、`service.ts`、`client.ts`、`IPC_API_MAP.md`，以及 `test/service.test.mjs`。驗證：core typecheck 和 `npm test`。
5. Renderer：api wrapper → 進度元件 → 看板與工作區 → toaster 與桌面通知 → 設定頁。驗證：renderer typecheck、`npm run build:web`。
6. TUI。
7. 文件更新、完整 DoD、live runtime check。

## 風險與依賴

- **CLI 格式變動**：transcript 和 hook 都不是公開穩定 API。處理方式：解析器只讀少數欄位、遇到不認得的就略過；用 fixture 測試鎖住目前格式；解析失敗時不顯示資料，不讓 host 崩潰。
- **Claude 兩種 todo 工具**：用哪一種取決於版本與 `CLAUDE_CODE_ENABLE_TASKS`。兩種都支援；階段 0 若發現 Task 工具的結果拿不到 id，退回只在 `TaskUpdate` 時依 `subject` 對應，並在紀錄中註明。
- **Codex `notify`**：階段 0 證實 Windows 上可以啟動 `bash`，但 `-c` 會取代使用者自己的 `notify`，所以不注入；Codex 只靠輪詢（2 秒）。
- **舊的 tmux session 沒有新 hook**：功能上線前就在跑的 agent 只靠輪詢，重新啟動後才有 hook。可接受。
- **輪詢成本**：每張執行中的卡兩個 `watchFile`（1 秒）。卡數通常個位數，可接受；增量讀取避免重讀大檔。
- **使用量計算範圍**：Claude 會把同一 worktree 的所有 session 都算進來（包含 agent-only 分頁），比「只算 executor session」更接近實際花費，這是刻意的。
- **`.vibeflow-events/` 進入 diff 或 commit**：已加進三處排除，並由測試覆蓋。

## 驗證計畫

| 檢查 | 命令或操作 | 對應驗收條件 |
| --- | --- | --- |
| Core typecheck | `npx tsc --noEmit -p tsconfig.json` | AC-16 |
| Renderer typecheck | `npx tsc --noEmit -p renderer/tsconfig.json` | AC-16 |
| 單元與 service 測試 | `npm test`（含 `progress`、`progress-tracker`、`claude`、`service`、`ui-consistency`） | AC-1–13, AC-16 |
| Web 建置 | `npm run build:web` | AC-16 |
| E2E | `npm run test:e2e` | AC-16 |
| Live：進度與使用量 | `npm start -- --store-path <tmp> --no-open --port 47831`，建立一張要求「先列出 3 步驟 todo 再逐步做」的卡並啟動；觀察卡片 n/m 和 token 數更新、工作區面板的清單與明細；完成後移到 Done，重啟 host，確認總 token 數還在。截圖存在 scratchpad。 | AC-8, AC-15 |
| Live：通知 | 同一 host：開啟桌面通知並授權；切到別張卡，等 agent 完成一步與停下等待；確認 toast 與系統通知、點擊後選取該卡；切到該卡再觸發一次，確認不跳通知；關閉總開關後確認不再通知。 | AC-12, AC-14 |
| Live：TUI | `npm start -- tui --store-path <tmp>`，確認卡片列進度與狀態列通知。 | AC-14, AC-15 |
| Live：Codex | 同上，用一張 Codex 卡確認進度、使用量與等待輸入通知。 | AC-3, AC-4 |

## 待確認事項

- 無

## 實作與驗證紀錄

2026-10-05 實作完成（branch `feat/task-progress`，未 commit）。

### 階段 0：真實格式

- Claude Code 2.1.288：`-p` 模式下 `CLAUDE_CODE_ENABLE_TASKS=0` 用 `TodoWrite`，`=1` 用 `TaskCreate`／`TaskUpdate`；互動模式（live run）預設用 Task 工具。`TaskCreate` 的 id 在 `toolUseResult.task.id`。同一個 `message.id` 的多行 usage 完全相同，依 id 去重。Sub-agent 對話在 `<session>/subagents/agent-*.jsonl`。
- Codex 0.144.5：`update_plan` 的 `arguments` 是 JSON 字串；`token_count.total_token_usage` 是累計值且 `input_tokens` 含 cached。
- 錄下的資料精簡、去除路徑後存為 `test/fixtures/progress/*.jsonl`（不含 system prompt、使用者路徑或帳號資訊）。
- 順帶發現：Claude 的 sub-agent 工具現在叫 `Agent`，現有 sub-agent hook 的 matcher 是 `Task`，可能已經錄不到 sub-agent（本功能範圍外，另開任務）。

### 自動化檢查

| 檢查 | 結果 |
| --- | --- |
| `npx tsc --noEmit -p tsconfig.json` | 通過 |
| `npx tsc --noEmit -p renderer/tsconfig.json` | 通過 |
| `npm test` | 345 個：338 通過、2 失敗、其餘略過。失敗的是 `artifacts.test.mjs` 兩個 symlink 測試（Windows `EPERM: symlink`），在乾淨的 `main` 上一樣失敗，與本功能無關。新增的 `progress`（19）、`progress-tracker`（7）、`claude`／`git`／`service` 新案例全數通過。 |
| `npm run build:web` | 通過 |
| `npm run test:e2e` | 通過（1/1） |

### Live 驗證（`--store-path` 暫存 store，Claude Haiku，一張 3 步驟的卡）

- 卡片即時顯示 n/m、進度條、token 數；Claude 要求寫檔權限時顯示「等待權限」（Notification hook），允許後回到執行中；回合結束顯示「等待輸入」。
- 工作區的任務分頁顯示 todo 清單（完成項劃線）、目前動作、token 明細與 context 大小。
- 關掉該卡分頁後送出新指令：依序收到「完成 4/5」「完成 5/5」「所有步驟已完成」「等待你的輸入」4 個 toast；點擊 toast 重新打開並選取該卡。
- 選取該卡且頁面在前景時跑一輪：沒有 toast。
- 設定頁關閉總開關後再跑一輪：沒有 toast；store 中 `settings.notifications.enabled` 為 `false`。
- TUI（node-pty 擷取畫面）卡片列顯示 `5/5 · 927k tok · 等待輸入`。
- 完成卡片後 `Task.usage` 寫入 store；重啟 host 後 Done 卡仍顯示 `927k tok`，工作區有 Token 使用量明細。

### 未驗證或受限

- **桌面通知**：內建瀏覽器封鎖 Notification API，只驗證了「瀏覽器已封鎖通知」的提示；實際系統通知與點擊需在一般瀏覽器確認。
- **TUI 通知列**：只有單元層級（文字 helper）與程式碼路徑，live 時總開關已關，沒有實際看到狀態列訊息。
- **Codex live**：解析器與 tracker 用真實 rollout fixture 驗證過，沒有在 Web UI 跑 Codex 卡。
- **延遲**：Claude 寫 transcript 有緩衝，終端顯示完成後，卡片約數秒才更新到最終狀態。
