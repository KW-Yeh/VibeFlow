# VibeFlow 核心拆分與多前端遷移計劃書

Sep 30, 2026 · @KW

> 原文與圖表在 Claude Docs：https://claude.ai/code/artifact/ac11e1b5-2e55-4963-9f29-d162259f6281 （此檔為 2026-10-01 的匯出快照）

> **狀態：已完成。** core 已抽成 `packages/core`（`15a6c4d`），Electron 桌面版已移除（`8e78126`，2026-10-01）。
> 本文件保留為決策記錄；現行架構、指令與慣例以 [AGENTS.md](../../AGENTS.md) 為準。
> 文末「待決事項」中的 npm 套件名稱已定為 `@kw-yeh/vibeflow`；其餘未勾選項目維持原文。

## 背景與目標

本計畫把 VibeFlow 的業務邏輯抽成與 UI 無關的 `@vibeflow/core`，再以本機 Web UI 與終端機 TUI 兩個輕量前端取代 Electron 作為主要發布形式，使用者透過 `npx vibeflow` 即可使用，不再經過 Gatekeeper。

**現況（v3.1.0）**

- 架構為 nextron（Electron + Next.js），`app/main.js` 為進入點，業務邏輯位於 `main/helpers/`。
- macOS 版僅做 ad-hoc 簽章、未公證，首次開啟會被 Gatekeeper 攔下，需右鍵打開或執行 `xattr`。
- 支援 claude 與 codex 兩種 agent，任務有 developing / reviewing / revising / approved / blocked 的 pipeline 階段。
- 已有部分解耦的基礎：`scripts/vibeflow.mjs` 能在不啟動 Electron 的情況下，直接呼叫 `main/helpers/tasks.ts` 建立與更新任務，但仍讀寫 electron-store 的路徑。
- 進行中的相關規劃：LIBRARY\_PLAN.md（skill 投遞）與 REMOTE\_SPEC.md（手機遠端控制，PeerJS），兩者都會受 core 邊界影響。

**目標**

1. 核心邏輯零 UI 依賴：`core` 不 import electron、react、next。
2. 單一入口：`vibeflow` 開啟 Web UI，`vibeflow tui` 開啟終端機介面，兩者操作同一份狀態與 session。
3. 體驗一致：Web UI 保留現有看板、拖曳、互動終端、diff、Markdown 渲染。
4. 開源可自由取得：`git clone && npm install && npm start` 可直接執行，也可 `npx vibeflow`。
5. 任務不綁定 UI 生命週期：關閉瀏覽器或 TUI 後，agent 仍在背景執行，重新開啟可接回。

**非目標**

- 本期不做 Apple Developer ID 簽章與公證（列為後續選項）。
- 不重寫 agent 整合邏輯（claude / codex 的指令組裝、hooks、MCP 設定沿用現有實作）。
- 不在第一版支援多台機器共享同一個 core（遠端控制維持 REMOTE\_SPEC 的範圍）。

## 目標架構

所有前端都只與 `@vibeflow/core` 對話，彼此不直接共享狀態；只有 core 會碰到 git、agent CLI、tmux 與檔案系統。

> 圖（見 Claude Docs 原文）：目標架構 · 4 個前端、1 個 core、4 項外部相依

手機遠端即 REMOTE\_SPEC 的功能，遷移後改由 core 擔任 host，而不是 Electron renderer。

**Monorepo 結構**

```
vibeflow/
├── packages/
│   ├── core/      任務、git、agent 指令、session、transport 伺服器
│   ├── web/       現有 renderer，改為靜態輸出
│   ├── tui/       Ink 介面
│   ├── cli/       vibeflow 指令入口（含現有 scripts/vibeflow.mjs 的功能）
│   └── electron/  選用的桌面包裝，退場前保留
└── package.json   npm workspaces
```

| 套件 | 職責 | 可以依賴 |
| --- | --- | --- |
| `core` | 所有業務邏輯與狀態，對外只提供 `VibeFlowApi` | Node 內建模組、node-pty、ws |
| `web` | 看板、拖曳、終端機、diff、Markdown 渲染 | `core` 的型別（不含實作） |
| `tui` | 終端機內的看板與操作 | `core`、ink |
| `cli` | 解析指令、單一實例鎖、啟動前端 | `core`、`tui` |
| `electron` | 開視窗載入 `web`，以 IPC 轉接 `core` | `core`、electron |

## Core API 與 Transport 設計

前端只依賴一份 `VibeFlowApi` 介面，Web 版透過 WebSocket 呼叫，TUI 版與 CLI 直接在同一個行程內呼叫，Electron 版（若保留）透過 IPC 呼叫；三者共用同一份型別。

