# VibeFlow Remote Control — 規格計劃書

> **版本**：v1.0  
> **日期**：2026-06-20  
> **狀態**：待實作

---

## 1. 概覽

讓使用者透過手機掃描 QR Code，連上一個部署在 Vercel 的行動網頁，對同一台電腦上的 VibeFlow 下達指令、查看任務狀態，無需任何額外伺服器。

```
手機瀏覽器 ←──WebRTC P2P──→ VibeFlow (Electron)
                (PeerJS 公開 broker 撮合)
```

---

## 2. 技術架構

### 2.1 選型依據

| 決策 | 選擇 | 理由 |
|------|------|------|
| P2P 傳輸 | **PeerJS** (`peerjs` npm) | 與 animals-party 相同方案，100% client-only，無需自建 signaling server |
| Signaling broker | PeerJS 公開 broker (`0.peerjs.com`) | 免費、免維護，僅用於初次撮合，數據不過伺服器 |
| STUN/TURN | PeerJS 預設 (Google STUN) | 家用/辦公室網路通常可直連，若 NAT 嚴格再加 TURN |
| 網路拓樸 | Star — VibeFlow 為 Host | 符合「一台電腦 + N 個手機」場景 |
| 認證 | 6 位數 Room Code | 個人使用場景，門檻低；Room Code 即為一次性共享連結 |

### 2.2 連線流程

```
VibeFlow 按下「分享遠端控制」
  → 生成 6 位數 room code (e.g. "847231")
  → Host peer id = "vibeflow-847231"
  → 用 PeerJS 向 broker 登記
  → 顯示 QR Code (URL: https://vibeflow-remote.vercel.app/?room=847231)
  → 等待連線...

手機掃描 QR Code
  → 打開 Vercel 網頁
  → 自動讀取 ?room=847231
  → PeerJS 連到 peer "vibeflow-847231"
  → WebRTC DataChannel 建立
  → 雙向 JSON 訊息交換開始
```

---

## 3. WebRTC 訊息協議

所有訊息格式：
```typescript
interface Message {
  type: string   // 事件名稱
  payload: unknown
}
```

### 3.1 VibeFlow → 手機

| type | 觸發時機 | payload |
|------|---------|---------|
| `vf:hello` | 連線建立後立即發送 | `{ version: string, deviceName: string }` |
| `vf:state` | hello 之後 / 狀態有異動 | `RemoteBoardState`（見第 4 節） |
| `vf:terminal-chunk` | 有訂閱的 task terminal 輸出 | `{ taskId: string, data: string }` |
| `vf:progress-update` | task 的 `.vibeflow-progress.json` 有更新 | `{ taskId: string, progress: TaskProgress }` |
| `vf:error` | 指令執行失敗 | `{ code: string, message: string }` |

### 3.2 手機 → VibeFlow

| type | 說明 | payload |
|------|------|---------|
| `client:get-state` | 要求最新狀態快照 | _(空)_ |
| `client:create-task` | 新增任務 | `CreateTaskPayload`（見第 4 節） |
| `client:send-command` | 向 task terminal 發送文字（加 `\n` 送出） | `{ taskId: string, text: string }` |
| `client:subscribe-terminal` | 訂閱 task 的 terminal 輸出 | `{ taskId: string }` |
| `client:unsubscribe-terminal` | 取消訂閱 | `{ taskId: string }` |
| `client:move-task` | 拖移任務到指定欄位 | `{ taskId: string, targetColumn: ColumnId }` |

---

## 4. 資料模型

### 4.1 RemoteBoardState（VibeFlow → 手機）

精簡版狀態，不含本地路徑（安全考量），供手機端渲染用：

```typescript
interface RemoteTask {
  id: string
  title: string
  description?: string
  projectName?: string        // basename 只，不含完整路徑
  column: 'backlog' | 'in_progress' | 'done'
  progress?: {
    summary: string
    steps: Array<{ text: string; done: boolean }>
  }
  pipeline?: {
    stage: 'developing' | 'reviewing' | 'revising' | 'approved' | 'blocked'
    round: number
  }
  launchedAt?: number
}

interface RemoteWorkspace {
  id: string
  name: string
  available: boolean
}

interface RemoteBoardState {
  tasks: RemoteTask[]          // 所有欄位的任務（column 欄位標示所在欄）
  workspaces: RemoteWorkspace[]
  settings: {
    autoMode: boolean
  }
}
```

### 4.2 CreateTaskPayload（手機 → VibeFlow）

遠端建立任務限制：不支援 baseBranch 自選（預設 main），不支援 agentCli/roleId 設定（保持簡單）。

```typescript
interface CreateTaskPayload {
  title: string
  description?: string
  workspaceId: string   // 選擇已登記的 workspace，避免手機選擇本地路徑
}
```

