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
