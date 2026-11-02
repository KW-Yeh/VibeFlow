# Plan：看板與工作區分頁

- 狀態：已確認
- Spec：[spec.md](spec.md)（已確認，2026-11-02）
- 更新日期：2026-11-02
- 確認紀錄：2026-11-02 使用者指示「開始改，直接改在 main，驗收完成後 push to main and release new version」，授權依本計畫實作、在 main 上 commit、push 並發布新版本。

## 現況

- `renderer/pages/home.tsx` 持有 `view: BoardView`、`selectedTaskId`、`tabs`（`TerminalTabBar` 的分頁，存在 `vibeflow:terminal-tabs`）。`KanbanBoard` 與 `TerminalGrid` 都常駐掛載，用 `hidden` 切換。
- `renderer/components/kanban-board.tsx` 同時畫上半部（`BoardColumns` 或 `githubView`）、可拖曳分隔線（`vibeflow:board-split-px`）、下半部（分頁列＋所有已掛載的 `TaskWorkspacePanel`）。它也持有啟動狀態（`mounted`、`terminalLaunch`）與「完成／退回」確認對話框。
- 看板沒有拖曳；卡片從 Backlog 開始執行是工作區裡的「開始」按鈕（`TaskWorkspacePanel` → `onStart` → `startTask`）。
- `BoardView = 'board' | 'github' | 'terminals'`，`ViewTabs` 出現在看板、工作項目、終端機三頁的標題列；`SideMenu` 有對應三個入口。
- 工作區內部（`task-workspace-panel.tsx`）的工具列、終端機、右側資訊欄 rail 不需改動。

## 方案

保留 `KanbanBoard` 作為看板＋工作區的單一擁有者（啟動狀態、確認對話框都在這裡，拆開會讓 `terminalLaunch` 必須上移到 `home.tsx`）。它依 `view` 畫兩個常駐的區塊：

1. **看板區**（`view` 為 `board`／`github`）：`BoardColumns` 或 `githubView`，全高，移除分隔線與相關程式。
2. **工作區**（`view === 'workspace'`）：左側新元件 `WorkspaceTaskRail`＋右側原本的 `TaskWorkspacePanel` 列表。兩區用 `hidden` 切換，`TaskWorkspacePanel` 不因切頁卸載。

掛載規則：In Progress 的卡一旦掛載就常駐；其他欄位的卡只在被選中時掛載（原本「分頁開著就保留」的條件隨分頁列一起移除）。

### 檔案

| 檔案 | 改動 |
| --- | --- |
| `renderer/components/ui/view-tabs.tsx` | `BoardView` 加 `'workspace'`；`VIEWS` 在「看板」後加「工作區」 |
| `renderer/lib/view-persistence.ts` | `VIEWS` 加 `workspace`；`?task=` 沒有 view 或 view=board 時導向 `workspace`；移除 `readTerminalTabs`／`writeTerminalTabs`；新增 `clearRetiredKeys()` 刪除 `vibeflow:terminal-tabs`、`vibeflow:board-split-px`；新增左側清單收合偏好 `vibeflow:workspace-rail` 的讀寫 |
| `renderer/components/side-menu.tsx` | 「看板」下方加「工作區」入口 |
| `renderer/components/workspace-task-rail.tsx`（新） | 左側清單：In Progress 卡（Master 底下的子卡縮排）、「目前檢視」列、狀態點、`TaskProgressChip`、收合成 44px 的點列 |
| `renderer/components/kanban-board.tsx` | 移除分隔線、`tabBar`、`openTabIds`、`onTaskInteract`；依 `view` 畫看板區／工作區；空狀態文案改為「從左側選一張卡片」 |
| `renderer/pages/home.tsx` | 移除 `tabs` 與 `TerminalTabBar`；`openTab` → `openTask`（選卡＋切到工作區）；側欄「工作區」在沒有選取時選第一張進行中卡；通知「正在看這張卡」要求 `view === 'workspace'` |
| `renderer/components/terminal-tab-bar.tsx` | 刪除（沒有其他使用端） |
| `e2e/web.e2e.mjs` | 依新流程：建立／前往卡片後在工作區；用「工作區」分頁回到工作區；新增左側清單收合與重整保留的檢查 |
| `docs/features/board-workspace-split/` | 本文件；完成後記錄驗證結果 |
| `AGENTS.md` | 專案結構中 `task-workspace-panel.tsx` 的描述與「Terminal」慣例中「collapsing a card」的說法若過期則更新 |

