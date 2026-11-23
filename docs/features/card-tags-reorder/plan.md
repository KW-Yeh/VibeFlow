# Plan：卡片排序與狀態標籤

- 狀態：已確認（2026-11-23）
- 對應 Spec：[spec.md](./spec.md)
- Spec 確認依據：2026-11-23 已確認（「確認，寫 plan」），待確認事項採預設值
- 更新日期：2026-11-23
- 確認紀錄：2026-11-23 使用者：「確認，開始實作」

## 現有程式碼調查

| 檔案或專案 | 現有行為、可重用模式與調查依據 |
| --- | --- |
| `packages/core/src/store.ts` | 卡片順序就是 `board.backlog / in_progress / done` 陣列順序。`JsonStore` 每次 `get` 都重讀檔案（`json-store.ts:30`），所以 CLI 直接寫 store 不會被 host 的快取覆蓋。`migrateStore` 依「欄位是否存在」補預設值（`recentProjects`、`terminals` 的寫法），不用版號判斷。看板寫入共有 7 處：`store.ts` 的 `setBoard / addTask / updateTask / removeTask` 與 `tasks.ts:262 / 325 / 468`。 |
| `packages/core/src/service.ts:302` `validBoard` | `vibeflow:setBoard` 只接受已知卡片，欄位一律取自 store 現值（只採用前端的 `launchedAt`）。因此前端送來的 tag 會被忽略，tag 由 core 擁有，這是可重用的保護。 |
| `renderer/components/kanban-board.tsx:313-340` | 完成卡片時，前端先 `setBoard` 把卡移到 Done，再呼叫 `vibeflow:cleanupTask`。所以「進 Done」至少有兩條路：前端的 `setBoard`，以及 CLI 的 `task update --status done` / `task create --status done`。 |
| `renderer/components/board-columns.tsx:642-720` | 看板用原生 HTML5 拖拉。`<section>` 層的 `onDragOver / onDrop` 只處理跨欄，`cardMove(from, to)` 對同欄回傳 `null`（`renderer/lib/board-moves.ts`），所以目前同欄無法放下。`visible(column)` 會濾掉巢狀子卡（顯示在 master 卡內）與篩選條件外的卡。卡片選單用同檔案的 popover（`board-columns.tsx:74-130`）。 |
| `renderer/components/workspace-task-rail.tsx` | 依 `running`（In Progress 欄順序）顯示卡片，`orderRunning` 把子卡排在自己的 master 底下。目前沒有拖拉。 |
| `packages/cli/src/task-command.ts` | `create / update / artifact` 直接寫 store（`resolveStorePath`，在卡片 shell 內預設 `VIBEFLOW_STORE_DIR`）；`start / list / show / send` 透過 host（`HOST_COMMANDS`）。未知 flag 一律拒絕。`packages/cli/src/main.ts:357` 分派 `task`。 |
| `packages/core/src/service.ts:192` `TaskSummary` | `task list / show` 的輸出形狀，可加 tag 名稱。 |
| `test/core-boundary.test.mjs:76` | `RENDERER_SAFE` 列出 renderer 可在執行期 import 的 core 模組（目前有 `effort.ts`，不 import 任何東西）。 |
| `renderer/styles/globals.css`、`docs/DESIGN.md` §Colors | 已有 `--warning`、`--success`、`--master`、`--destructive` 狀態色，以及 DESIGN.md 的裝飾貼紙色（sky、purple、pink、orange、teal、green、brown）。 |
| `packages/tui/src/index.ts:372` | 卡片列以 `truncate(mark+role+title)` 顯示。 |
| `packages/core/src/service.ts:1743` | host 監看 store 目錄，檔案變了就推 `state:changed` 給所有前端。CLI 寫入後畫面自動更新，不需要額外處理。 |

## 方案與取捨

### 資料形狀（會留存，需要 migration）

- `VibeFlowState.tags?: TagDef[]`，`TagDef = { id: string; name: string; color: TagColor }`。`id` 是 `tag_<8 碼>`，名稱可以改，所以卡片存 id 而不是名稱。
- `Task.tags?: string[]`：tag id 的有序清單，沒有 tag 時不寫這個欄位。
- `TagColor` 是固定色名：`gray | red | orange | amber | green | teal | blue | purple`。
- migration：在 `migrateStore` 加 `if (!store.has('tags')) store.set('tags', [])`，與 `terminals` 相同寫法，不升版號。舊卡沒有 `tags` 欄位就等於沒有 tag。
- `getState()` 回傳 `tags`。`VibeFlowState` 是前端共用的契約，`client.ts`、`renderer/lib/types.ts` 和 TUI 都要檢查。

