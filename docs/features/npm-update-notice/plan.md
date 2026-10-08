# Plan：npm 更新提示與版本顯示

## 設計

查詢由 host 持有，因為它是每台機器唯一的執行個體，也掌握目前 npm 套件的位置與版本。查詢使用 `npm view <package>@latest version --json`，沿用使用者的 npm registry 設定，並設定逾時。查到較高版本才保留狀態及廣播事件；頁面連線時另由 `host:updateStatus` 讀取當前狀態。

Web UI 在看板上方顯示可關閉的更新訊息。設定視窗透過現有的 `app:getVersion` 取得 host 版本。提示僅提供現有的 CLI 更新指令，不新增安裝權限或自動重啟流程。

## 邊界與風險

- 原始碼執行時只顯示版本，因為無法使用現有 `vibeflow update` 指令更新。
- npm 查詢失敗是非致命狀態；下一個週期重試。
- 更新套件後，執行中的 host 仍回報舊版本，直到使用者重新啟動。

## 驗證

- `test/update-check.test.mjs` 驗證比較規則、npm `latest` 結果、失敗及檢查間隔。
- `e2e/web.e2e.mjs` 驗證更新提示、關閉後收到新版本會再出現，以及設定中的 host 版本。
- 執行 core 與 renderer typecheck、`npm test`、`npm run build:web`、`npm run test:e2e`。
