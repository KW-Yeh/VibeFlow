# Terminal Tabs — 實作計劃

在右側工作區上方加入 VSCode 風格的分頁列，快速切換已開啟的 task terminal。

## 已確認的決策

| 項目 | 決定 |
|---|---|
| 關閉分頁 | `in_progress` 的 panel 留在 DOM、**PTY 繼續跑**；其他欄位的 panel 直接 unmount（PTY 收掉、兩個 3s 輪詢停掉）。scrollback 由 main 保留，重開分頁會 replay |
| 分頁列位置 | 只在右側工作區上方（`home.tsx` 右欄，`KanbanBoard` 之上），side menu 維持全高 |
| 持久化 | session-only，**不動 electron-store schema** |
| 固定（pin）觸發 | terminal 打字、double click 分頁、切換 Plan/Diff/Artifacts 內容 tab、拖檔案進 terminal、按 Start／重開 Terminal 等 action 按鈕 |

## 現況（改動前）

- `home.tsx` 持有 `selectedTaskId`，決定右側顯示哪個 task。
- `kanban-board.tsx` 的 `mounted: Set<string>` 只增不減 — 開過的 `TaskWorkspacePanel` 永遠留在 DOM，靠 `WorkspaceSurface` 的 `hidden` 切換可見性。
- `task-terminal.tsx` 的 unmount cleanup 會 `term.kill(sessionKey)`。
- 每個 mounted panel 各跑**兩個 3 秒輪詢**（`listArtifacts` 與 git diff），隱藏時照跑。
- `killSession` 不清 `scrollbacks` map，所以殺掉 PTY 不會弄丟看得到的歷史。

→ 分頁列改成 render gate：`mounted` ∩（有開分頁 ∪ `in_progress`），selected 一律加回。

## 分頁狀態機

```ts
interface TerminalTab {
  taskId: string
  /** true = VSCode 的「暫時分頁」（斜體），會被下一個暫時分頁就地取代 */
  preview: boolean
}
```

狀態放 `home.tsx`：`const [tabs, setTabs] = useState<TerminalTab[]>([])`

| 操作 | 行為 |
|---|---|
| `openTab(id)`（side menu 選任務 / 點分頁） | 已存在 → 只切 `selectedTaskId`；不存在 → 若已有 preview 分頁就**就地取代**（保留索引位置），否則 append |
| `openTab(id, { pin: true })`（建立新任務） | 新分頁直接是固定分頁 |
| `pinTab(id)` | `preview = false`（double click 或任一互動觸發） |
| `closeTab(id)` | 移除分頁；若關的是當前選取 → 選右邊鄰居，沒有就選左邊，都沒有 → `selectedTaskId = null`（回到 NewTaskForm） |

## 檔案改動

1. **新增** `renderer/components/terminal-tab-bar.tsx`
   - 橫向可捲動的分頁列；preview 分頁標題用斜體
   - 每個分頁：任務標題（truncate）、關閉 X、middle-click 也可關
   - `onSelect` / `onClose` / `onPin`(dblclick)
   - 沒有任何分頁時 render `null`（不佔高度）
   - 樣式吃 shadcn token + radius ladder（`test/ui-consistency.test.mjs` I1–I3 會掃）

2. `renderer/pages/home.tsx`
   - `tabs` state + `openTab` / `pinTab` / `closeTab`
   - `onSelectTask` 改走 `openTab`
   - `handleCreateTask` 成功後 `openTab(task.id, { pin: true })`
   - `handleDeleteTask` / `confirmDeleteProject` 一併移除對應分頁
   - 在 `KanbanBoard` 上方渲染 `<TerminalTabBar>`

3. `renderer/components/kanban-board.tsx`
   - 新增 `onTaskInteract?: (taskId: string) => void` prop，傳給每個 `TaskWorkspacePanel`

4. `renderer/components/task-workspace-panel.tsx`
   - 新增 `onInteract?: () => void`
   - 呼叫點：內容 tab 切換、Start / Complete / Edit 等 action 按鈕、往下傳給 `TaskTerminal`

5. `renderer/components/task-terminal.tsx`
   - 新增 `onInteract?: () => void`，用 `onInteractRef` 保存
     （init effect 的 deps 是 `[taskId, sessionKey, ...]`，不能因為 callback 變動而重跑 → 會 dispose buffer + 重開 shell）
   - 呼叫點：`term.onData`（打字）、`handleFileDrop`、`openFreshInteractiveShell`

## 邊界情況

- 刪除任務 / 刪除專案 → 對應分頁自動移除
- 關掉所有分頁 → 回到 inline NewTaskForm
- 分頁被關掉後再從 side menu 點回來 → 新開 preview 分頁，scrollback 完整（panel 沒 unmount 過）
- 任務標題被編輯 → 分頁標題跟著更新（分頁只存 `taskId`，標題從 `board` 查）

## Definition of Done

1. `npx tsc --noEmit -p renderer/tsconfig.json`
2. `npm test`（含 `ui-consistency`）
3. `cd renderer && NODE_ENV=production npx next build`
4. 實際跑 `npm run dev` 驗：preview 取代、double click 固定、打字固定、關閉不中斷 agent