### 「Done 沒有 tag」由 store 統一保證

我不在每條「進 Done」的路徑各自清 tag，而是在 store 層加一個 `writeBoard(store, board)`，寫入前移除 `done` 欄所有卡的 `tags`。上面列的 7 處看板寫入全部改用它。

- 理由：進 Done 的路徑有前端 `setBoard`、CLI `--status done`，以後可能還有更多；只靠呼叫端記得清，一定會漏。這條規則變成資料寫入的不變式後，新路徑自動遵守，測試也只要測一個函式。
- 「拉回後不恢復 tag」自然成立，因為 Done 時就已經刪掉了。

### 排序：專用的單卡移動

- 新增 core 函式 `moveTaskInColumn(board, taskId, beforeId | null)`：只在卡片所在欄內移動，`beforeId` 為 `null` 時移到欄尾；`beforeId` 必須在同一欄，否則報 `INVALID_MOVE`。
- handler `vibeflow:moveTask { taskId, beforeId }`。我不用 `vibeflow:setBoard`：它送的是整個看板快照，會覆蓋 CLI 或其他前端剛做的變更，也就是 spec 的「同時改了看板」情境。
- 看板與工作頁清單都讀同一個欄陣列，順序自然一致（AC-2）。
- master 群組：看板把子卡畫在 master 卡內，工作頁清單由 `orderRunning` 把子卡排在 master 下。所以「拖 master 時子卡跟著走」只要移動 master 一張卡即可，兩邊顯示都會跟上。子卡只能放在同一個 master 的另一張子卡前後，由前端限制放置目標，core 不另外驗證（子卡在陣列中的位置只影響它在群組內的順序）。
- 有篩選條件時，前端以「放下位置後面那張可見卡」作為 `beforeId`，被篩掉的卡相對順序不變。

### Tag 操作集中在 core 的 `tags.ts`

新增 `packages/core/src/tags.ts`，所有操作都收一個 store 參數（同 `tasks.ts` 的 `storePath` 寫法），handler 和 CLI 共用：

- `createTag(store, { name, color? })`：名稱 trim 後不可空，不分大小寫不可重複（`TAG_EXISTS`）；沒給顏色時取調色盤中目前使用次數最少的第一個顏色。
- `updateTag(store, ref, { name?, color? })`、`deleteTag(store, ref)`：刪除時同一次寫入把 id 從所有卡片的 `tags` 拿掉。
- `setTaskTags(store, taskId, { add?: string[]; remove?: string[]; color? })`：`add` 接受名稱或 id，名稱不存在就建立；Done 的卡拒絕（`TASK_DONE`）；不重複加入。
- `ref` 解析：先比對 id，再以不分大小寫比對名稱；找不到回 `UNKNOWN_TAG`。
- `TAG_COLORS` 放在新檔 `packages/core/src/tag-colors.ts`（不 import 任何東西），加進 `RENDERER_SAFE`，讓 core 驗證與 renderer 的調色盤共用同一份清單。

替代方案：在 UI 端用 `vibeflow:updateTask` 改 tag。不採用，因為該 handler 只允許改 Backlog 卡，而且 tag 名稱與 id 的解析會散到前端和 CLI 兩邊。

### Handler table（新增）

| 頻道 | payload | 回傳 |
| --- | --- | --- |
| `vibeflow:moveTask` | `{ taskId, beforeId: string \| null }` | state |
| `tags:create` | `{ name, color? }` | state |
| `tags:update` | `{ tagId, name?, color? }` | state |
| `tags:delete` | `tagId` | state |
| `vibeflow:setTaskTags` | `{ taskId, add?: string[], remove?: string[] }` | state |

每個都用 `requireTask` / `str` / `obj` 驗證，寫入後 `bus.emit('state:changed', …)`。

### CLI

