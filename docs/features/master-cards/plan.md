# Master 卡片 — Plan

> 對應 `spec.md`。狀態：**待使用者過目**，確認後依階段實作，每階段結束跑 DoD 中受影響的檢查並 commit。

## Phase 1 — Core 資料與生命週期

- `store.ts`：`Task` 加 `role?: 'master'`、`masterId?: string`、`workDir?: string`（master 覆寫的工作目錄）。
  `branch` 改為可選，並修所有使用端（`git.ts`、`specs.ts`、`github.ts`、`progress-tracker.ts`、renderer）。
- `tasks.ts`：`createTaskFromInput` 依 role 分流；master 不碰 git、不需要 `projectPath`；
  `masterId` 驗證（目標存在、是 master、自己不是 master）。`updateTaskFromInput` 支援改 / 清 `masterId`。
- `service.ts`：
  - `ensureProvisioned`：master 直接回傳，cwd = `workDir ?? <userData>/masters/<id>`（mkdir -p）。
  - `pty:start` / `terminal:start` 用統一的 `taskCwd(task)`。
  - diff / spec / outcome / cleanup 對 master 跳過；`deleteTask` 清 slave 的 `masterId`，預設資料夾一起刪。
  - 新 handler `vibeflow:startTask`：移到 In Progress 頂端、標 `launchedAt`、provision、
    `sessions.start` 以預設尺寸起 session、`trackProgress`、`bus.emit` 新 state。
  - 新 handler `vibeflow:taskSummary`（給 CLI 與 UI 共用）：slave 欄位、session 是否存活、todo x/y、最後活動、
    `launchError`、PR、`outcome`。
- 測試：`test/tasks.test.mjs`、`test/service.test.mjs` 補 master 建立、不 provision、`startTask`、刪除清關聯。

## Phase 2 — CLI 與 master prompt

- `task-command.ts`：`create --role master [--work-dir]`、`create/update --master <id|none>`、
  `task start --task`（透過 lock 連 running host；沒 host 就報錯）、`task list --master --json`、`task show --json`。
- `launch.ts`：master launch 注入 master 指引（spec D 草稿），依 auto mode 切換派工段落；`$VF` 由 `boardEnvPrefix` 現有變數組成。
- AGENTS.md：更新「What a launch sends」例外、CLI 章節、`IPC_API_MAP.md`。
- 測試：CLI 參數驗證、launch 指令含 / 不含 master 段落。

## Phase 3 — 建立對話框（A1）

- `new-task-dialog.tsx`：拆掉 modal 兩步驟改單頁雙欄；頂端 Slave／Master segmented control；
  左欄依角色切換（專案區塊 / 工作目錄）；Slave 表單可選「所屬 master」（下拉列 Backlog+In Progress 的 master）。
- `client.ts` / `api.ts` 型別與 wrapper。`ui-consistency` 規則照跑。

## Phase 4 — 看板與工作區（B2 + C1）

- `kanban-board.tsx`：有 `masterId` 的卡不進欄位清單，改渲染在 master 卡下方的巢狀清單（狀態點、x/y、可收合）；
  master 卡顯示 slave 計數與進度條。點 slave 列 = 選取。slave 的開始／完成／退回改由工作區按鈕觸發（沿用 `startTask` / `completeTask`）。
- `task-workspace-panel.tsx`：master 不顯示 Diff／決策／PR；Terminal 旁常駐 slave 表格；
  slave 頂端顯示所屬 master 連結。
- 進度資料：沿用 `progress:update` 事件，renderer 端依 `masterId` 聚合。

## Phase 5 — TUI 與驗收

- TUI：`n` 表單加角色；看板以縮排顯示 slave。
- DoD：兩個 typecheck、`npm test`、`npm run build:web`、`npm run test:e2e`（加一條 master 建立 + CLI 派工 + `task start` 的 e2e）、
  用 `--store-path` 暫存 store 實際跑一次 master 派兩張 slave。

## 風險

