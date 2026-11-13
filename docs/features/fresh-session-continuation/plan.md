# Plan：卡片換新 session 接續

- 狀態：待確認
- 對應 Spec：[spec.md](./spec.md)
- Spec 確認依據：2026-11-13 使用者回覆「繼續」，視為接受 spec 的建議預設
- 更新日期：2026-11-13
- 確認紀錄：尚未確認

## 現有程式碼調查

| 檔案或專案 | 現有行為、可重用模式與調查依據 |
| --- | --- |
| `packages/core/src/launch.ts` | `executorSessionId(taskId, runId)`（382 行）以 `runId` 決定 Claude session id；`buildAgentCommand`（554 行）在 `resume` 時不送 prompt，否則送 `buildPrompt()`。Claude 無 resume 時用 `--session-id`；Codex 分支沒有 session id，也沒有 resume（`resume` 只是不送 prompt）。slave 卡只帶 `slaveSystemPrompt()`。 |
| `packages/core/src/service.ts` | `startTaskSession`（655 行）：`sessions.start(key, {command})` 會取代同 key 的舊 session，舊 session 的 `onExit` 不會觸發（`pty.ts` 134–143 行以 `this.sessions.get(key) === session` 判斷；`tmux-backend.ts` 以 `killed` 標記 `intentional`）。`launchCommand`（525 行）在 `needsRoute && !resume && includeTaskPrompt` 時呼叫 Jev，需要略過。`resetTaskRun`（922 行）已示範「折入用量 → 換 `runId`／`launchedAt`」；`usageThroughCurrentRun`（436 行）可直接重用。`vibeflow:startTask`（1057 行）示範「無 frontend 啟動」。`coded()`、`obj()`、`requireTask()`、`columnOf()`、`summarizeTasks()` 可重用。`homeDir` 選項讓測試把 transcript 放在 temp home。 |
| `packages/core/src/progress-tracker.ts` | Claude：executor 檔永遠計入，其他 session 只在 `startedAt >= since - 5s` 時加入用量（209–227 行）→ 折入後更新 `launchedAt`，舊 session 即被排除，不會重複計。`track()` 的 `sameTarget` 比對 `sessionId`／`since`／`priorUsage`，換 run 會自動重新基線。`claudeProjectDir(home, cwd)` 可算 transcript 目錄。 |
| `packages/core/src/progress.ts` | `reduceClaudeLine` 只讀少數欄位，`contextTokens = input + cacheRead + cacheWrite`（238 行，驗收量測沿用此定義）。目前沒有讀 assistant 文字；新增一個純函式讀 `message.content[].text`，並以 `test/fixtures/progress/` 釘住格式。 |
| `packages/core/src/commit-diff.ts`、`git.ts` | `getBranchCommits(worktree, base)`（136 行，本地、不連網）給 `base..HEAD` commit；`collectWorkingEntries(worktree)`（1067 行）給未 commit 檔案；`getPrStatus(worktree)`（1339 行）用 `gh pr view` 給 PR，無 PR 或無 `gh` 回 null（沒有 timeout，需要在呼叫端加）；`runGit` 可查 upstream 領先數。 |
| `packages/core/src/inbox.ts`、`mailbox.ts` | inbox 在 worktree 內（`.vibeflow-inbox`），不綁 session；`prepareInbox` 只清 `.ready`，不刪訊息 → 未讀訊息自然留給新 session 的 hook。`mailbox.forget` 只清輸入狀態，不取消進行中的 `deliver`。 |
| `packages/core/src/notifier.ts`、`service.ts` 的 `onExit` | `notifier.exited(task.id)` 只在 `onExit` 觸發；被新 session 取代時不會觸發 → 不需要特別處理，只要「不先 kill 再開」。 |
| `packages/core/src/client.ts`、`renderer/lib/api.ts`、`packages/core/IPC_API_MAP.md` | handler 加法順序已寫在 AGENTS.md：service → client → api → IPC map。`startTask`／`resetTaskRun` 是現成樣板。 |
| `packages/cli/src/task-command.ts` | `parseArgs` strict；`HOST_COMMANDS = ['start','list','show','send']`；`hostCommand` 的 `start` 呼叫 `remote.api.startTask`；`send` 用 `err.code` 轉 `fail(code, message)`；`--force` 已是 boolean 選項。`TASK_USAGE` 文字要同步。 |
| `renderer/components/task-terminal.tsx`、`task-workspace-panel.tsx`、`kanban-board.tsx` | 工具列已有 `HoldButton`（退回 Backlog）與「啟動 Agent」；`launchAgentOnly` 示範 `term.reset()/clear()` → 呼叫 → `focus()`；`onLaunchAgent`／`onReturnToBacklog` 自 `kanban-board.tsx`（457 行）經 `task-workspace-panel.tsx`（1569 行）傳入。 |
| `test/` 與 `e2e/` | `test/service.test.mjs` 有 `fakeSessions()`、`coreWithTask`、`coreWithProgress`（transcript 在 temp home）；`test/claude.test.mjs` 測 `buildAgentCommand`；`test/task-cli.test.mjs` 測 CLI；`e2e/web.e2e.mjs` 用 `FAKE_AGENT` shell script 取代 `claude`；`test/ui-consistency.test.mjs` 掃 renderer class 慣例。 |

