# Plan：卡片訊息泡泡

- 狀態：已確認
- 對應 Spec：[spec.md](./spec.md)
- Spec 確認依據：spec.md 更新日期 2026-11-27，同日確認整份 Spec 與設計稿
- 更新日期：2026-11-27
- 確認紀錄：2026-11-27 使用者確認 Plan（含 Spec 之外的「未送達」狀態、窄面板圓點泡泡），授權開始實作

## 現有程式碼調查

| 檔案 | 現有行為、可重用模式與調查依據 |
| --- | --- |
| `packages/core/src/service.ts` `vibeflow:sendMessage`（約 1726 行） | 驗證 from／to、`NOT_RELATED`、長度上限 `MAX_MESSAGE_LENGTH = 20_000`、`NOT_RUNNING`，再呼叫 `mailbox.deliver`。目前沒有任何紀錄。 |
| `packages/core/src/mailbox.ts` | `deliver` 有兩條路。inbox 路：`postMessage` 寫檔，再由 `wake` 判斷要不要打字叫醒（agent 閒置、沒有草稿、沒有 tmux 直連才打）。type 路（Codex 或舊 session）：`waitForQuiet` 等輸入框清空、停手 3 秒，最多 120 秒，接著檢查 `isBlocked`。草稿判斷在 `drafts`，同一張卡的工作由 `enqueue` 依序執行。 |
| `packages/core/src/inbox.ts` | `postMessage` 產生遞增檔名但不回傳。`takeMessages` 把整個 inbox 改名成 `.host-*` 後讀走，不能只拿一部分。 |
| `packages/core/src/launch.ts` `INBOX_READER` | hook 先把檔案改名成 `.hook-<name>` 再讀，讀完刪掉。host 只能從「檔案不見了」推斷 hook 已經讀走。 |
| `service.ts` `createProgressTracker({ onUpdate })` | 收件卡 transcript 一有新行（包括 hook 帶入訊息後的那一輪）就會觸發 `onUpdate`，現在已經在這裡呼叫 `mailbox.poke`。拿來對帳已讀最省事，不需要再加 watcher。 |
| `service.ts` `notifier` 與額度 continue | 都用 `frameMessage(null, …)` 走同一個 mailbox。依 Spec，這兩種不記錄。 |
| `packages/core/src/chat-store.ts` | 用懶初始化的 `JsonStore`（`vibeflow-chats`）存每張卡的對話，`clearConversation` 在 `vibeflow:deleteTask` 裡呼叫。訊息紀錄照這個模式做。 |
| `service.ts` `vibeflow:deleteTask` | 依序清掉 session、progress、worktree、chat，新的紀錄清理加在 `clearConversation` 旁邊。 |
| `packages/core/src/client.ts`、`renderer/lib/api.ts` | 事件用 `t.on('progress:update', …)` 包成 `onProgressUpdate`，`api.ts` 在 bridge 不存在時回傳 no-op。新事件照做。 |
| `renderer/pages/home.tsx`、`renderer/components/kanban-board.tsx` | `home.tsx` 有頂列（看板／工作區／Issues & PRs），也用 `view` 切換頁面。看板頁和工作區頁都在 `KanbanBoard` 裡，以 `hidden` 切換。 |
| `renderer/components/task-workspace-panel.tsx` | 右側 aside 有 任務／Artifacts／Git diff 分頁，寬度可拖曳（`--vf-workspace-aside`）。泡泡要固定在這個 aside 的右下角。 |
| `renderer/components/workspace-task-rail.tsx` | 左側卡片列表，已經會顯示狀態點，未讀數加在這裡。 |
| `test/mailbox.test.mjs`、`test/service.test.mjs` | mailbox 有假 `write`／`activity` 的單元測試；service 有 `createCore` 加假 `SessionBackend` 的測試。新行為都可以在這兩層測，不必開瀏覽器。 |

## 方案與取捨

**紀錄放在新的 `card-messages.ts`。** 用懶初始化的 `JsonStore`（檔名 `vibeflow-messages`，放在 store 目錄），格式是 `{ version: 1, messages: CardMessage[] }`。每則訊息：

