# Plan：日夜接力（下班派工與晨報）

- 狀態：已確認
- 對應 Spec：[spec.md](./spec.md)
- 更新日期：2026-11-26
- 確認紀錄：2026-11-26 使用者回覆「可以，寫完規格與計畫就開始實作」，授權直接實作。分支：`feat/night-shift`。

## 現有程式碼調查

| 檔案 | 現有行為與可重用的部分 |
| --- | --- |
| `packages/core/src/release.ts` | `occupiedSlots`、`readyCards`、`releaseCandidates`。`readyCards` 只看盤點欄。 |
| `packages/core/src/service.ts` | `releaseTick` 依名額呼叫 `startTask`；`setRelease` 開／關批次，關閉時呼叫 `reporter.create`。`startTask` 接受待辦與盤點欄的卡。`continueTask` 換新 session，brief 由 `continuation.ts` 組出。`launchCommand` 在盤點過的卡第一次啟動時用 `executionBrief`。`progress.onUpdate` 是 activity 變化的入口（`quotaFromActivity` 就掛在這裡）。 |
| `packages/core/src/launch.ts` | `executionBrief`、`BOARD_CLI_SETUP`、`masterSystemPrompt`。 |
| `packages/core/src/report.ts` | `reportRows`、`reportTable`：卡片依派出順序列出，標題是「放行批次報告」。 |
| `packages/core/src/status-tags.ts` | `setTaskStatus` 是唯一的寫入入口，任何非 Done 欄位都可以設定狀態。 |
| `packages/core/src/continuation.ts` | `buildContinuationPrompt(facts)`：組出新 session 的 brief。 |
| `packages/cli/src/release-command.ts` | `release on/off/status`，`report list/show`。 |
| `renderer/components/autonomous.tsx` | `ReleaseControl`：放行開關、名額、報告按鈕。名額計算在 renderer 有一份重複的 `occupied()`。 |

## 方案與取捨

**1. 用既有的 release 狀態承載夜班，不另外開新的 state。** `release.enabled` 就是「夜班進行中」，`batches` 和 `reports` 照舊。差別只在三處：開啟時要有可派出的卡、批次會自動結束、可派出的卡涵蓋待辦和重派卡。`release on` 成為 `dispatch` 的別名。這樣不必改 store 形狀，也不必寫 migration。

**2. 卡片上新增兩個選填欄位。**
- `kind?: 'feature' | 'ebug'`：沒有值就是 feature。
- `dispatch?: { batchId: string; at: number; briefedAt?: number; redo?: string }`：派工時寫入。`launchCommand` 看到這個欄位而且還沒有 `briefedAt`，就送夜班 brief，然後寫入 `briefedAt`；`redo` 是重派時的修正方向。

**3. 可派出的卡（`dispatchable`）。** 依序是盤點欄、待辦、進行中，條件是：不是 master、狀態為準備開工、沒有在等額度、相依都已完成。名額規則加一條：進行中而且帶「準備開工」的卡（等待重派）不佔名額。

**4. 夜班 brief（`nightShiftBrief`，放在 `launch.ts`）。** 共用的部分是卡片內容、「沒有人在線上」的規則、依 `kind` 的步驟，以及回報狀態的指令。盤點過的卡另外附上 spec 和 plan 的路徑；重派的卡把 `redo` 放在最前面，並附上 continuation 的事實（分支、PR、最後一次回覆）。

**5. 自動讓出名額（`settleIdleDispatched`）。** 掛在 `progress.onUpdate`。只處理派出中的卡：卡片在進行中、`dispatch.batchId` 是目前的批次、已經送過 brief、activity 時間晚於 `briefedAt`、狀態是執行中或沒有狀態。activity 是 `waiting/input` 就掛「待你確認：agent 結束回合但沒有回報狀態」；是 `waiting/permission` 就掛「待你確認：卡在權限確認」。

**6. 批次自動結束（`maybeCloseBatch`）。** 每次 `releaseTick` 結束時檢查：批次裡沒有任何卡佔著名額，而且已經沒有可派出的卡，就走和手動關閉相同的路徑（寫 `endedAt`、產生報告）。為了避免剛開批次、卡片還沒啟動就被判定結束，批次至少要派出過一張卡才會自動關閉。

**7. 晨報。** `reportTable` 的標題改成「晨報 YYYY-MM-DD」，卡片分成三組：「需要你處理」、「等你驗收」、「已完成」。批次另外記一份 `skipped`：結束時仍帶準備開工但沒派出的卡，列成「沒有派出」。`ReleaseBatch.skipped?` 是選填欄位。

## 實際修改

