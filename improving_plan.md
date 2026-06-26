# VibeFlow Terminal 通訊架構分析與優化方向

## 一、現行架構概覽

### 資料流全景

```
Claude Agent (PTY process)
    │ 寫入 .vibeflow-progress.json
    ▼
fs.watchFile (800ms poll) → main/helpers/progress.ts
    │ onUpdate(progress)
    ▼
ipcMain → task.progress 更新至 electron-store
    │ IPC event → renderer
    ▼
React state (board) 更新
    │ useEffect 偵測 planDone flip
    ▼
armLaunch → setTerminalLaunch (nonce++)
    │ props 變更
    ▼
TaskTerminal → maybeLaunch() → window.vibeflow.term.start()
    │ IPC
    ▼
main: killSession + startSession (node-pty)
    │ proc.onData → sender.send('pty:data', ...)
    ▼
TaskTerminal: api.term.onData → term.write(data)   [xterm.js]
```

---

## 二、Planning → Execution 切換機制

這是整個架構中最關鍵的狀態轉移，完整流程如下：

### 2.1 Session ID 設計

```
Planning session:  planningSessionId(task.id)   = SHA-like UUID 含 "planning" namespace hash
Execution session: executorSessionId(task.id)   = 直接由 taskId hex 衍生
Reviewer session:  ${taskId}:review             = PTY session key（非 Claude session）
```

**設計理由**：planning 與 execution 用不同的 Claude session ID，避免 `--session-id` 衝突（execution 啟動時 planning session 已存在）。

### 2.2 切換觸發鏈

1. Planning Agent 完成規劃後寫入 `.vibeflow-progress.json`，含 `planDone: true`
2. `watchProgress` (poll 800ms) 偵測到內容變化
3. `onUpdate(progress)` → IPC → store 更新 → board re-render
4. `kanban-board.tsx` 第二個 `useEffect`（監聽 `board`）偵測 `planDone` 由 `false→true`
5. `executionStartedRef` 防止重複觸發（session 級別的 guard）
6. `armLaunch(task)` → `buildExecutionPrompt()` → 組出 execution CLI command
7. `setTerminalLaunch` 更新 state（nonce++）
8. `TaskWorkspacePanel` → `TaskTerminal` 收到新 launch prop
9. `TaskTerminal` 的 `useEffect([launchNonce])` 觸發 `maybeLaunch()`
10. `launchWithCommand(cmd)` → PTY.start（舊 PTY 被 kill，新 PTY 以 execution command 啟動）

### 2.3 Execution 啟動指令結構

```bash
claude --session-id <executorId> \
  --permission-mode auto \
  --model sonnet \
  --settings '{"hooks": {...subagent recording...}}' \
  --add-dir '<workspacePath>' \
  --append-system-prompt '<rolePrompt + DEFAULT_SYSTEM_PROMPT + PROGRESS_PROTOCOL>' \
  '<executionPrompt with steps>'
```

### 2.4 Guard 機制

| Guard | 位置 | 目的 |
|---|---|---|
| `executionStartedRef` | kanban-board.tsx | 防止同一 session 重複啟動 execution |
| `prevExecBoardRef` | kanban-board.tsx | 確認 planDone 是在「本次 session 內」翻轉 |
| `sentNonceRef` | task-terminal.tsx | 防止同一 nonce 的 command 被送出兩次 |
| `claudeResumeOrFresh()` | claude.ts | shell `-f` test：session file 存在才用 `--resume`，否則用 `--session-id` |

---

## 三、Auto-assign Pipeline 狀態機

```
backlog ──[移至 In Progress + autoMode]──► developing
                                               │
                                    allDone flips true (this session)
                                               │
                                               ▼
                                          reviewing  ◄─────────────────────────────────┐
                                               │                                        │
                                    review verdict written                               │
                                          ┌────┴────┐                                   │
                                       approve   request_changes                         │
                                          │            │                                 │
                                          ▼       round < maxRounds                     │
                                       approved        │                                 │
                                                  round >= maxRounds                    │
                                                       │         │                      │
                                                    blocked    revising ─── allDone ───►┘
```

**Dedup 機制**：`firedRef.current` 用 `${stage}|${allDone}|${verdict}|${round}` 作為 signature，相同 sig 不重複觸發。

---

## 四、現行做法的缺口與痛點

### ~~P0：exit code 129 誤報警告~~  ✅ 已完成

**現象**：Agent 對話尚未結束，terminal 就出現「⚠️ 連線中斷或異常結束（exit code: 129）」。

**根本原因**：

Exit code 129 = 128 + SIGHUP(1)，是 node-pty `proc.kill()` 預設送出的訊號，即 `killSession` 被呼叫。這發生在 planning→execution 切換時，planning PTY 被 kill 掉以啟動 execution PTY。