**設計原則**

- 指令（command）與事件（event）分離：指令回傳結果，狀態變化一律以事件推送，前端不輪詢。
- 現有 Electron IPC handler 逐一對應成 API 方法，遷移時先建對照表，確保沒有遺漏。
- 資料不含 UI 概念：沒有「展開的卡片」、「選取的分頁」這類狀態，這些留在前端。
- 所有路徑在 core 內部解析，傳給前端的是 task id，不是檔案系統路徑（與 REMOTE\_SPEC 不外洩路徑的原則一致）。

**型別定義範例**

```typescript
export type Column = 'backlog' | 'in_progress' | 'done'
export type Stage = 'developing' | 'reviewing' | 'revising' | 'approved' | 'blocked'

export interface VibeFlowApi {
  // 任務
  listTasks(): Promise<Task[]>
  createTask(input: CreateTaskInput): Promise<Task>
  updateTask(id: string, patch: TaskPatch): Promise<Task>
  moveTask(id: string, to: Column): Promise<Task>
  // Session（agent 執行）
  startSession(taskId: string): Promise<SessionInfo>
  stopSession(taskId: string): Promise<void>
  writeInput(taskId: string, data: string): Promise<void>
  resize(taskId: string, cols: number, rows: number): Promise<void>
  // 審查
  getDiff(taskId: string): Promise<FileDiff[]>
  approve(taskId: string, message?: string): Promise<ApproveResult>
  cleanup(taskId: string): Promise<void>
  // 設定與工作區
  getSettings(): Promise<Settings>
  updateSettings(patch: Partial<Settings>): Promise<Settings>
  listWorkspaces(): Promise<Workspace[]>
  // 事件
  on<E extends keyof CoreEvents>(event: E, cb: (p: CoreEvents[E]) => void): () => void
}

export interface CoreEvents {
  'task:changed': Task
  'task:removed': { id: string }
  'session:output': { taskId: string; data: string }
  'session:exit': { taskId: string; code: number | null }
  'settings:changed': Settings
}
```

**Transport 層**

| 前端 | Transport | 說明 |
| --- | --- | --- |
| Web UI | WebSocket（JSON-RPC 風格） | 每個訊息帶 `id`、`method`、`params`；事件以 `event` 欄位推送 |
| TUI / CLI | 同行程呼叫，或連到已執行的 core | 直接 import `core`；若已有主機行程則改走 WebSocket（見 Session 層設計） |
| Electron（選用） | `ipcRenderer.invoke` | 保留期間用同一份介面包裝，行為不變 |

renderer 端新增 `renderer/lib/api.ts`，依執行環境選擇 transport，元件只 import `api`，不再直接呼叫 `window.ipc` 或 `ipcRenderer`。

**狀態儲存**

electron-store 換成 core 自己的 JSON store，放在與現有 electron-store 相同的 `appData` 目錄（`scripts/vibeflow.mjs` 已實作這套路徑解析），首次啟動時自動沿用舊資料，使用者不需手動遷移。寫入採「寫暫存檔再 rename」，且只有持有實例鎖的 core 行程會寫入，避免半寫檔與競爭。

## Session 層設計

每台機器同時只有一個 core 主機行程，所有前端都連到它；agent 則跑在 tmux session 裡，讓任務的生命週期脫離 UI 與 core 本身。

**單一實例鎖**

1. `vibeflow` 啟動時嘗試取得 `<appData>/vibeflow/core.lock`，檔內記錄 `pid`、`port`、`token`。
2. 取得成功：成為主機，啟動 core、WebSocket 伺服器，再開啟要求的前端。
3. 取得失敗且 `pid` 仍存活：不啟動新的 core，改以 WebSocket 連到既有主機（`vibeflow tui` 與再次執行的 `vibeflow` 都走這條路）。
4. `pid` 已不存在：視為殘留鎖，清除後重新取得。

**SessionBackend 介面**

```typescript
export interface SessionBackend {
  start(taskId: string, cwd: string, cmd: string[], env: Record<string, string>): Promise<void>
  attach(taskId: string, onData: (d: string) => void): () => void
  write(taskId: string, data: string): void
  resize(taskId: string, cols: number, rows: number): void
  isAlive(taskId: string): Promise<boolean>
  kill(taskId: string): Promise<void>
}
```

| 後端 | 適用 | 行為 |
| --- | --- | --- |
| `TmuxBackend`（預設） | macOS、Linux，有安裝 tmux | 每張卡片一個 session，命名 `vf-<taskId>`；core 重啟後以 `tmux has-session` 找回執行中的任務 |
| `PtyBackend`（退回） | Windows，或未安裝 tmux | 沿用現有 node-pty 實作；core 結束時 session 隨之結束，並在 UI 顯示提示 |