- 舊版 app 讀到含 master 的 store 會壞（無 `projectPath`）— release note 說明。
- `branch` 改可選波及面廣，Phase 1 先用 typecheck 列出所有使用端再改。
- tmux 不在時（Windows pty）headless 起 session 也要可用，`startTask` 測試用 fake backend 覆蓋。

## Phase 6 — 訊息改走 hook 旁路（已實作）

**問題**：`mailbox.ts` 等使用者停手 3 秒後，把訊息 bracketed paste 進 agent 輸入框再按 Enter。
輸入框裡如果有使用者還沒送出的草稿，草稿會跟著訊息一起送出。訊息本來就不經過網頁（host 直接寫 pty），
問題在於它和使用者共用同一個輸入框。

**做法**：Claude 卡的訊息不再打字，改放進該卡的 inbox，由 Claude Code hook 帶進對話；
只有 agent 已經閒置、非叫醒不可時才打字，而且輸入框必須是空的。

1. **Inbox**（core，新檔 `inbox.ts`）：`<worktree>/.vibeflow-inbox/`，一則訊息一個檔（tmp + rename 原子寫入），
   比照 `.vibeflow-events/` 排除在 git 與 diff 之外。
2. **Hook**（`launch.ts` `buildClaudeSettings`）：
   - `PostToolUse`（所有工具）→ `hookSpecificOutput.additionalContext`：工作中途插話，不碰輸入框。
   - `UserPromptSubmit` → `additionalContext`：使用者送出自己的訊息時順帶附上。
   - `Stop` → `{"decision":"block","reason":…}`：agent 要停下時還有信，就接著處理。
   - 先用 shell 判斷 inbox 是否為空，有信才啟動 `node -e` 認領（`mv` 原子認領）並輸出 JSON，平時零成本。
3. **投遞**（`mailbox.deliver`）：Claude 卡 → 寫 inbox，host 監看檔案被認領即視為送達。
   agent 已閒置（Stop 之後、等輸入）且沒有草稿 → 才走原本的 paste + Enter 叫醒；有草稿就留在 inbox，
   等使用者送出時由 `UserPromptSubmit` 帶上。Claude 卡不再需要 `TARGET_BLOCKED`：權限對話框期間信在 inbox 等。
4. **草稿判斷**：mailbox 已經看到所有 `pty:input`，記錄「上次 Enter／Ctrl+C／Ctrl+U 之後有沒有輸入可見字元」。
   保守：刪光重打也算有草稿，直到 Enter。
5. **Codex**：沒有 hook，維持打字，但加上第 4 點的草稿保護（有草稿就等，逾時回報失敗）。
6. **契約變動**：`vibeflow:sendMessage` / `task send` 回傳加 `via: 'hook' | 'typed' | 'queued'`；`queued` 代表已進 inbox、
   下一個 hook 會帶上，`task send` 不再為此阻塞 120 秒。session 是否讀 inbox 由 `SessionStart` hook 寫的
   `.ready` 判斷（每次 launch 先清掉），舊版啟動、存活在 tmux 裡的 session 因此仍走打字。inbox 內放 `.gitignore`（`*`），
   早於此功能建立的 worktree 也不會 commit 到它。notifier 的 host note 同樣走 inbox。
   更新 `IPC_API_MAP.md`、AGENTS.md「Masters and their cards」段、spec D2。
7. **測試**：`mailbox.test.mjs`（草稿追蹤、有草稿不打字）、新 `inbox.test.mjs`（寫入／認領／hook 腳本輸出 JSON）、
   `launch` 設定含三個 hook、`service.test.mjs` sendMessage 走 inbox。執行期：暫存 store 跑一個 master + slave，
   在 slave 輸入框留草稿時 `task send`，確認草稿沒被送出、訊息在下一個 hook 抵達。

**已知限制**：TUI 用 tmux attach 直接打字時繞過 mailbox，草稿判斷看不到 — 有外部 tmux client 時一律不打字，
信只經 hook 抵達。使用者留著草稿不送、agent 又閒置時，信會一直在 inbox 等到使用者送出。