## 方案與取捨

**採用：** 新 handler `vibeflow:continueTask({ taskId, force? })`，UI 與 CLI 共用；不新增 `LaunchIntent` 欄位。流程（同一張卡以 per-card in-flight 鎖序列化）：

1. 檢查：在 In Progress、`launchedAt` 有值、有 `worktreePath`；有存活 session 且 activity 為 `working`／等權限時，沒有 `force` 就回 `AGENT_BUSY`。
2. 在更換 `runId` **之前**蒐集事實並組簡報（舊 executor 的 transcript 路徑還算得出來）：card 文字、git（commits、未 commit 檔案、upstream 領先數）、PR（`getPrStatus` 加 5 秒 timeout）、todos（`progress.snapshot`）、最後回覆（僅 Claude）；master 改用 `summarizeTasks({ masterId })`。每一項各自 try/catch，失敗就省略該段。
3. 折入用量：`usage = usageThroughCurrentRun(task)`；`updateTask(id, { runId: randomUUID(), launchedAt: Date.now(), usage })`；保留 `jevRoute`；`resetSubAgents` 並 emit `subagents:update`。
4. 內部呼叫 `startTaskSession(task, task.id, { taskId, launch: {} }, { continuation: brief })`：`launchCommand` 看到 `continuation` 就略過 Jev、把簡報當第一則訊息（`buildAgentCommand` 的新選項 `LaunchOptions.continuation`，優先於 `buildPrompt`）。取代舊 session 由 `sessions.start` 完成，不另外 kill。
5. emit `state:changed`，回傳 `{ state, task }`。

**簡報組裝**放在新檔 `packages/core/src/continuation.ts`：純函式 `buildContinuationPrompt(facts)`（段落、上限、省略規則集中一處，容易單元測試）＋ `readLastClaudeReply(file, maxChars)`（只讀檔尾 256 KB）。`progress.ts` 新增純函式 `claudeLastReply(lines)`。

**替代方案與捨棄理由：**
- 讓舊 agent 寫交接檔：多一輪 180k+ context 的呼叫、agent 卡住時不可用、與 task-progress「不靠模型寫進度」的原則相左（spec 已定案）。
- 用 `LaunchIntent.newSession` 走 `pty:start`：client 送的 `LaunchIntent` 沒有嚴格欄位驗證，要塞簡報文字就得開洞；改由 core 內部參數傳簡報，沒有新的 client 可控文字入口。
- 不折用量、只換 `runId`：舊 transcript 超過 Claude 保存期限後總用量會變小；折入沿用 `resetTaskRun`／`cleanupTask` 已有的規則。

## 預計修改