**Web UI 如何顯示 tmux session**

core 以 node-pty 執行 `tmux attach -t vf-<taskId>`，把輸出經 WebSocket 送到 xterm.js。多個瀏覽器分頁看同一張卡片時，各自 attach，由 tmux 負責同步畫面。

**TUI 如何顯示 tmux session**

TUI 本身跑在 tmux 外時，開啟卡片會暫停 TUI 畫面並 `tmux attach`，按 tmux 的 detach 鍵回到看板；TUI 跑在 tmux 內時，改用 `tmux switch-client` 切換，不必巢狀。

**輸出紀錄**

以 `tmux pipe-pane` 把每個 session 的輸出附加寫入 `.vibeflow/<taskId>/output.log`，供進度摘要、遠端控制的 `vf:terminal-chunk` 以及事後回顧使用，不依賴 UI 是否開著。

## 分階段遷移計畫

遷移分 7 個階段，每個階段結束都有一道可驗證的關卡，通過才進下一步；任何時間點 main 分支都能發布可用版本。

> 圖（見 Claude Docs 原文）：遷移路線圖 · 7 個階段、6 道關卡

週數為一人全職的粗估。Phase 4 與 Phase 5 可部分並行，因為 TUI 的看板部分不依賴 tmux。

### Phase 0　準備與回歸基準

- [x] 以 Playwright 錄製主要流程（改為驅動 Web UI 並搭配假 agent，見 e2e/web.e2e.mjs）：新增專案、建任務、啟動 agent、互動輸入、看 diff、approve、清理。
- [x] 盤點所有 IPC channel，建立「channel → 未來 API 方法」對照表。
- [x] 改成 npm workspaces 的 monorepo，建立 `packages/core`、`web`、`tui`、`cli` 空殼，現有程式暫時不動。

### Phase 1　抽出 core

- [x] 把 `main/helpers/` 逐檔移入 `packages/core`，從 `scripts/vibeflow.mjs` 已經使用的 `tasks.ts`、`agents.ts`、`attachments.ts` 開始。
- [x] 定義 `PlatformServices` 介面（應用資料路徑、開啟外部連結、通知、選擇資料夾），Electron 版與 Node 版各自實作並注入。
- [x] 以 JSON store 取代 electron-store，首次啟動自動讀取舊資料。
- [x] 加上 lint 規則：`packages/core` 禁止 import electron、react、next。

### Phase 2　Transport 抽象層

- [x] 在 `packages/core` 定義 `VibeFlowApi` 與 `CoreEvents` 型別。
- [x] 新增 `renderer/lib/api.ts`，先只實作 IPC transport。
- [x] 把元件中所有直接的 IPC 呼叫改成透過 `api`。

### Phase 3　本機 Web UI

- [x] 在 core 中加入 HTTP 伺服器（提供 Next.js 靜態輸出）與 WebSocket transport。
- [x] 實作「安全性設計」的五項要求與對應測試。
- [x] 實作單一實例鎖與 `vibeflow` 指令：啟動 core 並開啟瀏覽器。
- [x] 以路徑輸入加最近使用清單，取代原生的選擇資料夾對話框。
- [x] 終端機改為 xterm.js 經 WebSocket 連到 core 的 PtyBackend。

### Phase 4　tmux Session 層

- [x] 定義 `SessionBackend`，把現有 node-pty 程式整理成 `PtyBackend`。
- [x] 實作 `TmuxBackend`：獨立 socket（`tmux -L vibeflow`）、`pipe-pane` 輸出紀錄、重啟後以 `has-session` 找回任務。
- [x] 平台偵測：有 tmux 用 TmuxBackend，否則退回 PtyBackend。

### Phase 5　終端機 TUI

- [x] 以 Ink 實作三欄看板，`h/l` 切欄、`j/k` 選卡、`H/L` 移動卡片。
- [x] Enter 切到該任務的 tmux session，detach 後回到看板。
- [x] diff 檢視：預設使用 `git diff`，偵測到 delta 時改用 side-by-side。
- [x] 新增 `vibeflow status`、`vibeflow stop` 等非互動指令。

### Phase 6　發布 4.0.0

- [ ] 發布到 npm（含 provenance），更新 README 的安裝說明。
- [x] 完成 `vibeflow doctor`。
- [x] 決定 Electron 版的去留：停止維護並移除（2026-10-01）。`main/`、electron-builder 打包與 CI 的安裝檔 job 都已刪除；core 仍讀同一個 appData 目錄與 electron-store 檔案格式，舊看板直接沿用。