- `task tag --task <id> [--add <name|id>]… [--remove <name|id>]… [--color <c>]`、`task move --task <id> (--before <id> | --after <id> | --top | --bottom)`：放在 `task-command.ts`，直接寫 store，不在 `HOST_COMMANDS` 裡，host 沒在跑也能用。`--task` 在卡片 shell 內預設為 `VIBEFLOW_TASK_ID`。`--after X` 轉成「X 的下一張」作為 `beforeId`。
- `vibeflow tag list | create | update | delete`：新增 `packages/cli/src/tag-command.ts`，在 `main.ts` 分派，`--store-path / --profile` 解析沿用 `resolveStorePath`。
- `TaskSummary` 加 `tags: string[]`（名稱），`task list / show` 會帶出來。

### Renderer

- `renderer/components/task-tags.tsx`（新增）：
  - `TagChips`：小型彩色標籤，超出時顯示「+N」，用在看板卡片、工作頁清單（展開時）和工作區 header。
  - `TagPicker` popover：列出所有 tag，勾選即套用或移除；輸入框打新名稱按 Enter 就建立並套用；每列有「編輯」，可改名、換色、刪除（刪除先確認）。
- 入口：看板卡片既有的「⋯」選單加「標籤…」項目，工作區 toolbar 加一個標籤按鈕。Done 卡不顯示這些入口。
- 顏色：`globals.css` 新增 `--tag-gray … --tag-purple` 8 個 token，取自 DESIGN.md 的貼紙色與既有狀態色（amber 用 `--warning`、red 用 `--destructive`、green 用 `--success`、purple 用 `--master`、blue 用 sky、teal、orange，gray 用 ash），並在 `@theme` 建立對應的 `--color-tag-*`。標籤樣式為 `bg-tag-x/15 text-tag-x`，DESIGN.md 補一段「Tag colours」。
- 看板同欄排序：卡片的 `onDragOver` 依游標落在卡片上半或下半決定插入位置，畫出插入線；`<section>` 的 `onDrop` 在 `dragging.from === column` 時改呼叫 `moveTask`，不走 `cardMove`。跨欄行為不變，`board-moves.ts` 不動。前端先樂觀更新本地順序，再以 handler 回傳的 state 為準。
- 工作頁清單：展開狀態下列可拖拉，規則同上；子卡只接受同一個 master 的子卡作為放置目標；收合狀態不提供拖拉。
- `renderer/lib/api.ts` 加 `moveTask / createTag / updateTag / deleteTag / setTaskTags` 包裝（bridge 不存在時 no-op 或回傳 null）。

### TUI

`index.ts` 卡片列在標題後加 `[tag1, tag2]` 文字（套用 `truncate`）；不提供編輯。

## 預計修改

| 檔案 | 修改內容 | 對應驗收條件 |
| --- | --- | --- |
| `packages/core/src/tag-colors.ts`（新增） | `TAG_COLORS`、`TagColor`，不 import 任何東西 | AC-5 |
| `packages/core/src/store.ts` | `TagDef`、`Task.tags`、`VibeFlowState.tags`；`writeBoard` 清除 Done 的 tag；`migrateStore` 補 `tags`；`getState` 回傳 `tags`；`moveTaskInColumn` | AC-1, AC-8, AC-11 |
| `packages/core/src/tasks.ts` | 3 處看板寫入改用 `writeBoard` | AC-8 |
| `packages/core/src/tags.ts`（新增） | tag CRUD、`setTaskTags`、ref 解析 | AC-5 ~ AC-7, AC-9 |
| `packages/core/src/service.ts` | 5 個新 handler；`TaskSummary.tags` | AC-1 ~ AC-10 |
| `packages/core/src/client.ts` | 對應的 bridge 方法與型別 | 同上 |
| `packages/core/IPC_API_MAP.md` | 補新頻道 | 工程品質 |
| `packages/cli/src/task-command.ts`、`packages/cli/src/tag-command.ts`（新增）、`packages/cli/src/main.ts` | `task tag`、`task move`、`tag …` 與 help 文字 | AC-9, AC-10 |
| `packages/tui/src/index.ts` | 卡片列顯示 tag | 待確認事項的預設值 |
| `renderer/lib/types.ts`、`renderer/lib/api.ts` | re-export 型別、API 包裝 | — |
| `renderer/components/task-tags.tsx`（新增） | `TagChips`、`TagPicker` | AC-5 ~ AC-7 |
| `renderer/components/board-columns.tsx`、`kanban-board.tsx`、`renderer/pages/home.tsx` | 同欄拖拉排序、卡片顯示 tag、選單入口 | AC-1, AC-4, AC-5 |
| `renderer/components/workspace-task-rail.tsx` | 拖拉排序、顯示 tag | AC-2, AC-3 |
| `renderer/components/task-workspace-panel.tsx` | toolbar 的標籤按鈕與標籤顯示 | AC-5 |
| `renderer/styles/globals.css`、`docs/DESIGN.md` | tag 色彩 token 與說明 | AC-5 |
| `test/core-boundary.test.mjs` | `RENDERER_SAFE` 加 `tag-colors.ts` | 工程品質 |
| `test/tags.test.mjs`（新增）、`test/service.test.mjs`、`test/task-cli.test.mjs` | 見驗證計畫 | AC-1, AC-6 ~ AC-11 |
| `e2e/web.e2e.mjs` | 同欄拖拉與貼 tag 的流程 | AC-1, AC-5, AC-8 |
| `AGENTS.md`、`test/README.md`、`docs/README.md` | CLI 說明、新測試、plan 連結 | 工程品質 |