實作時有一處和原本的規劃不同：沒有另外加 `dispatch` handler。開啟和停止都沿用既有的 `vibeflow:setRelease`，CLI 的 `vibeflow dispatch` 是 `release on|off|status` 的別名。這樣 handler table 和 client 都不用新增 channel，舊的 `release on/off` 也自動有了新行為。UI 的狀態改寫沿用既有的 `vibeflow:setTaskStatus`，只在 renderer 補上 wrapper。

| 檔案 | 修改內容 | AC |
| --- | --- | --- |
| `packages/core/src/store.ts` | `Task.kind`、`Task.dispatch`、`ReleaseBatch.skipped`、`TaskKind`、`TASK_KINDS`、`taskKind()` | 1, 8, 9, 10 |
| `packages/core/src/release.ts` | `dispatchable()`、`waitingOnDependencies()`、`batchDrained()`；`ready` 不佔名額 | 3, 4, 9 |
| `packages/core/src/launch.ts` | `nightShiftBrief()`；master 提示補上 `--kind`、`--ready` 和今晚派工的做法 | 5, 8 |
| `packages/core/src/service.ts` | `setRelease` 開啟前檢查 `NOTHING_READY`；`dispatchCard`（待辦和盤點走 `startTask`，重派走 `continueTask` 包上夜班 brief）；`closeBatch`（記錄 skipped）；`releaseTick` 結束時自動關閉；`settleIdleDispatched`；`launchCommand` 送夜班 brief、手動啟動時清掉「準備開工」；create／update handler 接受 `kind` | 3–9 |
| `packages/core/src/tasks.ts` | 建立和更新卡片時處理 `kind` | 1 |
| `packages/core/src/report.ts` | 晨報標題、三個分組、「沒有派出」、敘述 prompt | 7, 9 |
| `packages/cli/src/release-command.ts`、`main.ts` | `vibeflow dispatch [--stop｜--status]` | 3, 4 |
| `packages/cli/src/task-command.ts` | `task create --kind --ready`、`task update --kind` | 1, 2 |
| `renderer/lib/task-kind.ts`、`api.ts`、`types.ts` | 類型標籤與選項；`setTaskStatus` wrapper；`updateTask` 帶 `kind` | 1, 2, 8 |
| `renderer/components/autonomous.tsx` | 「下班派工（N）」／「夜班進行中・停止派工」、晨報對話框、`RedoDialog` | 3, 7, 8 |
| `renderer/components/new-task-dialog.tsx`、`edit-task-dialog.tsx`、`pages/home.tsx` | 類型選項；eBug 的描述提示 | 1 |
| `renderer/components/board-columns.tsx` | eBug 標示；選單的「排進今晚」和「改方向重派…」 | 1, 2, 8 |
| `packages/tui/src/index.ts` | 卡片細節列顯示 eBug | 1 |
| `test/night-shift.test.mjs`、`test/task-cli.test.mjs`、`test/release.test.mjs` | 新行為的測試；release 測試改用假的 agent runner | 全部 |
| `AGENTS.md`、`docs/README.md`、`test/README.md`、`IPC_API_MAP.md` | 指令、行為與索引 | — |

## 資料形狀與 migration

`Task.kind`、`Task.dispatch`、`ReleaseBatch.skipped` 都是選填欄位，舊資料讀入時就是「沒有」，行為和現在相同，所以不升 `STATE_VERSION`、不寫 migration。舊版程式讀到新資料會忽略這些欄位：卡片會被當成 Feature，夜班 brief 不會送出，但不會壞掉。

## 實作順序

1. core：型別、`release.ts`、`nightShiftBrief`、`report.ts`，加上單元測試。
2. core：`service.ts` 的派工、自動讓出名額、自動結束、重派，加上 `service.test.mjs`。
3. CLI 與 handler table：`dispatch`、`task create --kind --ready`，加上 `task-cli.test.mjs`。
4. renderer：派工按鈕、類型、排進今晚、改方向重派。
5. TUI 顯示類型；文件。
6. 驗證：兩個 typecheck、`npm test`、`npm run build:web`、`npm run test:e2e`，再用拋棄式 store 實際跑 Web UI。

## 驗證方式

- core 的行為用 `createCore` 加假的 SessionBackend 和假的 progress 事件測試，不啟動真的 agent。
- Web UI 用 `npm start -- --store-path <tmp> --no-open --port 47831` 實際操作：建立 eBug 卡、排進今晚、下班派工、看 header 狀態。夜班 agent 的實際執行不在本機驗證範圍內（需要真的 agent 與額度），由 service 測試覆蓋。

## 風險

- activity 的判斷依賴 transcript 格式。如果 agent 中途結束回合、後來又被 hook 喚醒，卡片可能被提早標成「待你確認」。後果是名額提早讓出、晨報多列一張，不會遺失工作。
- 舊版程式在夜班進行中改寫 store，可能丟掉 `dispatch` 欄位，那張卡就不會收到夜班 brief。這和 autonomous-run 記載的風險相同。