## 安全性設計

core 的 WebSocket 能在使用者電腦上啟動 agent、寫入終端機、執行 git push，等同遠端執行指令的入口，因此下列五項是 Web UI 上線的必要條件，不是加分項。

1. **只綁定 loopback**：伺服器綁定 `127.0.0.1`（IPv6 另綁 `::1`），不綁 `0.0.0.0`；埠號隨機，寫入實例鎖檔。
2. **一次性 token**：啟動時以 `crypto.randomBytes(32)` 產生 token，開啟瀏覽器的網址帶 `?token=`；首次載入後換成 `HttpOnly`、`SameSite=Strict` 的 cookie，並從網址列移除 token。
3. **WebSocket 握手檢查**：同時驗證 cookie 與 `Origin` 標頭，`Origin` 必須等於 `http://127.0.0.1:<port>`，否則拒絕。這能防止任意網頁從瀏覽器對 localhost 發起連線（跨站 WebSocket 劫持）。
4. **Host 標頭檢查**：拒絕 `Host` 不是 `127.0.0.1:<port>` 或 `localhost:<port>` 的請求，防範 DNS rebinding。
5. **鎖檔權限**：`core.lock` 以 `0600` 建立，只有使用者本人可讀，TUI 從這裡取得 token 連線。

**其他注意事項**

- API 輸入一律以 schema 驗證（例如 zod），`taskId` 只接受 core 已知的 id，不接受任意路徑。
- `writeInput` 只能寫入該 task 自己的 session，不提供任意指令執行的 API。
- REMOTE\_SPEC 的手機遠端控制改為連到 core 的另一個 transport，沿用同一份 API 與權限檢查，而不是直接存取 renderer 狀態。
- 發布前以 `npm audit` 與 CI 內的 lockfile 檢查把關；`postinstall` 腳本維持最少，讓使用者能安心檢視安裝內容。

## 發布與安裝

主要發布管道改為 npm 上的 `vibeflow` 套件，GitHub Releases 的 .dmg 在 Electron 退場前並行提供；兩者版本號同步。

**使用者的三種安裝方式**

| 方式 | 指令 | 適合對象 |
| --- | --- | --- |
| 免安裝試用 | `npx vibeflow` | 第一次接觸的人 |
| 全域安裝 | `npm i -g vibeflow`，之後執行 `vibeflow` | 日常使用者 |
| 從原始碼執行 | `git clone` → `npm install` → `npm start` | 貢獻者、想改程式的人 |

**前置需求**

- Node.js 22 LTS 以上（對齊 Claude Code 與 Pi 的需求，使用者多半已經安裝）。
- Git 2.30 以上。
- tmux（macOS 用 `brew install tmux`）；沒有時自動退回 PtyBackend 並在 UI 提示。
- claude 或 codex CLI 至少一個，已登入。

**`vibeflow doctor` 指令**

檢查上述前置需求、node-pty 是否能載入、PATH 中是否找得到 agent CLI，並逐項給出修正指令。首次啟動若偵測到問題，自動執行一次。

**npm 套件內容**

- `cli` 的進入點與已 build 的 `core`、`tui`。
- `web` 的 Next.js 靜態輸出（`output: 'export'`），由 core 的 HTTP 伺服器提供，不需要 Next.js runtime。
- 相依套件只保留執行期需要的：`node-pty`、`ws`、`ink` 等；react、next、tailwind 等 build 工具不進入發布套件。

**CI（沿用現有 release.yml 的觸發方式）**

1. 推送 `v*` tag 觸發。
2. 在 Ubuntu、macOS、Windows 上執行測試與 `vibeflow doctor`。
3. 以乾淨環境執行 `npm pack` 後的 `npm i -g ./vibeflow-*.tgz`，驗證安裝與啟動。
4. `npm publish --provenance`，讓使用者能驗證套件來源與 CI 建置紀錄。
5. Electron 仍保留期間，同時產出 .dmg 並上傳 draft release。

**版本策略**

- core 拆分完成、Web UI 取代 Electron 為預設時升為 4.0.0。
- monorepo 內各套件先統一版本，等 `@vibeflow/core` 有外部使用者後再考慮獨立版號。

## 測試策略

測試重心放在 core：前端只是視圖，只要 core 的行為不變，三種前端的行為就一致。現有的 `node --test` 測試框架直接沿用。