## 實作順序

1. **Core 資料與規則**：`tag-colors.ts`、`store.ts`（型別、`writeBoard`、migration、`moveTaskInColumn`）、`tasks.ts` 改用 `writeBoard`、`tags.ts`。寫 `test/tags.test.mjs`。驗證：core tsc + `npm test`。
2. **Handler 與 client**：`service.ts`、`client.ts`、`IPC_API_MAP.md`；在 `service.test.mjs` 補 handler 測試（包括 `setBoard` 移到 Done 會清 tag、前端送的 tag 被忽略）。驗證同上。
3. **CLI 與 TUI**：`task tag`、`task move`、`tag …`、`TaskSummary.tags`、TUI 顯示；補 CLI 測試。驗證：`npm test`，再對 throwaway store 手動跑一次指令。
4. **Renderer**：色彩 token、`task-tags.tsx`、看板同欄排序、工作頁清單排序、各處入口。驗證：renderer tsc + `npm test`（ui-consistency）+ `npm run build:web`。
5. **E2E、文件、實機檢查**：`e2e/web.e2e.mjs`、AGENTS.md、`test/README.md`；跑 `npm run test:e2e`，再用 throwaway store 起 host，在 Web UI 實際操作並截圖。

每個階段結束先停下來給你看 diff，你同意後才 commit。

## 風險與依賴

- **前端整份 `setBoard` 的競態**：既有的跨欄移動仍走整份看板快照，可能覆蓋 CLI 剛做的排序（tag 不受影響，因為 `validBoard` 只取 store 的 tag）。這是現況就有的問題，本次不擴大範圍去改；排序本身走 `moveTask`，不會引入新的競態。
- **HTML5 拖拉與 framer-motion `layout` 動畫並存**：放下後的重排動畫可能閃一下。用 e2e 與實機檢查確認，必要時拖拉期間停用 layout 動畫。
- **E2E 的原生拖拉**：Playwright 的 `dragTo` 對 HTML5 DnD 時好時壞。不穩時改成在測試裡派送 `dragstart / dragover / drop` 事件。
- **契約變更**：`VibeFlowState`、`Task`、`TaskSummary` 新增選填欄位，舊前端讀到不認得的欄位不會壞；TUI 和 Web UI 都在本次一起更新。
- **舊版 binary 寫回 store**：舊版本不認得 `tags` 欄位，寫回時可能把它丟掉。這就是 migration 依「欄位是否存在」判斷、而不是依版號的原因；丟掉時只是 tag 消失，不會讓資料損壞。
- 不需要新增套件。

## 驗證計畫