```ts
interface CardMessage {
  id: string                // randomUUID
  thread: { from: string; to: string }   // from = 來源卡 id；你在某組對話裡傳的訊息沿用那組的 from
  sender: { kind: 'task'; id: string; title: string } | { kind: 'person' }
  to: string                // 收件卡 id
  text: string
  sentAt: number
  state: 'unread' | 'read' | 'failed'
  via?: 'hook' | 'typed'
  readAt?: number
  inboxName?: string        // 走 inbox 時的檔名，對帳用
  error?: string            // failed 時的原因
}
```

這是全新的檔案，不碰 `vibeflow-state.json`，所以不需要 migration。`version` 欄位讓日後改格式時有東西可以判斷。我考慮過每張卡一個 jsonl 檔，但刪卡、列出所有對話時都要掃目錄，而 chat-store 已經證明一個 JsonStore 在這個量級夠用，所以採用 JsonStore。

**已讀對帳。** 改 `postMessage` 讓它回傳檔名，存進 `inboxName`。`reconcile(taskId)` 檢查收件卡 inbox 裡還有沒有這個檔名（`.hook-`、`.host-` 開頭的暫存名也算還在），不見了就標成已讀。由 host 打字送出的訊息，mailbox 透過新的 `onTyped(key, names)` 回報，標成 `via: 'typed'`；其餘不見的標成 `via: 'hook'`。`reconcile` 在三個時機執行：progress `onUpdate`、每次 deliver 或立即送之後、host 啟動時。走 type 路的訊息在 `deliver` 成功時直接標已讀，`via: 'typed'`。

**立即送進 session（mailbox 新增 `sendNow(key, upTo?)`）。**

- inbox 路：在同一個 `enqueue` 佇列裡執行。先檢查 `drafts`（有草稿就丟出 `DRAFT_PENDING`）和 `isBlocked`（`TARGET_BLOCKED`），不檢查 agent 是否閒置、也不等停手。`takeMessages(dir, upTo)` 新增 `upTo` 參數，只拿檔名小於等於 `upTo` 的訊息，接著寫入並呼叫 `onTyped`。
- type 路：訊息還在 `waitForQuiet` 裡等。新增 `hurried` 集合，`sendNow` 把卡片加進去，`waitForQuiet` 看到之後就不再等停手；但有草稿時仍然等，同時 `sendNow` 立刻回傳 `DRAFT_PENDING`，讓 UI 顯示提示。
- 這樣立即送仍然遵守 mailbox 的三條規則：不打進權限對話框、不疊在草稿上、不被其他寫入切開。

**送達失敗。** type 路的 `deliver` 會丟 `TIMEOUT` 或 `TARGET_BLOCKED`。`sendMessage` 現在就會把這個錯誤回給寄件卡，紀錄則改成 `failed` 並存下原因，對話框顯示「未送達」和原因。Spec 沒有寫到這個狀態，但不記下來的話，這則訊息會一直顯示未讀，和事實不符，所以加上。這是 Spec 之外唯一新增的可見行為。

**以「你」的身分傳訊息。** 新 handler `messages:send { to, threadFrom, text }`。`threadFrom` 必須是已有紀錄的對話，或是一張與 `to` 相關的卡；長度和空白規則跟 `sendMessage` 一樣，也要求收件卡正在執行。`frameMessage` 加上 `'person'`，輸出 `<vibeflow from="person">`。

**事件與 handler。**

- 事件 `messages:changed`，payload 是 `{ taskIds: string[] }`，表示哪幾張收件卡的對話有變動。frontend 收到後再呼叫 `messages:threads` 取摘要；對話框開著的話，再取一次 `messages:thread`。不把整份紀錄塞進事件裡。
- `messages:threads` → `{ from, to, fromTitle, toTitle, unread, last: { text, sentAt, state } }[]`。
- `messages:thread { from, to }` → `CardMessage[]`，依 `sentAt` 排序。
- `messages:sendNow { to, messageId? }`。省略 `messageId` 表示全部送；帶了就以它的 `inboxName` 當 `upTo`。
- `messages:send { to, threadFrom, text }`。
- 全部只收 task id 和 message id，照 handler table 慣例驗證參數。

**UI。** 新增三個元件，加一個 hook：