---

## 5. VibeFlow 端需要的改動

> 此節供 RD 實作 VibeFlow 的 Host 端功能，**不在 Vercel 網頁 repo 範疇內**。

### 5.1 新增的 npm 依賴

```
peerjs          # WebRTC 撮合 (browser-compatible, works in Electron renderer)
qrcode          # 生成 QR Code DataURL
```

### 5.2 新增的 UI 元件

**`renderer/components/remote-share-dialog.tsx`**
- 觸發：頂部工具列新增「遠端控制」按鈕（Smartphone icon）
- 內容：
  - QR Code 圖片（300×300）
  - Room code 文字（可複製）
  - 連線中的裝置數量
  - 「停止共享」按鈕

### 5.3 新增的 Renderer Logic

**`renderer/hooks/use-remote-host.ts`**

```typescript
// 偽碼示意
function useRemoteHost(boardState: BoardState, workspaces: Workspace[]) {
  const [roomCode, setRoomCode] = useState<string | null>(null)
  const [peers, setPeers] = useState<DataConnection[]>([])

  function startSharing() {
    const code = randomSixDigits()
    const peer = new Peer(`vibeflow-${code}`)
    peer.on('connection', (conn) => {
      conn.on('open', () => {
        conn.send({ type: 'vf:hello', payload: { version, deviceName } })
        conn.send({ type: 'vf:state', payload: buildRemoteState() })
        setPeers(prev => [...prev, conn])
      })
      conn.on('data', (msg) => handleClientMessage(msg, conn))
    })
    setRoomCode(code)
  }

  function broadcast(msg: Message) {
    peers.forEach(conn => conn.send(msg))
  }

  // 每次 boardState 改變 → broadcast 新 state
  useEffect(() => {
    if (peers.length > 0) broadcast({ type: 'vf:state', payload: buildRemoteState() })
  }, [boardState])

  // handleClientMessage → 呼叫 window.vibeflow.createTask() 等 IPC wrapper
}
```

### 5.4 Terminal 輸出橋接

目前 `progress:update` 事件從 main push 到 renderer。Terminal 的原始輸出（`pty:data`）目前直接送到 xterm，需要新增側錄：

在 `task-terminal.tsx` 的 `onData` 回呼中，若有 remote subscribers，將 chunk 透過 `useRemoteHost` 的 `broadcast({ type: 'vf:terminal-chunk', payload: { taskId, data } })` 轉出。

---

## 6. Web App 規格（獨立 Repo，部署 Vercel）

### 6.1 推薦技術棧

| 項目 | 選擇 | 備註 |
|------|------|------|
| Framework | **Next.js 14+ (App Router)** | 你熟悉的棧；static export 即可 |
| 樣式 | **Tailwind CSS v4** | 與 VibeFlow 主體一致 |
| 元件 | **shadcn/ui** | 直接複用 VibeFlow 的元件風格 |
| 圖示 | **lucide-react** | 同 VibeFlow |
| WebRTC | **peerjs** | 同 VibeFlow Host 端 |
| QR 掃描 | **html5-qrcode** 或 直接從 URL 解析 | 手機掃描後 URL 已帶 `?room=XXXXXX`，不需額外掃描器 |
| 狀態管理 | **React useState/useContext** | 無需 Zustand/Redux，狀態來自 WebRTC |
| TypeScript | Yes | 共用與 VibeFlow 相同的 type 定義 |

### 6.2 Repo 結構

```
vibeflow-remote/           # 獨立 repo，部署至 Vercel
├── app/
│   ├── layout.tsx
│   ├── page.tsx           # 首頁：未連線狀態 / 手動輸入 room code
│   └── board/
│       └── page.tsx       # 主要看板頁面（連線後）
├── components/
│   ├── connection-gate.tsx      # 連線前畫面
│   ├── remote-board.tsx         # 看板主畫面
│   ├── task-card.tsx            # 任務卡片（行動端優化）
│   ├── task-detail-drawer.tsx   # 任務詳情側抽屜
│   ├── terminal-view.tsx        # 串流 terminal 輸出（只讀 + 輸入框）
│   ├── create-task-sheet.tsx    # 新增任務表單（Bottom Sheet）
│   └── progress-steps.tsx       # 步驟進度條
├── hooks/
│   └── use-remote-client.ts     # WebRTC client hook（核心）
├── lib/
│   ├── types.ts                 # 共用型別（RemoteTask, RemoteBoardState 等）
│   └── peer.ts                  # PeerJS 初始化 helper
└── public/
```

### 6.3 頁面流程

#### 首頁 `/`