| 層級 | 範圍 | 做法 |
| --- | --- | --- |
| Core 單元測試 | 任務狀態轉換、指令組裝、store 讀寫 | 沿用 `test/**/*.test.mjs`，把 electron 相關 mock 移除 |
| Git 整合測試 | worktree 建立、分支推送、清理 | 在暫存目錄建 throwaway repo 與本機 bare remote，不碰網路 |
| Session 測試 | TmuxBackend 與 PtyBackend | 以假的 agent 指令（例如輸出固定字串的 shell 腳本）取代 claude，驗證 start / attach / write / kill 與 core 重啟後找回 session |
| API 契約測試 | 同一組測試跑在「同行程」與「WebSocket」兩種 transport 上 | 以參數化測試確保兩種 transport 結果完全相同 |
| 安全性測試 | 無 token、錯誤 Origin、錯誤 Host | 預期全部被拒絕，列為 CI 必過項目 |
| 端對端測試 | Web UI 主流程：建任務、啟動、輸入、看 diff、approve | Playwright 驅動瀏覽器，搭配假 agent |
| 安裝測試 | `npm pack` 後全域安裝並啟動 | CI 三平台執行，加上 `vibeflow doctor` |

**回歸基準**

Phase 1 開始前，先把 Electron 版的主要流程錄成端對端測試（用 Playwright 的 Electron 支援），作為之後每個階段的比對基準：同一組情境在 Electron 版與 Web 版都必須通過。

## 風險與緩解

最大的風險是拆分過程中行為悄悄改變；緩解方式是每個階段都以 Electron 版為基準做比對，而且 Electron 版在 Web 版完全取代前不移除。

| 風險 | 影響 | 緩解 |
| --- | --- | --- |
| 抽 core 時漏掉隱含依賴（electron `app.getPath`、`shell`、`dialog`） | 某些功能在 Web 版失效 | Phase 1 以 lint 規則禁止 `core` import electron；平台服務改由介面注入 |
| 原生對話框（選資料夾）在瀏覽器無法使用 | 使用者無法選擇專案路徑 | Web UI 做路徑輸入加最近使用清單，並提供 `vibeflow open <path>` 從終端機直接加入 |
| node-pty 在一般 Node 上的 prebuilt 缺失 | 部分平台安裝失敗 | 保留 `check:node-pty`；tmux 模式下 node-pty 只用於 Web attach，失敗時仍可用 TUI |
| tmux 版本差異或使用者自訂設定干擾 | session 行為不一致 | 啟動 tmux 時指定獨立 socket（`tmux -L vibeflow`）並使用 VibeFlow 自己的設定檔 |
| 本機伺服器被濫用 | 遠端執行指令 | 依「安全性設計」五項實作，並列入 CI 必過測試 |
| 瀏覽器分頁關閉後使用者以為任務停止 | 背景 agent 持續消耗額度 | UI 顯示執行中的 session 數；`vibeflow status` 與 `vibeflow stop --all` |
| LIBRARY\_PLAN 與 REMOTE\_SPEC 同時進行，改動重疊 | 合併衝突與重工 | 兩者的新程式一律寫在 core 內；遠端控制改接 core 的 API |
| 失去原生桌面整合（選單、通知、Dock） | 體驗下降 | 通知改用瀏覽器 Notification API；Electron 版保留為選用包裝 |

## 時程估算與待決事項

一人全職約需 11 到 15 週；若 Phase 4 與 Phase 5 部分並行，可縮短約 2 週。Phase 3 結束時（約第 5 到 8 週）即可先發布不需 Gatekeeper 處理的 Web 版預覽。

**里程碑**

| 里程碑 | 完成階段 | 使用者可見的改變 |
| --- | --- | --- |
| 內部重構完成 | Phase 0–2 | 無，Electron 版行為不變 |
| Web 版預覽（3.x preview） | Phase 3 | `npx vibeflow` 可用，不再經過 Gatekeeper |
| 背景任務 | Phase 4 | 關閉 UI 後任務繼續執行，重開可接回 |
| 4.0.0 正式版 | Phase 5–6 | TUI 可用，npm 成為主要發布管道 |

**待決事項**

- [x] Electron 版在 4.0.0 之後的定位：停止維護，已移除（2026-10-01）。
- [x] 是否把 Apple Developer ID 簽章與公證列入後續計畫：不需要，Electron 已移除。
- [ ] TUI 的 diff 檢視要自己實作 side-by-side，或依賴使用者安裝 delta。
- [ ] Windows 是否列為正式支援平台（影響 PtyBackend 的測試投入）。
- [ ] LIBRARY\_PLAN 與 REMOTE\_SPEC 要在 Phase 1 之前完成，還是改在 core 上實作。
- [ ] npm 套件名稱：`vibeflow` 是否可用，或改用 scope（例如 `@kw-yeh/vibeflow`）。