`suppressExitRef`（boolean）設計來吸收這個 exit 事件，但有 **double-kill race condition**：

```
①  planning→execution switch
    → armLaunch(nonce=1) → suppress=true → kill planning PTY → SIGHUP₁

②  selectedTaskId effect（async）的 .then() callback
    使用了 stale closure 的 terminalLaunch，看不到 nonce=1 已存在
    → armLaunch(nonce=2) → suppress=true → kill execution PTY → SIGHUP₂

SIGHUP₁ 抵達 → suppress=true → reset to false  ✓
SIGHUP₂ 抵達 → suppress=false → WARNING 顯示   ✗
```

`suppressExitRef` 是 boolean，只能吸收一次 kill；兩次連發時第二個 SIGHUP 就漏出來。

**次要場景**：planning Claude 寫完 `planDone: true` 但 Claude process 還在輸出文字，800ms 後 orchestrator kill 掉 planning PTY → SIGHUP₁ → 如果此時 suppress 已被消耗，警告就出現。

**改善方向（由易到難）**：

1. **快速修正（最小改動）**：把 `suppressExitRef` 從 boolean 改為 counter：
   ```typescript
   // 每次預期有 kill 發生：
   suppressExitRef.current += 1
   // exit handler：
   if (suppressExitRef.current > 0) {
     suppressExitRef.current -= 1
     return
   }
   ```
   這樣多次連發的 kill 都能被吸收。

2. **修復 stale closure**：在 `selectedTaskId` effect 的 `.then()` 裡，用 ref 而非 closure 來讀 `terminalLaunch` 最新值，防止 double-armLaunch：
   ```typescript
   // 新增 ref 保持同步：
   const terminalLaunchRef = useRef(terminalLaunch)
   terminalLaunchRef.current = terminalLaunch
   // .then() 裡改用 ref：
   if (cancelled || !exists || terminalLaunchRef.current[task.id]) return
   ```

3. **根本修正**：planning PTY 自然結束（exit code 0）才啟動 execution，不強制 kill。但代價是 planning 輸出和 execution 啟動之間有一段等待時間。

**建議**：方案 1 + 方案 2 並行，成本最低且最安全。

### P1：progress 輪詢延遲（800ms）

**問題**：`fs.watchFile` 採 poll 模式（interval: 800ms），導致：
- 步驟完成至 UI 更新最長有 800ms 的視覺落差
- 在連續快速完成多個步驟時，中間狀態可能被跳過

**影響**：使用者體驗—進度條更新不夠即時。

**改善方向**：
- 優先用 `fs.watch()`（event-based，< 10ms 延遲）+ `fs.watchFile` 作為 fallback（NFS/remote 環境）
- 若只支援本機磁碟，直接切換 `fs.watch`，interval 保留給 `watchFile` fallback
- 注意：`fs.watch` 在 macOS 已相當穩定（kqueue）

### P2：Planning→Execution 切換時的 terminal 視覺斷裂

**問題**：
- `planDone` 觸發 `armLaunch` → 舊 planning PTY 被 `kill` → 新 execution PTY 啟動
- xterm.js buffer 被清空，使用者看到 planning 輸出消失
- Planning 結束到 execution 啟動之間有一段空白期（數十 ms）

**影響**：使用者體驗—感覺像「重啟」而非「延續」。

**改善方向（由易到難）**：
1. **過渡訊息**（最小改動）：在 planning PTY exit 時 writeln `\r\n⏳ Planning 完成，切換至 Execution...`，然後再啟動 execution PTY（目前的 exit 偵測只印成功/失敗訊息）
2. **保留 scrollback**：在 main process 端緩衝 PTY 輸出，新 terminal 掛載時 replay（記憶體成本）
3. **不 kill，inject 下一個 prompt**：如果 planning 和 execution 共用同一 PTY，直接 inject execution prompt 作為新的 Claude 對話 turn（無視覺斷裂，但需要 `--continue` 模式；目前用獨立 session ID 是刻意設計）

### P3：Launch command 的 ARG_MAX 風險

**問題**：Launch command 含完整 system prompt（可達 3-5KB）+ task prompt，作為 shell argument 傳入 `zsh -lic <cmd>`。macOS ARG_MAX 為 1MB，理論上安全，但：
- 未來 system prompt 若繼續增長（e.g. 加入更多 workspace context）仍有上限疑慮
- 目前無機制偵測 command 是否被截斷

**改善方向**：
- 監控 command 長度，當超過 200KB 時警告
- 或：將 command 寫入暫存檔，改以 `zsh -lic "source /tmp/vf-cmd-<id>.sh"` 執行（無 ARG 限制）

### P4：PTY 初始大小 80×24 造成換行錯位