**狀態 A：尚未有 `?room=` 參數**
```
┌────────────────────────────────────┐
│  VibeFlow Remote                   │
│                                    │
│  輸入 Room Code：                  │
│  ┌──────────────────────────────┐  │
│  │   _ _ _ _ _ _               │  │
│  └──────────────────────────────┘  │
│           [連線]                   │
│                                    │
│  或掃描 VibeFlow 的 QR Code       │
└────────────────────────────────────┘
```

**狀態 B：URL 帶有 `?room=XXXXXX`（從 QR 掃描進來）**
- 自動開始連線，顯示 loading spinner
- 連線成功 → 導向 `/board?room=XXXXXX`
- 連線失敗 → 顯示錯誤訊息 + 重試按鈕

#### 看板頁 `/board`

**頂部導覽列**
```
┌────────────────────────────────────────┐
│ VibeFlow Remote   [project: myapp]   ⊕ │
└────────────────────────────────────────┘
```
- 左：app 名稱 + 當前主要 workspace
- 右：`⊕` 新增任務按鈕

**看板本體**（垂直捲動卡片 list，依欄位分群）

```
── Backlog (3) ──────────────────────────
┌────────────────────────────────────┐
│ 🟡 修正登入頁 RWD 問題              │
│    myapp                           │
│ [傳送指令]                         │
└────────────────────────────────────┘
┌────────────────────────────────────┐
│ 🟡 新增 API 限流機制                │
│    myapp                           │
└────────────────────────────────────┘

── In Progress (1) ──────────────────────
┌────────────────────────────────────┐
│ 🔵 重構 auth middleware             │
│    myapp                           │
│ ████████░░ 4/5 步驟完成            │
│ > 正在執行測試...                   │
│ [傳送指令] [查看 Terminal]         │
└────────────────────────────────────┘

── Done (2) ─────────────────────────────
...
```

狀態 Badge 顏色對應：
- `backlog` → 灰
- `in_progress`, pipeline=`developing` → 藍
- `in_progress`, pipeline=`reviewing` → 黃
- `in_progress`, pipeline=`approved` → 綠
- `in_progress`, pipeline=`blocked` → 紅
- `done` → 淡綠

#### 任務詳情抽屜（點擊卡片開啟）

```
┌────────────────────────────────────┐
│ ← 重構 auth middleware              │
│ myapp · In Progress · branch: vf-xyz│
├────────────────────────────────────┤
│ 描述：                              │
│ 處理 session token 合規問題         │
├────────────────────────────────────┤
│ 進度：                              │
│ ✅ 分析現有 middleware              │
│ ✅ 撰寫測試                        │
│ ✅ 實作新邏輯                       │
│ ✅ 執行測試                        │
│ ⬜ Code Review                     │
├────────────────────────────────────┤
│ Terminal 輸出（最近 50 行）：       │
│ ┌──────────────────────────────┐   │
│ │ > Running tests...           │   │
│ │ ✓ auth.test.ts (12 tests)    │   │
│ └──────────────────────────────┘   │
│ ┌────────────────────┐ [送出]      │
│ │ 輸入指令...         │            │
│ └────────────────────┘            │
└────────────────────────────────────┘
```

#### 新增任務 Bottom Sheet（點擊 `⊕` 開啟）

```
┌────────────────────────────────────┐
│ 新增任務                            │
├────────────────────────────────────┤
│ 任務標題 *                          │
│ ┌──────────────────────────────┐   │
│ │                              │   │
│ └──────────────────────────────┘   │
│                                    │
│ 任務描述（可選）                    │
│ ┌──────────────────────────────┐   │
│ │                              │   │
│ │                              │   │
│ └──────────────────────────────┘   │
│                                    │
│ 專案                               │
│ ┌──────────────────────────────┐   │
│ │ myapp                     ▼  │   │
│ └──────────────────────────────┘   │
│                                    │
│          [取消]    [新增任務]       │
└────────────────────────────────────┘
```

注意：
- 專案下拉選單的選項來自 VibeFlow 回傳的 `workspaces`（`available: true` 的才顯示）
- 不開放 baseBranch、roleId、agentCli 選項（保持簡單，使用 VibeFlow 預設值）
- 送出後卡片狀態轉為 `loading`，待 VibeFlow 回傳新 state 後更新

### 6.4 核心 Hook：`use-remote-client.ts`

```typescript
// 回傳值型別
interface RemoteClientResult {
  state: RemoteBoardState | null
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  errorMessage: string | null
  terminalOutput: Record<string, string[]>   // taskId → lines[]

  connect: (roomCode: string) => void
  disconnect: () => void
  createTask: (payload: CreateTaskPayload) => void
  sendCommand: (taskId: string, text: string) => void
  subscribeTerminal: (taskId: string) => void
  unsubscribeTerminal: (taskId: string) => void
  moveTask: (taskId: string, column: ColumnId) => void
}

function useRemoteClient(): RemoteClientResult {
  // 1. 管理 Peer 物件與 DataConnection
  // 2. 處理 vf:state → setState(payload)
  // 3. 處理 vf:terminal-chunk → append to terminalOutput[taskId]
  // 4. 處理 vf:progress-update → update state.tasks 的對應 task
  // 5. 發送 client:* 訊息
}
```