| 檔案 | 修改內容 | 對應驗收條件 |
| --- | --- | --- |
| `packages/core/src/progress.ts` | 新增 `claudeLastReply(lines)`：取最後一則 assistant 的 text block | AC-2 |
| `test/fixtures/progress/claude-last-reply.jsonl`（新增） | 合成 transcript：多則 assistant、結尾是 tool_use、含 text | AC-2 |
| `packages/core/src/continuation.ts`（新增） | `ContinuationFacts`、`buildContinuationPrompt`、`readLastClaudeReply`；上限：commits 20、檔案 30、最後回覆 2,000 字、總長 8,000 字（超過先裁最後回覆再裁 commit） | AC-2 |
| `packages/core/src/launch.ts` | `LaunchOptions.continuation?: string`；`buildAgentCommand` 有它時 `prompt = continuation`（Claude 與 Codex 皆然），不與 `resume` 並用 | AC-2、AC-4 |
| `packages/core/src/service.ts` | `vibeflow:continueTask` handler；`prepareContinuation`（檢查、事實、折用量）；`startTaskSession`／`launchCommand` 接受內部 `continuation` 參數並略過 Jev；per-card in-flight 鎖；錯誤碼 `NOT_IN_PROGRESS`／`NOT_LAUNCHED`／`NO_WORKTREE`／`AGENT_BUSY`／`ALREADY_CONTINUING` | AC-1、AC-3、AC-4 |
| `packages/core/src/client.ts` | `continueTask(payload)` | AC-5 |
| `packages/core/IPC_API_MAP.md` | 新增 `vibeflow:continueTask` 一列 | AC-7 |
| `renderer/lib/api.ts` | `continueTask` wrapper（無 bridge 回 null） | AC-5 |
| `packages/cli/src/task-command.ts` | `--new-session` boolean；`start` 搭配它時呼叫 `continueTask`，`--force` 傳入；`--force` 只允許用在 `send` 或 `start --new-session`；錯誤用 `err.code`；更新 `TASK_USAGE` | AC-3、AC-5 |
| `renderer/components/task-terminal.tsx` | 新增 `onContinue` prop 與按住確認的「新 Session 接續」按鈕（`HoldButton`，圖示用 lucide）；仿 `launchAgentOnly` 的 `reset/clear/focus`，並維持 `runningCommandRef` 讓結束文字正確 | AC-5 |
| `renderer/components/task-workspace-panel.tsx`、`renderer/components/kanban-board.tsx` | 傳遞 `onContinue`，只對 In Progress、`launchedAt` 有值的卡片提供；呼叫 `continueTask({ taskId, force: true })`（按住即確認） | AC-5 |
| `test/continuation.test.mjs`（新增） | 簡報段落、上限與裁切順序、省略規則、master 版；`claudeLastReply` 對 fixture | AC-2 |
| `test/claude.test.mjs`、`test/service.test.mjs`、`test/master-cards.test.mjs`、`test/task-cli.test.mjs` | 見驗證計畫 | AC-1～AC-4 |
| `e2e/web.e2e.mjs` | 新增步驟：卡片跑起來後按住「新 Session 接續」，終端機再次出現 fake agent 輸出；fake agent 把 argv 寫到 `$FAKE_AGENT_ARGV_LOG`，斷言有新的 `--session-id` 與簡報文字 | AC-5 |
| `AGENTS.md` | CLI 說明加上 `task start --new-session`；「What a launch sends」加一句續接簡報 | AC-7 |
| `docs/README.md`、`test/README.md` | 新增 feature 列與 `continuation.test.mjs` 列 | AC-7 |

## 實作順序

每階段：通過該階段驗證 → 任務標 completed → commit，再做下一階段。

1. **簡報純邏輯**：`claudeLastReply`＋fixture、`continuation.ts`、`test/continuation.test.mjs`。驗證：`npx tsc --noEmit -p tsconfig.json`；`node scripts/run-tests.mjs ./test/continuation.test.mjs ./test/progress.test.mjs`。
2. **啟動指令**：`launch.ts` 的 `continuation` 選項＋`test/claude.test.mjs` 案例。驗證：tsc；`node scripts/run-tests.mjs ./test/claude.test.mjs`。
3. **handler**：`service.ts`、`client.ts`、`IPC_API_MAP.md`＋`test/service.test.mjs`／`test/master-cards.test.mjs` 案例。驗證：tsc；兩個測試檔；`npm test`。
4. **CLI**：`task-command.ts`、`TASK_USAGE`、`AGENTS.md` CLI 段＋`test/task-cli.test.mjs`。驗證：tsc；`node scripts/run-tests.mjs ./test/task-cli.test.mjs`。
5. **Web UI**：`renderer/lib/api.ts`、`task-terminal.tsx`、`task-workspace-panel.tsx`、`kanban-board.tsx`。驗證：`npx tsc --noEmit -p renderer/tsconfig.json`；`npm test`（含 `ui-consistency`）；`npm run build:web`。
6. **e2e 與文件**：`e2e/web.e2e.mjs`、`test/README.md`、`docs/README.md`。驗證：完整 DoD（兩個 tsc、`npm test`、`npm run build:web`、`npm run test:e2e`）。
7. **驗收**：全新 context 的 sub-agent 依「驗證計畫」執行並回報，不改程式碼；有問題回到對應階段修，再重跑受影響的驗收。

## 風險與依賴