## Phase 7 — Master 改為「規劃＋派工」

> 對應 spec〈Phase 7〉（已確認 2026-11-19，決策 D7–D11）。狀態：**已確認 2026-11-19（使用者：開始實作）**。
> 確認後依 7a → 7f 實作，每階段結束跑受影響的檢查；commit 另外取得同意。

### 現況（調查結果）

- 提示詞：`packages/core/src/launch.ts` 的 `slaveSystemPrompt()`（292）、`masterSystemPrompt()`（313）；
  `buildAgentCommand()` 對有 `masterId` 的卡**只**送 `slaveSystemPrompt`，丟掉 Library 與 custom prompt。
- 可讀目錄：`assembleCommand()` 已經用 `--add-dir` 給 workspace 與 Library；Codex CLI 也支援 `--add-dir <DIR>`
  （本機 `codex --help` 確認），目前沒用到。
- 通知：`notifier.ts` 的 `NoteKind = 'blocked' | 'launch_failed' | 'exited' | 'turn_unreported'`；
  在 `service.ts` 408 建立，`activity`（374）、`launchFailed`（763）、`exited`（811）、`reported`（1236）餵資料。
  Done 沒有任何通知。
- 完成流程：renderer 先 `vibeflow:setBoard` 把卡移到 done，再呼叫 `vibeflow:cleanupTask`（1569），
  它移除 worktree 並 `syncBaseBranch`。所以**相依卡應在 cleanupTask 之後啟動**，provision 時 base 已含前置卡的成果
  （前置卡有 merge 時）。
- 啟動：`vibeflow:startTask`（1187）只收 Backlog 卡，可直接重用。
- 歸屬驗證：`tasks.ts` 的 `assertMasterRef()`（82），create（129）／update（374）都會呼叫。
- 使用端：`slaveSystemPrompt`／`masterSystemPrompt`／`NoteKind` 只被 `launch.ts`、`notifier.ts`、`test/master-cards.test.mjs` 使用。

### 7a — 資料形狀與驗證（core）

- `store.ts` `Task`：加 `after?: string[]`、`projects?: string[]`。Migration：可選欄位、缺省 = 舊行為，不轉換舊 store。
- `tasks.ts`：
  - 新增 `assertDependencies(board, task, after)`：每個 id 存在、與這張卡同一個 `masterId`、不是自己、不形成循環；
    錯誤碼 `INVALID_DEPENDENCY`。沒有 `masterId` 的卡給 `after` 也拒絕。
  - `projects`：只允許 master；每個路徑必須是既有資料夾（不要求 git），存絕對路徑、去重。
  - `createTaskFromInput`／`updateTaskFromInput` 接受兩個欄位；`update` 的 `after: []` 代表清除；
    改 `masterId` 時清掉不再成立的 `after`。
- `service.ts`：`vibeflow:createTask`／`updateTask` 驗證新欄位（`str` 陣列）；`deleteTask` 從兄弟卡的 `after` 移除被刪的 id；
  `TaskSummary` 多回傳 `after`、master 多回傳 `projects`。
- 測試：`test/tasks-create.test.mjs`、`test/tasks-update.test.mjs`、`test/master-cards.test.mjs` 補循環、跨 master、自己、刪除清理、`projects` 驗證。

### 7b — 提示詞與啟動指令（core）

- `slaveSystemPrompt({ canWrite, master, siblings })`：改成背景段——屬於哪張 master（id、標題）、
  兄弟卡清單（id、標題、一句話職責＝描述的第一行，截斷）、自己的 `after`。移除「照 master 指示」「完成要回報」「不開 PR」。
  `canWrite` 時只附一行：真的需要問 master 才用 `task send`。
- `buildAgentCommand()`：有 `masterId` 的卡改為 `[custom, slaveContext]`，與一般卡一致。兄弟卡資料由 service 組好、
  經 `LaunchOptions.masterContext` 傳入（launch.ts 是 types-only，不能自己讀 store）。