### 6.5 路由設計

```
/                    首頁（未連線 / 輸入 room code）
/board?room=XXXXXX   主看板（連線後）
```

連線驗證：進入 `/board` 時若沒有 `?room=` 或 connection 尚未建立，redirect 回 `/`。

### 6.6 離線 / 斷線處理

| 情境 | 行為 |
|------|------|
| VibeFlow 關閉 QR Code 對話框（停止 Host） | DataChannel close → 顯示「已中斷連線」banner，3 秒後嘗試重連（共 3 次） |
| 手機網路中斷後恢復 | 同上，自動重連 |
| Room Code 錯誤（peer 不存在） | 顯示「找不到裝置，請確認 VibeFlow 正在分享」 |
| 重連 3 次失敗 | 顯示「連線失敗」+ 返回首頁按鈕 |

---

## 7. 安全考量

| 威脅 | 緩解方式 |
|------|---------|
| 未知裝置連入 | Room Code 6 位數（100 萬組合），且 VibeFlow 使用者必須主動開啟分享按鈕 |
| 連線期間被嗅探 | WebRTC DataChannel 預設使用 DTLS 加密 |
| 洩漏完整本機路徑 | `RemoteBoardState` 不回傳 `projectPath`/`worktreePath` 等絕對路徑 |
| 手機端惡意指令 | 所有 `client:send-command` 的文字限制 1000 字元；`client:create-task` 的 `workspaceId` 必須在 VibeFlow 已登記的 workspaces 內 |

---

## 8. 實作順序建議

### Phase 1：VibeFlow Host 端（在本 repo 實作）
1. 安裝 `peerjs`、`qrcode`
2. 實作 `use-remote-host.ts` hook（`startSharing`, `stopSharing`, `broadcast`）
3. 實作 `remote-share-dialog.tsx`（QR Code + room code 顯示）
4. 在 `home.tsx` 串接：board state 變化 → `broadcast(vf:state)`
5. 處理 `client:create-task` → 呼叫 `window.vibeflow.createTask()`
6. 處理 `client:send-command` → 呼叫 `window.vibeflow.writeSession()`（需新增 IPC bridge）
7. 處理 `client:move-task` → 呼叫 `window.vibeflow.setBoard()`

### Phase 2：Web App（另開 repo）
1. 用 `create-next-app` 建立，安裝 `peerjs`、shadcn/ui、tailwind
2. 實作 `use-remote-client.ts`
3. 實作首頁（room code 輸入）
4. 實作看板頁（task list、column 分群）
5. 實作任務詳情抽屜（progress + 指令輸入）
6. 實作新增任務 Bottom Sheet
7. 部署至 Vercel，設定 `NEXT_PUBLIC_APP_URL` 供 VibeFlow QR Code 使用

### Phase 3：Terminal 串流（進階，可後續補）
1. VibeFlow 的 `task-terminal.tsx` 側錄 pty output
2. 透過 `use-remote-host` 廣播 `vf:terminal-chunk`
3. Web App 的 `terminal-view.tsx` 接收並顯示

---

## 9. 環境變數（Web App）

```bash
# .env.local（本地開發）
NEXT_PUBLIC_PEERJS_HOST=0.peerjs.com   # 使用公開 broker
NEXT_PUBLIC_PEERJS_PORT=443
NEXT_PUBLIC_PEERJS_PATH=/myapp
NEXT_PUBLIC_PEERJS_SECURE=true
```

> 若日後有 NAT 穿透問題，可自建 PeerJS server 或購買 TURN server，只需改這幾個 env，程式碼不需改動。

---

## 10. 尚未涵蓋（刻意排除，避免 scope 膨脹）

- **多人同時連線的衝突解決**：目前廣播最新 state 即可，後續若多人同時操作才需要 OT/CRDT
- **指令歷史記錄**：手機端不儲存歷史，每次重連從 VibeFlow 拉最新 state
- **認證機制**：room code 只是一次性配對，不做帳號登入
- **PR Approve/Merge 操作**：涉及 git 操作，遠端只讀，需另行設計
- **通知推播**：可用 Web Push API，但需要額外 service worker 工程，Phase 3+ 再評估

---

*規格書由 Fatty (RD) 撰寫，供 PM/RD 確認後進入 Phase 1 實作。*
