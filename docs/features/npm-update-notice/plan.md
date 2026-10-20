# Plan：npm 更新提示與版本顯示

## 設計

查詢由 host 持有，因為它是每台機器唯一的執行個體，也掌握目前 npm 套件的位置與版本。查詢使用 `npm view <package>@latest version --json`，沿用使用者的 npm registry 設定，並設定逾時。查到較高版本才保留狀態及廣播事件；頁面連線時另由 `host:updateStatus` 讀取當前狀態。

Web UI 在看板上方顯示可關閉的更新訊息。設定視窗透過現有的 `app:getVersion` 取得 host 版本。提示僅提供現有的 CLI 更新指令，不新增安裝權限；重新啟動見下節。

提示上的更新按鈕呼叫無參數的 host 動作。Host 在有 npm 新版時，以各平台的系統終端機執行固定的 CLI 指令；更新及 sudo 提示都留在終端機內。瀏覽器只接收終端機開啟失敗的錯誤，沒有傳送任意 shell 指令的能力。

## 更新後自動重新啟動（2026-10-20 追加）

使用者授權直接更新 spec／plan 後實作，未另行逐份確認。

### 方案與取捨

- **由 host 偵測安裝完成，不由 `vibeflow update` 通知 host。** 更新在 `sudo` 下執行：從那裡重啟 host 會以 root 執行，`HOME`／store 路徑也可能變成 root 的；它也不知道 host 的 `--profile`／`--store-path`。改由 host 每 3 秒讀 `<packageRoot>/package.json` 的版本（`packages/cli/src/self-update.ts`，新增）。這也涵蓋使用者在自己的終端機執行更新。
- **判定安裝完成**：npm 安裝過程中檔案會陸續寫入，所以要求連續兩次讀到相同的較高版本，再執行 `node <cliEntry> --version`，輸出等於該版本才算完成。每個版本只探測一次。
- **重新啟動方式**：原 process 停止自己的 host（釋放 lock 與 port），再以 `stdio: 'inherit'` 執行新版 `node <cliEntry> web --no-open --store-path <dir> --port <port> --backend <kind>`，等它結束後以同一結束碼結束。原 process 成為 supervisor，原終端機繼續看到輸出、Ctrl+C 經由 process group 送到新 host；只送給 supervisor 的 SIGTERM 會轉送。替代方案「detach 新 host 後原 process 結束」會讓 Ctrl+C 失效、輸出消失，不採用。
- **沿用 token**：透過環境變數 `VIBEFLOW_HOST_TOKEN` 傳給新 host；`main()` 一開始讀出後立即從 `process.env` 刪除，之後啟動的 pty session 不會繼承。格式不符時忽略並產生新 token。
- **前端**：`web-bridge.ts` 記錄第一次連線的 host 版本，重新連線後版本不同就 `location.reload()`。同 port＋同 token，cookie 仍有效。
- **不重啟的情況**：host 回呼 `onInstalled` 時檢查是否為 Web host（`autoRestart`）以及 pty 後端是否有 session；不能重啟時透過 update monitor 的 `markInstalled(version, reason)` 在 `AvailableUpdate` 加上 `installedVersion`／`restartBlocked`（新增選用欄位，僅記憶體與事件，不落地），提示改為手動重啟說明。watcher 每次 tick 都再回呼，所以 pty session 結束後下一次 tick 就會重啟。

### 預計修改

| 檔案 | 修改內容 |
|---|---|
| `packages/cli/src/self-update.ts`（新增） | `watchInstalledVersion`：讀版本、穩定判定、探測 CLI、回呼；`relaunchArgs` 組新 host 參數 |
| `packages/cli/src/update-check.ts` | monitor 增加 `markInstalled` |
| `packages/cli/src/host.ts` | `HostOptions.token`／`autoRestart`；啟動 watcher；`RunningHost.restartRequested` |
| `packages/cli/src/main.ts` | 讀取並刪除 `VIBEFLOW_HOST_TOKEN`；`cmdWeb` 收到重啟要求時停止 host 並啟動新版 supervisor 子程序 |
| `packages/cli/src/update-command.ts` | 完成訊息改為說明會自動重新啟動 |
| `packages/core/src/client.ts` | `AvailableUpdate` 增加選用 `installedVersion`、`restartBlocked` |
| `renderer/lib/web-bridge.ts` | 重新連線後版本不同就重新整理 |
| `renderer/pages/home.tsx`、`renderer/components/update-check-section.tsx` | 提示文字；已安裝但未重啟時改顯示手動重啟說明 |
| `test/self-update.test.mjs`（新增）、`test/update-check.test.mjs` | watcher、參數、`markInstalled` |

### 風險

- 新 host 啟動失敗（例如 port 被占用）時 supervisor 以該結束碼結束，使用者需手動執行 `vibeflow`。
- 每次自動更新多一層 supervisor process；只在長期不重開的情況下累積，影響可忽略。
- `vibeflow update` 不是透過 npm 而是其他方式降版時不觸發（只認較高版本）。

## 邊界與風險

- 原始碼執行時只顯示版本，因為無法使用現有 `vibeflow update` 指令更新。
- npm 查詢失敗是非致命狀態；下一個週期重試。

## 驗證

- `test/update-check.test.mjs` 驗證比較規則、npm `latest` 結果、失敗及檢查間隔。
- `test/self-update.test.mjs` 驗證安裝完成判定（較高版本、連續兩次、CLI 探測、每版本只探測一次）與新 host 參數；`test/update-check.test.mjs` 驗證 `markInstalled`。
- `e2e/web.e2e.mjs` 驗證更新提示、關閉後收到新版本會再出現，以及設定中的 host 版本。
- 執行 core 與 renderer typecheck、`npm test`、`npm run build:web`、`npm run test:e2e`。

### 自動重新啟動驗證結果（2026-10-20）

- `npx tsc --noEmit -p tsconfig.json`、`npx tsc --noEmit -p renderer/tsconfig.json`：通過。
- `npm test`：453 項通過；`npm run build:web`：成功；`npm run test:e2e`：3 項通過。
- 執行期：`npm run build:npm` 後以 `npm pack` 安裝到暫存 prefix，用 pty 後端、無 session 啟動 Web host 並開啟 Web UI；把已安裝的 `package.json` 版本改成 4.99.0 模擬安裝完成，約 6 秒後 host 以相同 port 與 token 重啟成 4.99.0，原 process 留著當 supervisor，已開的頁面自動重新整理且仍在登入狀態。送 SIGTERM 給 supervisor 後新 host 一併結束並釋放 lock。
- 未在執行期驗證：pty 有 session 時與 TUI host 的「不重啟」提示（只有單元測試涵蓋 monitor 行為）、Windows、tmux 後端接回 session。