### 修改順序

1. view 型別、URL、側欄入口（`view-tabs`、`view-persistence`、`side-menu`）。
2. `WorkspaceTaskRail` 元件。
3. `kanban-board.tsx` 拆成兩區、移除分隔線。
4. `home.tsx` 移除分頁列、接上新流程；刪除 `terminal-tab-bar.tsx`。
5. 更新 e2e。
6. 驗證（DoD）＋實際開起來看。
7. commit、push main、發版（`package.json`／`package-lock.json` 版本 +1、`chore: release vX` commit、tag `vX` 推送觸發 CI 發布）。

## 風險

- **xterm 在 `display:none` 下的尺寸**：切回工作區時要重新 fit。`TerminalGrid` 已用同樣的 `hidden` 手法，`task-terminal.tsx` 以 ResizeObserver 重算尺寸；以 AC-4／AC-5 實測確認。
- **非進行中卡的工作區改為「選取時才掛載」**：Done 卡若開了 shell，選別張卡後 shell 會結束（scrollback 由 core 保留，重開會重播）。行為與原本「關閉分頁」相同，只是觸發點改成切換選取。
- **`BoardView` 是共用型別**：`InboxView`、`TerminalGrid`、`BoardColumns`、`view-persistence` 都用到；新增值後以 typecheck 檢查所有使用端。
- **舊網址導向**：`?task=` 原本搭配看板頁使用，改導向工作區是刻意的行為變更（spec 已確認）。

## 驗證

| 驗收條件 | 方式 |
| --- | --- |
| AC-1、AC-2、AC-3 | 實際開 host（`npm start -- --store-path <tmp> --no-open --port 47831`）用瀏覽器看兩頁版面 |
| AC-4、AC-5 | e2e：開始卡片 → 切看板 → 切回工作區，終端機內容仍在、未重新啟動 |
| AC-6 | e2e：收合左側清單 → 重整 → 仍收合 |
| AC-7 | 手動：agent 進入 waiting 狀態時清單顯示標記 |
| AC-8 | 手動或 e2e：在看板點 Done 卡 → 工作區、出現「目前檢視」列 |
| AC-9 | e2e：既有「開始」流程，卡片出現在左側清單 |
| AC-10 | e2e：`?view=workspace&task=`、舊 `?task=` 兩種網址 |
| AC-11 | `npx tsc --noEmit -p tsconfig.json`、`npx tsc --noEmit -p renderer/tsconfig.json`、`npm test`、`npm run build:web`、`npm run test:e2e` |

## 驗證結果

2026-11-02，macOS：

- `npx tsc --noEmit -p tsconfig.json`、`npx tsc --noEmit -p renderer/tsconfig.json`：通過。
- `npm test`：480 個測試全部通過。
- `npm run build:web`：成功。
- `npm run test:e2e`：3 個測試全部通過。新增的檢查：建立卡片後進入工作區並列在「目前檢視」；開始後列入左側清單；切到看板再回來，終端機仍在畫面上；側欄「工作區」在沒有選取時選第一張進行中卡；從看板點 Done 卡出現「目前檢視」列、選回進行中卡後消失；左側清單收合後重整仍收合；舊的 `?task=<id>` 網址進入工作區（AC-2、AC-4、AC-5、AC-6、AC-8～AC-10）。
- 實際開 host（暫存 store，2 張 In Progress、1 張 Backlog、1 張 Done）在瀏覽器檢查：看板頁全高、無分隔線（AC-1）；工作區的工具列、終端機、右側資訊欄 rail 與原本一致（AC-3）；啟動時移除 `vibeflow:terminal-tabs`。

實作中的調整（已同步 spec）：

- 1024px 寬時，展開的左清單加上固定的右側資訊欄讓終端機只剩約 320px，工具列重疊；「預設收合」的門檻改為 1280px。
- 看板頁有選取時網址寫成 `?view=board&task=<id>`，讓「沒有 view 的 `?task=`」只代表舊網址。
- `TaskWorkspacePanel`／`TaskTerminal` 的 `onInteract`（只用來固定預覽分頁）隨分頁列一起移除。

未驗證：

- AC-7（「待確認」標記）：清單用的是工具列同一個 `TaskProgressChip` 與同一份 `progress`，但這次沒有實際讓 agent 進入等待狀態來看。
- Windows／Linux 沒有實機檢查；CI 的三平台測試會在發版 tag 推送後執行。