- `masterSystemPrompt()`：改寫成 規劃 → 寫 `$VIBEFLOW_ARTIFACTS_DIR/plan.md` → （auto mode 關）等使用者同意 → 建卡（`--after`）
  → 啟動沒有前置的卡（只在 auto mode 開）→ 結束回合。刪掉 4–6 步的回報、轉傳、驗收迴圈；保留「提到卡片寫成 `<id>「<標題>」`」
  與「全部完成時會收到通知，整理結果與 PR 連結」。
- 可讀目錄：master 的 `projects` 每個加一個 `--add-dir`（Claude 與 Codex 都加；Codex 放在 prompt 之前）。
- 測試：`test/master-cards.test.mjs` 的提示詞斷言改寫；新增 slave 指令含 custom prompt＋Library、master 指令含每個 `projects` 的 `--add-dir`。

### 7c — 通知與自動接力（core）

- `notifier.ts`：`NoteKind` 改為 `'launch_failed' | 'all_done'`；拿掉 activity 裡的 `blocked`／`turn_unreported` 追蹤與 `exited`、`reported`
  （service 端呼叫一併拿掉）。新增 `allDone(masterId)`。
- 新檔 `dependencies.ts`（純函式）：`readyDependents(board, doneId)` 回傳同一 master 底下、在 Backlog、`after` 全部在 done 欄的卡。
- `service.ts` `vibeflow:cleanupTask` 結尾：卡有 `masterId` 時——
  1. master 在 In Progress 且 `autoMode` 開 → 對每張 `readyDependents` 呼叫 `startTask`（逐張，失敗走既有 `launchError` + 通知）。
  2. master 底下全部卡都在 done → `notifier.allDone(masterId)`。
- 測試：`test/notifier.test.mjs` 改寫；`test/service.test.mjs` 以 fake backend 驗證 cleanup 後相依卡被啟動、auto mode 關時不啟動、
  全部 Done 送一則通知、權限等待不再通知。

### 7d — CLI

- `packages/cli/src/task-command.ts`：`create`／`update` 加 `--after <id>`（可重複；update 用 `--after none` 清除）；
  `--role master` 時 `--project` 改為可重複、代表相關專案（現在是報錯）；`task list` 文字輸出加「等待 <id>」，`--json` 帶 `after`。`--help` 同步。
- 測試：`test/task-cli.test.mjs` 補參數解析與錯誤碼。

### 7e — Web UI / TUI

- `renderer/components/new-task-dialog.tsx`：Master 模式左欄（工作目錄下方）加「相關專案」多選，沿用 `project-folder-picker.tsx`；
  Slave 模式不變（`after` 由 master 建，UI 只顯示不編輯——要編輯另提）。
- `renderer/components/kanban-board.tsx`：master 底下的 slave 列，Backlog 且有未完成前置時顯示「等待 <id>」，前置全完成但沒自動啟動時顯示「可開始」。
- master 工作區：Artifacts 有 `plan.md` 時在 slave 表格上方給入口（沿用 Artifacts tab 的開檔）。
- `renderer/lib/types.ts` 無需改（re-export）；`client.ts`／`api.ts` 跟著 payload 型別。
- TUI（`packages/tui/src/index.ts`）：slave 縮排列後面加「等待 <id>」；`task-form.ts` 不加 projects（以 Web UI 為準，spec 第 8 條）。

### 7f — 文件與檢查所有使用端

- AGENTS.md：「What a launch sends」（slave 不再只拿 `slaveSystemPrompt`）、「Master cards…」（`--after`、`--project` for master、
  通知只剩 launch_failed／all_done）、CLI task create 段。
- `packages/core/IPC_API_MAP.md`：`createTask`／`updateTask` payload、`task:summaries` 回傳。
- spec D2 段落加一行指向 Phase 7。
- 使用端掃描：`grep -rn "NoteKind\|slaveSystemPrompt\|masterSystemPrompt\|TaskSummary\|turn_unreported"` 全部對過。

