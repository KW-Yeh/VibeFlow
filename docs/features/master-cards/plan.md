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
