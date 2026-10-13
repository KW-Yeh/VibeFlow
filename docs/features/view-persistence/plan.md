# View persistence — plan

狀態：已實作（feat/view-persistence）。

刷新網頁後保留：目前檢視、終端機網格、看板分頁與選中卡片、工作項目篩選。

## 現況（調查結果）

- 終端機網格清單（`gridTerminals`）只在 `renderer/pages/home.tsx` 的 React state。
- 刷新時 React 不跑 unmount cleanup，所以 `termKill` 不會送出，core 端的 session 仍活著；
  `terminal:start` 用同一個 `terminal_<uuid>` 再呼叫一次就會接回並帶回 scrollback。
  → 問題只在「前端忘了清單」，以及刷新／關分頁後這些 session 變成孤兒，沒人回收。
- `view`、`tabs`、`selectedTaskId`、`githubFilters`、`inboxTab` 都是 session-only state。

## 存放位置

| 資料 | 存放 | 理由 |
|---|---|---|
| 終端機網格（key、標題、目錄、taskId） | **core store**（`VibeFlowState.terminals`） | 這些 session 本來就歸 core 管，屬於 session 的 metadata；所有前端共用，也才能回收孤兒 |
| 目前檢視、選中卡片 | URL query：`/home/?view=terminals&task=<id>` | 可刷新，也可以分享網址 |
| 看板開著的分頁、Issues/PRs 分頁、篩選條件 | `localStorage` | AGENTS.md 規定 core 不碰 UI 概念（選中分頁、展開卡片），所以不放 core；這跟既有的 split／aside 尺寸存法一致 |

## 階段

1. **Core：terminal registry**
   - `store.ts`：`VibeFlowState.terminals?: StandaloneTerminalEntry[]`（`sessionKey`、`title`、`projectPath`、`taskId?`）。
     Migration：以欄位為準，跟 `recentProjects` 一樣，沒有就補 `[]`，不升版號。
   - `service.ts`：
     - `terminal:start` 接受 `title`，並寫入或更新 entry。
     - 新增 `terminal:rename`。
     - 對 standalone key 執行 `pty:kill` 時移除 entry。
     - 刪除 task 時一併移除並 kill 它的網格 terminal（現在不會處理）。
   - ~~Host 啟動時對帳，kill store 裡沒有的 `terminal_*` session~~：**實作時撤回**。tmux 的 `-L vibeflow` socket 由所有 profile／store 共用，對帳會誤殺另一個 store 的終端機；而每個終端機都記在 store 之後，原本的孤兒來源（前端忘了清單）已經不存在。store 有但 session 已死的 entry 保留，下次掛載時在同目錄開新 shell（pty 後端在 host 重啟後就是這種情況）。
   - 實作時追加：pty 後端的 `terminal:start` 遇到還活著的 session 改成直接接回（原本會砍掉重開 shell）；`pty:kill` 對格式正確但還沒登記的 `terminal_` key 不再報錯（還在啟動中就關掉的 pane）。
   - `client.ts`、`renderer/lib/api.ts`、`IPC_API_MAP.md`。
   - 測試：`test/service.test.mjs` 涵蓋新增、改名、關閉、刪除 task、pty 接回、未登記 kill。
2. **Renderer：網格改讀 store**
   - `home.tsx` 從 `state.terminals` 取網格清單（`loadState` 和 `onStateChanged` 都一樣），開、改名、關閉都改走 core。
   - 改名在 blur 或 debounce 時才寫入，不要每個按鍵都寫一次 store。
   - 多個視窗同步：在一個視窗關掉 pane，其他視窗收到 state 後 unmount，而且不再重複 kill。
3. **Renderer：URL 與 localStorage**
   - `renderer/lib/view-persistence.ts`（取代原計劃的 `useViewUrl` hook）：初始化時讀 `view`／`task`，之後用 `history.replaceState` 寫回（不用 Next router，避免整頁重新掛載把 terminal 砍掉）。
   - `tabs`、`inboxTab`、`githubFilters` 寫入 `localStorage`；讀取時全部包在 try/catch，資料壞掉就回到預設值；已不存在的 task 由既有的 effect 濾掉。
4. **文件**：`docs/features/view-persistence/spec.md`、`terminal-grid/spec.md` 最後一條改寫、`docs/README.md`。
5. **驗收**：兩個 tsconfig、`npm test`、`npm run build:web`、`npm run test:e2e`（新增一個「開 terminal → reload → 仍在且有 scrollback；URL view 正確」的案例），再用 `--store-path <tmp>` 實際操作一遍。

## 驗證結果

- `npx tsc --noEmit -p tsconfig.json`、`npx tsc --noEmit -p renderer/tsconfig.json`：clean
- `npm test`：全過；`test/service.test.mjs` 新增 registry、reattach、key 重用、刪卡、未登記 kill 的案例
- `npm run build:web`、`npm run test:e2e`：全過；terminal-grid e2e 新增 reload 案例
- 真實 host（tmux）：開 shell → `echo $$` → 刷新 → 同一個 pid、輸出還在；關閉 → tmux session 結束、store 清空；`?view=github` 和 PR 子分頁刷新後保留
- 沒有在真實 node-pty 後端下手動驗證（只有 unit test 覆蓋）