### 方案取捨

- **在 `cleanupTask` 接力而不是 `setBoard`**：setBoard 只看得到欄位變化、不知道 base 何時同步；cleanup 結尾 base 已 sync，相依卡從含前置成果的 base 開分支。代價是只有走正式完成流程（UI 完成、master 完成對話框）的卡會觸發——直接改 store 檔移欄不會。可接受。
- **兄弟卡資料由 service 傳入**：維持 `launch.ts` types-only 的邊界（`test/core-boundary`）。
- **保留 `task send`／inbox**：成本是程式碼留著；好處是使用者仍可請 master 轉達，舊 session 不壞。

### 風險

- 正在跑的舊 master/slave session 用的是舊提示詞，會繼續 `task send` 回報；7c 拿掉 `reported` 後仍能收訊，只是不再有 `turn_unreported`。release note 說明。
- 自動接力會在無人看管時啟動 agent：只在 master auto mode 開時發生，與 D3 一致。
- 前置卡沒 merge 就 Done（只開 PR）時，相依卡的 base 不含前置成果；spec 已列為不包含（不做 stacked branch），master 規劃時要把有程式碼相依的卡寫進同一張或提醒使用者先 merge。這句寫進 master 提示詞。

### 驗證（對應 spec AC）

| AC | 驗證方式 |
| --- | --- |
| AC-1、AC-2 | 執行期：`npm start -- --store-path <tmp> --no-open --port 47831`，建 auto mode 關／開兩張 master 各跑一次 |
| AC-3、AC-7 | `node scripts/run-tests.mjs ./test/master-cards.test.mjs` |
| AC-4 | `test/service.test.mjs`（fake backend）＋ 執行期完成前置卡後觀察相依卡啟動 |
| AC-5 | `test/tasks-create.test.mjs`、`test/tasks-update.test.mjs`、`test/task-cli.test.mjs` |
| AC-6 | `test/notifier.test.mjs`、`test/service.test.mjs` |
| AC-8 | 用現有 store 複本啟動 host，看板與卡片行為不變 |
| DoD | `npx tsc --noEmit -p tsconfig.json`、`npx tsc --noEmit -p renderer/tsconfig.json`、`npm test`、`npm run build:web`、`npm run test:e2e` |

### 執行結果（2026-11-19）

- 7a–7f 依計畫完成。偏離計畫之處：
  - 自動啟動失敗時，若不是 provisioning 階段的失敗（那裡已經會退回 Backlog），`carryOnAfterDone` 會自己把卡退回 Backlog 並通知 master，避免卡停在 In Progress 卻沒有 session。
  - 看板的 slave 列：等待中的卡用「等待 <id>」取代專案名稱，不另加欄位；原本並排顯示時標題會被擠到看不見（執行期截圖發現）。
  - master 的編輯表單沒有加相關專案欄位；`vibeflow:updateTask` 已支援 `projects`，UI 編輯留待之後。
- 檢查（都已執行）：`npx tsc --noEmit -p tsconfig.json`、`npx tsc --noEmit -p renderer/tsconfig.json`、`npm test`（640 pass）、`npm run build:web`、`npm run test:e2e`（4 pass）。
- 執行期（暫存 store、`--port 47831`）：CLI 建出 master（帶 `--project`）、一張卡、一張 `--after` 卡；看板巢狀清單顯示「等待 <id>」；新增任務對話框的 Master 模式可以加入／移除相關專案，建立後 store 有 `projects`。
- 沒有驗證：真的啟動 agent 跑完整流程（AC-1、AC-2 的 agent 行為：寫 plan.md、等確認、派工後結束回合）——提示詞內容由單元測試鎖定，但模型實際照做與否沒有跑過；`plan.md` 入口按鈕需要 master 真的寫出 plan.md 才會出現，也沒有在執行期看到。