- `renderer/components/message-bubbles.tsx`：泡泡堆疊。props 有 `threads`、`focusTaskId?`。有 `focusTaskId` 時，和這張卡有關的對話排在下面並標「這張卡」，中間加分隔線。超過 4 顆時收成「+N 則對話」。
- `renderer/components/message-dialog.tsx`：對話框，照設計稿畫板 2 和 3。輸入框和送出按鈕都是 44px 高，用 `items-end` 對齊；多行時自動長高，最多 6 行。
- `renderer/components/message-center.tsx`：頂列的「訊息」按鈕和列出所有對話的 popover。
- `renderer/lib/use-card-messages.ts`：訂閱 `messages:changed`，維護 threads 狀態，處理每個瀏覽器自己的收起狀態（localStorage `vibeflow:message-bubbles-dismissed`，記錄每組對話收起時的最後一則 id，有新訊息就重新浮出；讀寫包 try/catch）。

掛載位置：看板頁在 `kanban-board.tsx` 的看板容器右下角（`fixed`）；工作區頁在 `task-workspace-panel.tsx` 的 aside 裡（`absolute bottom-4 right-4`），傳入 `focusTaskId`。兩頁一起顯示時不會重複，因為 `hidden` 會把另一頁藏起來。`workspace-task-rail.tsx` 顯示每張卡收到的未讀數。

## 預計修改

| 檔案 | 修改內容 | 對應驗收條件 |
| --- | --- | --- |
| `packages/core/src/card-messages.ts`（新增） | 紀錄的型別、JsonStore、append／update／list／thread、`deleteMessagesFor(taskId)`、`reconcile` 用的純函式 | AC-1、2、3、7、8 |
| `packages/core/src/inbox.ts` | `postMessage` 回傳檔名；`takeMessages(dir, upTo?)` 回傳 `{ name, text }[]`；新增 `inboxHas(dir, name)` | AC-3、4 |
| `packages/core/src/mailbox.ts` | `deliver` 回傳 `inboxName`；新增 `sendNow`、`hurried`、`onTyped` 選項；`frameMessage` 支援 person | AC-4、5、6 |
| `packages/core/src/service.ts` | `sendMessage` 寫紀錄並處理 failed；四個 `messages:*` handler；在 progress `onUpdate`、deliver 之後、host 啟動時 reconcile；deleteTask 清紀錄；notifier 和額度 continue 不寫紀錄 | AC-1～9 |
| `packages/core/src/client.ts` | `messageThreads`、`messageThread`、`sendMessageNow`、`sendPersonMessage`、`onMessagesChanged` | 全部 |
| `packages/core/IPC_API_MAP.md` | 新增四個 channel 和一個事件 | 工程品質 |
| `renderer/lib/api.ts` | bridge-safe 包裝 | 全部 |
| `renderer/lib/use-card-messages.ts`（新增） | 訂閱、threads 狀態、收起偏好 | AC-1、2 |
| `renderer/components/message-bubbles.tsx`（新增） | 泡泡堆疊、這張卡排序、+N | AC-1、1b、2 |
| `renderer/components/message-dialog.tsx`（新增） | 對話紀錄、狀態列、立即送、全部送、輸入框、錯誤提示 | AC-3～6 |
| `renderer/components/message-center.tsx`（新增） | 頂列按鈕、未讀總數、對話列表 | spec 行為表「頂列」那一列 |
| `renderer/pages/home.tsx` | 頂列放 `MessageCenter` | 同上 |
| `renderer/components/kanban-board.tsx` | 看板頁掛泡泡 | AC-1 |
| `renderer/components/task-workspace-panel.tsx` | aside 右下角掛泡泡並傳 `focusTaskId` | AC-1b |
| `renderer/components/workspace-task-rail.tsx` | 未讀數徽章 | AC-1b |
| `test/card-messages.test.mjs`（新增） | 紀錄 CRUD、thread 分組、刪卡清理、reconcile | AC-3、7、8 |
| `test/mailbox.test.mjs` | `sendNow`（inbox 和 type 兩條路）、草稿與權限拒絕、`upTo`、`onTyped` | AC-4、5、10 |
| `test/service.test.mjs` | sendMessage 有紀錄、`messages:send` 驗證、`NOT_RUNNING`、host 通知不記錄、刪卡清理、事件推送 | AC-1、2、6、8、9 |
| `test/README.md`、`docs/README.md`、`AGENTS.md` | 新 suite、plan 連結、訊息紀錄的一段說明 | 工程品質 |

## 實作順序