**問題**：node-pty 以 `cols: 80, rows: 24` 初始化，xterm.js 掛載後才透過 `ResizeObserver → resize()` 同步實際尺寸。在 resize 前 Claude 已開始輸出，若 terminal 實際寬度 > 80，輸出行長計算錯誤（Claude Code 的 UI 框線會錯位）。

**改善方向**：
- 在 renderer 得知 container 尺寸後，先透過 IPC 傳入初始 `cols/rows` 再啟動 PTY
- 或：launch command 延遲至第一次 resize callback 之後再送（利用現有的 `sentNonceRef` guard）

### P5：Reviewer session 的進度檔衝突風險

**問題**：executor 和 reviewer 都可能寫入同一個 `.vibeflow-progress.json`（同一 worktree）。目前 reviewer 的指令明確說「只寫 `review` 欄位，不動 `steps`」，但這是 prompt-level 約定，非系統強制。

**影響**：若 reviewer 模型不遵守，可能覆蓋 executor 的 `steps` 狀態。

**改善方向**：
- 分開 reviewer 進度檔：`.vibeflow-review.json`（只含 `review` 欄位）
- 或在 merge 階段只取 reviewer output 的 `review` 欄位，其他欄位忽略
- 需配合 `watchProgress` 與 progress protocol prompt 一起調整

### P6：Terminal scrollback 斷層（task 重新選取後 buffer 消失）

**問題**：`mounted` set 讓 `TaskTerminal` 在 DOM 中保持掛載（切換任務時 `hidden` 而非 `unmount`），PTY session 持續存活。但：
- 若使用者關閉再重開 app，xterm.js buffer 完全空白（PTY 新開）
- 若 task 被 unmount（e.g. 超出 renderIds），buffer 也消失

目前 Claude 的對話歷史儲存在 `~/.claude/projects/` 可以 resume，但 terminal 輸出無法重播。

**改善方向**：
- Main process 端替每個 session 維護一個 ring buffer（e.g. 最後 4000 行 PTY 輸出）
- 新 terminal 掛載時先 replay buffer，再繼續 listen
- 記憶體成本：每個 session ~200KB（4000 行 × 平均 50 bytes），可接受
- 技術：IPC `term:replay` 事件，或在 `term:start` response 中附帶 `initialOutput`

---

## 五、優化優先序與建議

| 優先 | 項目 | 難度 | 影響 |
|---|---|---|---|
| **P0** | ~~**exit 129 誤報警告（suppressRef counter + stale closure）**~~ ✅ 已完成 | **低** | **Bug 修正，UX** |
| ~~P0~~ | ~~`fs.watch` 取代 800ms poll~~  ✅ 已完成 | 低 | 進度更新即時化 |
| ~~P1~~ | ~~Planning→Execution 過渡訊息~~  ✅ 已完成 | 低 | 視覺連續性 |
| ~~P1~~ | ~~PTY 初始尺寸對齊 xterm~~  ✅ 已完成 | 中 | 輸出排版正確性 |
| ~~P2~~ | ~~Terminal scrollback replay~~ ✅ 已完成 | 中 | 使用者可查閱執行歷史 |
| ~~P2~~ | ~~Reviewer 進度檔分離~~ ✅ 已完成 | 中 | 架構健壯性 |
| ~~P3~~ | ~~Launch command 長度警告~~  ✅ 已完成 | 低 | 防禦性監控 |

---

## 六、可立即實作的小改善（不破壞現有架構）

### 6.1 `fs.watch` 優化（progress.ts）

```typescript
// 現行：fs.watchFile(file, { interval: 800 }, sync)
// 改為：
const watcher = fs.watch(file, { persistent: false }, sync)
// 保留 watchFile 作為 fallback（watcher.on('error', ...)）
```

### 6.2 Planning 結束過渡訊息（task-terminal.tsx）

在 `onExit` handler 中，當 `exitCode === 0` 且偵測到下一個 launchCommand 正在等待時，改為：

```typescript
if (exitCode === 0 && /* next command armed */) {
  term.writeln('\r\n⏳  Planning 完成，正在切換至 Execution...')
} else if (exitCode === 0) {
  term.writeln('\r\n✅  Agent 執行完成。')
}
```

### 6.3 PTY 初始尺寸（task-terminal.tsx + main.ts）

在 `term.start` IPC 中加入可選的 `cols?` / `rows?` 參數，若提供則以此為初始尺寸，避免 80×24 的預設值造成的換行錯位。

---

## 七、不建議動的部分

- **分離 planning / execution session ID**：設計正確，讓 reviewer 不污染 executor session
- **`zsh -lic <cmd>` 繞過 ZLE**：正確，避免大型 prompt 在 .zshrc plugin 下卡住
- **`mounted` set 保留 DOM 節點**：正確，避免切換任務時 PTY buffer 消失（在無 replay 機制前）
- **`suppressExitRef` guard**：正確，避免 relaunch 時舊 PTY 的 exit 事件誤印警告