- **Claude transcript 格式非公開**：`claudeLastReply` 只讀 `type`、`message.content[].type/text`；讀不到就省略該段，不讓接續失敗；fixture 釘住格式。
- **`gh` 慢或離線**：5 秒 timeout，回「PR 狀態未知」。
- **打斷執行中的 agent**：`AGENT_BUSY` 擋 CLI／master；UI 靠按住確認。activity 讀數可能過時，所以保留 `--force`。
- **兩次同時接續**：per-card 鎖，第二次 `ALREADY_CONTINUING`。
- **進行中的 `mailbox.deliver`**：沒有 inbox 的路徑（Codex）仍在排隊的輸入會在新 session 啟動期間被貼進去，行為與任何一次重啟相同，不另外處理，列為已知限制。
- **重複計用量的 5 秒 slack**：舊 session 啟動後 5 秒內接續可能被重複計入；極小機率，記錄不處理。
- **xterm 狀態**：UI 不走 `armLaunch`，需在瀏覽器實測 `reset/clear`、結束文字與重新聚焦。
- **tmux 與 pty 兩種 backend**：取代 session 的路徑與「啟動 Agent」相同；驗收用實際 host（有 tmux 就走 tmux）。
- **Store 資料形狀**：不新增欄位 → 不需要 migration；驗證舊 store（沒有 `runId` 的卡片）接續成功（`test/service.test.mjs` 案例）。
- **契約檢查**：新增 handler 與 client 方法是加法；`buildAgentCommand` 新選項為 optional，既有呼叫端行為不變（`test/claude.test.mjs` 既有案例回歸）。

## 驗證計畫

| 檢查 | 命令或操作 | 對應驗收條件 |
| --- | --- | --- |
| 型別（core） | `npx tsc --noEmit -p tsconfig.json` | 工程品質 |
| 型別（renderer） | `rm -rf renderer/.next && npx tsc --noEmit -p renderer/tsconfig.json` | 工程品質 |
| 單元／handler 測試 | `npm test`。新增案例：①接續後 `runId`／`launchedAt` 更新、`usage` 折入、worktree 不動；②`sessions.killed` 為空、`starts` 多一筆、指令含新 `--session-id` 與簡報；③Backlog／Done／無 worktree／未執行被拒且狀態不變；④`AGENT_BUSY` 與 `force`；⑤沒有存活 session 可接續；⑥同時兩次 → `ALREADY_CONTINUING`；⑦完成卡片後總用量不重複；⑧未讀 inbox 訊息保留、`notifier` 無 session 結束通知；⑨slave 只帶 `slaveSystemPrompt()`；⑩master 簡報含卡片表、無 git／PR；⑪Codex 簡報併入 prompt；⑫沒有 `runId` 的舊卡片可接續 | AC-1～AC-4 |
| CLI | `test/task-cli.test.mjs`：`--new-session` 流程、`--force` 單獨使用被拒、錯誤碼輸出 | AC-3、AC-5 |
| 建置 | `npm run build:web`（受限環境加 `-- --webpack`） | 工程品質 |
| E2E | `npm run test:e2e` | AC-5 |
| UI 實測與像素比對 | `npm start -- --store-path <tmp> --no-open --port 47831`，開啟帶 token 的 URL；用 `visual-parity` skill 比對按鈕所在工具列與基準（改動前的 build）的差異；Playwright 錄影按住按鈕到新 session 出現的過程；檢查 console／network 錯誤與 375／768／1440 寬度 | AC-5 |
| 量測 context | 丟棄式 `--store-path` 起 host，真實 Claude 卡（throwaway repo）讀入夠多檔案讓舊 session 最後一次呼叫 ≥ 80k，再 `task start --task <id> --new-session`；取舊 session 最後一則、新 session 第一則 assistant 訊息的 `usage`，以 `input + cache_read + cache_creation` 計，回報兩個數字、檔案與行號、比值（目標 ≤ 50%）；同時回報簡報字數 | AC-6 |
| 文件 | 檢視 `docs/README.md`、`IPC_API_MAP.md`、`AGENTS.md`、`test/README.md` 的新增列 | AC-7 |
| 清理 | `rm -rf app renderer/.next`；刪驗收產生的 temp store／repo／worktree／錄影以外的暫存檔 | 工程品質 |

驗收由全新 context 的 sub-agent 執行上表中的「UI 實測」「量測 context」與 DoD 指令，只回報結果，不改程式碼；結束後刪除它建立的暫存檔案與資料夾。

## 待確認事項

無。

## 實作與驗證紀錄

尚未實作。