1. **core 紀錄與 inbox**：`card-messages.ts`、`inbox.ts` 的修改和 `test/card-messages.test.mjs`。驗證：`node scripts/run-tests.mjs ./test/card-messages.test.mjs`、core typecheck。
2. **mailbox**：`sendNow`、`hurried`、`onTyped`、person frame，以及 `test/mailbox.test.mjs` 新增的案例。驗證：mailbox 測試全綠，包括既有案例（AC-10）。
3. **service 與 client**：handler、reconcile 時機、刪卡、事件，`IPC_API_MAP.md`，`test/service.test.mjs`。驗證：`npm test`。
4. **renderer**：hook、三個元件、四個掛載點。驗證：renderer typecheck、`npm test`（ui-consistency）、`npm run build:web`。
5. **端到端與實機**：`npm run test:e2e`，再用拋棄式 store 開 host，照驗證計畫的手動情境走一遍並截圖。
6. **文件**：AGENTS.md、test/README.md、本 plan 的實作紀錄。

## 風險與依賴

- **hook 讀走和 host 打字同時發生。** 兩邊都用 rename 搶檔案，只有一邊會成功，所以訊息不會送兩次。對帳時 `.hook-*` 和 `.host-*` 都算還在，等真正刪掉才判定已讀，避免先標錯。
- **舊 session 沒有 inbox。** 走 type 路的訊息在 host 記憶體裡排隊。host 重啟後這些排隊會消失，但紀錄還留著 unread。啟動對帳時，找不到 inbox、又不在 mailbox 佇列裡的 unread 訊息改成 failed，原因寫「host 重啟，訊息未送達」。
- **立即送時 agent 正在工作。** 打進去的字會進 Claude Code 自己的輸入佇列。這是 Spec 寫明的行為，但各版 CLI 處理方式可能不同；實機驗證時會在 agent 工作中測一次並記錄結果。
- **Codex 不偵測權限對話框。** 對 Codex 卡片立即送時擋不住打進權限對話框。這個限制 Spec 已經寫了，UI 不另外提示。
- **JsonStore 每次寫入都重寫整個檔。** 紀錄保留到刪卡為止，檔案會一直長大。以每則幾百 bytes 估算，一萬則大約幾 MB，寫入還可以接受。之後真的變慢再改成 jsonl，不在這次處理。
- **工作區 aside 很窄時**，泡泡寬 300px 可能蓋住大半內容。aside 寬度小於 360px 時，泡泡改成只顯示圓點加未讀數，點了一樣打開對話框。

## 驗證計畫

| 檢查 | 命令或操作 | 對應驗收條件 |
| --- | --- | --- |
| core typecheck | `npx tsc --noEmit -p tsconfig.json` | 工程品質 |
| renderer typecheck | `npx tsc --noEmit -p renderer/tsconfig.json` | 工程品質 |
| 單元與 service 測試 | `npm test` | AC-3、4、5、6、7、8、9、10 |
| Web UI build | `npm run build:web` | 工程品質 |
| E2E | `npm run test:e2e` | AC-10、transport 與 handler table |
| 實機：泡泡出現與累加 | `npm start -- --store-path <tmp> --no-open --port 47831`，建一張 master 和一張子卡並啟動，在 master shell 跑兩次 `task send`，再從另一張卡送一次 | AC-1、2 |
| 實機：任務詳情頁 | 打開收件卡的工作區，確認泡泡在 aside 右下角、標「這張卡」、terminal 沒被蓋住、rail 有未讀數，截圖 | AC-1b |
| 實機：已讀對帳 | 等 agent 用一次工具，對話框不重新整理就變成「已讀 · hook 帶入」 | AC-3 |
| 實機：立即送 | agent 工作中按「立即送進 session」，terminal 立刻出現訊息、狀態變「打進 terminal」；在收件卡 terminal 先打幾個字不送出，再按一次，確認被拒絕且沒有字打進去 | AC-4、5 |
| 實機：你傳的訊息 | 在對話框輸入並送出，確認 agent 收到 `<vibeflow from="person">`；檢查輸入框和送出按鈕並排對齊，截圖 | AC-6 |
| 實機：重啟與刪卡 | `vibeflow shutdown` 後重開，紀錄還在；刪掉收件卡後泡泡消失 | AC-7、8 |

## 待確認事項

- 無

## 實作與驗證紀錄

尚未實作。