| 檢查 | 命令或操作 | 對應驗收條件 |
| --- | --- | --- |
| Core 型別 | `npx tsc --noEmit -p tsconfig.json` | 工程品質 |
| Renderer 型別 | `npx tsc --noEmit -p renderer/tsconfig.json` | 工程品質 |
| 單元測試 | `npm test`：`moveTaskInColumn` 前、中、尾與跨欄拒絕；`writeBoard` 清除 Done 的 tag；migration 補 `tags`；tag 名稱重複與大小寫、改名、刪除時同步移除卡片上的 tag；`setTaskTags` 自動建立 tag、拒絕 Done 卡；handler 驗證；CLI 對 store 的寫入與錯誤碼；core-boundary、ui-consistency | AC-1, AC-6 ~ AC-11 |
| 建置 | `npm run build:web` | 工程品質 |
| E2E | `npm run test:e2e`：同欄拖拉後重新整理順序仍在；貼 tag、完成卡片後 tag 消失 | AC-1, AC-5, AC-8 |
| 實機 | `npm start -- --store-path <tmp> --no-open --port 47831`：照 AC-1 ~ AC-10 逐條操作；在 host 開著時跑 `task tag` / `task move`，確認畫面自動更新；截圖存成 artifact | AC-1 ~ AC-10 |
| 舊 store | 複製一份沒有 `tags` 的 store JSON 到 throwaway 目錄並啟動，確認載入正常、順序不變 | AC-11 |

## 待確認事項

無。

## 實作與驗證紀錄

2026-11-23，分支 `feat/card-tags-reorder`。

### 與方案的差異

- `moveTaskInColumn` 放在新檔 `packages/core/src/board-order.ts`（只有 type import，加進 `RENDERER_SAFE`），`store.ts` re-export。renderer 用它做樂觀更新，不用另寫一份。
- renderer 以 `renderer/lib/tag-colors.ts`、`renderer/lib/board-order.ts` 轉出 core 模組，與 `renderer/lib/effort.ts` 同樣做法。
- tag 狀態用 `TagsProvider`（React context，`components/task-tags.tsx`）傳給看板、工作頁清單與工作區，不逐層傳 props。
- 工作區 toolbar 只放標籤按鈕（hover 顯示 tag 名稱），不放標籤：實測 1440 寬時標籤把分支 chip 擠到 51px。標籤顯示在工作頁清單與任務分頁。
- renderer 沒有 `createTag` 包裝：UI 新增 tag 一律走 `setTaskTags` 的「名稱不存在就建立」。`tags:create` handler 仍在，供其他前端使用。
- 原計畫每個階段停下來給 diff 再 commit；實際一路做完，最後一次給 diff。

### 檢查結果

| 檢查 | 結果 |
| --- | --- |
| `npx tsc --noEmit -p tsconfig.json` | 通過 |
| `npx tsc --noEmit -p renderer/tsconfig.json` | 通過 |
| `npm test` | 657 / 657 通過（新增 `test/tags.test.mjs` 11 例，`service.test.mjs` 3 例，`task-cli.test.mjs` 3 例） |
| `npm run build:web` | 通過 |
| `npm run test:e2e` | 5 / 5 通過（新增「cards reorder within a column and carry tags until Done」） |

### 實機（throwaway store，`npm start -- --store-path <tmp> --no-open --port 47831`）

- AC-2 / AC-3：工作頁清單拖拉（以 DragEvent 驅動）：Run One 拖到最上；Master plan 拖到最上，兩張子卡跟著；Sub2 拖到 Sub1 之後；子卡拖到群組外被忽略。store 的 In Progress 順序與畫面一致。
- AC-5 / AC-6：工作區 picker 輸入新名稱 Enter 後建立並套用；改名加換綠色後，工作頁清單與任務分頁立刻更新。
- AC-9 / AC-10：host 開著時在卡片 shell 環境跑 `task tag --add`、`tag delete`、`task move --top`，畫面自動更新。
- AC-8：工作區「完成並清理」後，store 中該卡沒有 `tags`，全域清單仍保有 tag。
- AC-11：由 `test/tags.test.mjs`（沒有 `tags` 欄位的 v4 store）涵蓋；沒有另外拿真實舊 store 實測。

### 未驗證與限制

- 瀏覽器自動化的滑鼠拖拉不會觸發 HTML5 DnD，所以工作頁清單的拖拉是以派送 DragEvent 驗證，看板的同欄拖拉則由 Playwright `dragTo` 驗證。真人滑鼠拖拉的手感（插入線、放下時的動畫）沒有實測。
- 「按住刪除」tag 的 UI 沒有實際按住測試（沿用既有 `HoldButton`），刪除行為由 CLI 與單元測試驗證。
- TUI 的 tag 顯示只經型別檢查與既有 TUI 測試，沒有實際開 TUI 看。
- 既有的跨欄拖拉仍整份覆寫看板，可能蓋掉 CLI 同時做的排序（見「風險與依賴」），本次未處理。
